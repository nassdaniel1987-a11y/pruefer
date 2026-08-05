// Die kitafino-Stammliste: alle Benutzer der Einrichtung mit ihrer stabilen
// Benutzer-ID, und deren Verknüpfung mit unseren Kindern.
//
// Warum das lohnt: der Abgleich vergleicht sonst nur Namen und stolpert über
// Schreibweisen, Umlaute, Doppelnamen und vertauschte Vor-/Nachnamen. Hängt an
// einem Kind erst einmal die kitafino-ID, ist seine Zuordnung exakt — dauerhaft
// und unabhängig davon, wie der Name geschrieben wird.
//
// Die Verknüpfung selbst steht in `kinder.kitafino_id`, nicht hier. Diese
// Tabelle ist nur die Abschrift dessen, was im Portal steht.

const { calcScore } = require('./nameMatch');

// Vertauschungstoleranter Namensschlüssel — dieselbe Normalisierung wie der
// Unique-Index auf `kinder` und wie die Zuordnung in abgleich.js.
// "Müller, Hans" und "Hans, Müller" ergeben denselben Schlüssel.
const nameKey = (nachname, vorname) => {
  const a = String(nachname || '').trim().toLowerCase();
  const b = String(vorname || '').trim().toLowerCase();
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

// Ab diesem Wert gilt ein Name als so ähnlich, dass er als Vorschlag taugt.
// Bewusst nur ein Vorschlag: eine falsche Verknüpfung wirkt dauerhaft und
// fiele kaum auf, deshalb wird unterhalb der Exaktheit nie automatisch verknüpft.
const VORSCHLAG_AB = 70;

/**
 * Schreibt die Stammliste fort. Bestehende Einträge werden aktualisiert,
 * keiner wird gelöscht.
 * @returns {Promise<{gesamt:number, neu:number, aktualisiert:number}>}
 */
const speichereRoster = async (client, roster) => {
  const sauber = (roster || []).filter(r => r && r.kitafino_id && r.nachname && r.vorname);
  if (sauber.length === 0) return { gesamt: 0, neu: 0, aktualisiert: 0 };

  const vorher = await client.query('SELECT kitafino_id FROM kitafino_benutzer');
  const bekannt = new Set(vorher.rows.map(r => r.kitafino_id));

  const BATCH = 200;
  for (let i = 0; i < sauber.length; i += BATCH) {
    const teil = sauber.slice(i, i + BATCH);
    const werte = [];
    const params = [];
    let idx = 1;
    for (const r of teil) {
      werte.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      params.push(r.kitafino_id.trim(), r.nachname.trim(), r.vorname.trim(), (r.status || '').trim() || null);
      idx += 4;
    }
    await client.query(`
      INSERT INTO kitafino_benutzer (kitafino_id, nachname, vorname, status)
      VALUES ${werte.join(',')}
      ON CONFLICT (kitafino_id) DO UPDATE SET
        nachname = EXCLUDED.nachname,
        vorname  = EXCLUDED.vorname,
        status   = EXCLUDED.status,
        zuletzt_gesehen = NOW()
    `, params);
  }

  const neu = sauber.filter(r => !bekannt.has(r.kitafino_id.trim())).length;
  return { gesamt: sauber.length, neu, aktualisiert: sauber.length - neu };
};

/**
 * Verknüpft, was zweifelsfrei ist, und schlägt den Rest vor.
 *
 * Automatisch verknüpft wird nur, wenn ALLE vier Bedingungen gelten:
 *   1. der Name stimmt exakt überein (vertauschungstolerant)
 *   2. genau ein Kind passt
 *   3. genau ein Stammlisten-Eintrag passt
 *   4. das Kind hat noch keine kitafino_id
 *
 * Alles andere landet als Vorschlag beim Menschen. Eine falsche Verknüpfung
 * wäre dauerhaft und würde kaum auffallen — deshalb diese Strenge.
 *
 * @param {Object} [opt]
 * @param {boolean} [opt.nurAutomatisch] Vorschläge nicht berechnen (Nachtlauf)
 * @returns {Promise<{verknuepft:number, vorschlaege:Array, offen:number}>}
 */
const verknuepfeEindeutige = async (client, { nurAutomatisch = false } = {}) => {
  const [kinderRes, benutzerRes] = await Promise.all([
    client.query('SELECT id, nachname, vorname, klasse, kitafino_id FROM kinder'),
    client.query('SELECT kitafino_id, nachname, vorname, status FROM kitafino_benutzer'),
  ]);
  const kinder = kinderRes.rows;
  const benutzer = benutzerRes.rows;

  // Schon vergebene IDs: ein Stammlisten-Eintrag darf nicht an einem zweiten
  // Kind landen.
  const vergeben = new Set(kinder.filter(k => k.kitafino_id).map(k => k.kitafino_id));

  const kinderNachSchluessel = new Map();
  for (const k of kinder) {
    const s = nameKey(k.nachname, k.vorname);
    if (!kinderNachSchluessel.has(s)) kinderNachSchluessel.set(s, []);
    kinderNachSchluessel.get(s).push(k);
  }
  const benutzerNachSchluessel = new Map();
  for (const b of benutzer) {
    const s = nameKey(b.nachname, b.vorname);
    if (!benutzerNachSchluessel.has(s)) benutzerNachSchluessel.set(s, []);
    benutzerNachSchluessel.get(s).push(b);
  }

  // ── Schritt 1: eindeutige Paare verknüpfen ──
  const zuSetzen = [];
  for (const [schluessel, kandidatenKinder] of kinderNachSchluessel) {
    if (kandidatenKinder.length !== 1) continue;          // Bedingung 2
    const kind = kandidatenKinder[0];
    if (kind.kitafino_id) continue;                        // Bedingung 4

    const kandidatenBenutzer = benutzerNachSchluessel.get(schluessel) || [];
    if (kandidatenBenutzer.length !== 1) continue;          // Bedingung 3
    const b = kandidatenBenutzer[0];
    if (vergeben.has(b.kitafino_id)) continue;

    zuSetzen.push({ kindId: kind.id, kitafinoId: b.kitafino_id });
    vergeben.add(b.kitafino_id);
    kind.kitafino_id = b.kitafino_id; // lokal mitziehen für Schritt 2
  }

  for (const z of zuSetzen) {
    await client.query(
      'UPDATE kinder SET kitafino_id = $1 WHERE id = $2 AND kitafino_id IS NULL',
      [z.kitafinoId, z.kindId]
    );
  }

  const offeneKinder = kinder.filter(k => !k.kitafino_id);
  if (nurAutomatisch) {
    return { verknuepft: zuSetzen.length, vorschlaege: [], offen: offeneKinder.length };
  }

  // ── Schritt 2: für die übrigen Kinder Kandidaten vorschlagen ──
  const freieBenutzer = benutzer.filter(b => !vergeben.has(b.kitafino_id));
  const vorschlaege = [];

  for (const kind of offeneKinder) {
    const schluessel = nameKey(kind.nachname, kind.vorname);
    const kindName = `${kind.vorname} ${kind.nachname}`;

    const bewertet = freieBenutzer.map(b => {
      const exakt = nameKey(b.nachname, b.vorname) === schluessel;
      const direkt = calcScore(kindName, `${b.vorname} ${b.nachname}`).score;
      const getauscht = calcScore(kindName, `${b.nachname} ${b.vorname}`).score;
      return { benutzer: b, score: exakt ? 100 : Math.max(direkt, getauscht), exakt };
    })
      .filter(x => x.score >= VORSCHLAG_AB)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (bewertet.length === 0) continue;

    // Mehrere exakte Namensgleiche: der Mensch muss auswählen, raten hilft nicht.
    const exakteTreffer = bewertet.filter(x => x.exakt).length;
    vorschlaege.push({
      kind: { id: kind.id, nachname: kind.nachname, vorname: kind.vorname, klasse: kind.klasse },
      kandidaten: bewertet.map(x => ({
        kitafino_id: x.benutzer.kitafino_id,
        nachname: x.benutzer.nachname,
        vorname: x.benutzer.vorname,
        status: x.benutzer.status,
        score: x.score,
      })),
      action: exakteTreffer > 1 ? 'ambiguous' : 'suggest',
    });
  }

  vorschlaege.sort((a, b) => (b.kandidaten[0]?.score || 0) - (a.kandidaten[0]?.score || 0));

  return { verknuepft: zuSetzen.length, vorschlaege, offen: offeneKinder.length };
};

/**
 * Namensschlüssel -> kitafino_id, für den Abgleich.
 *
 * Die Namen in `kinder` stammen über kinderSync direkt aus den Anmeldungen,
 * sind mit `liste_a` also identisch — deshalb genügt hier ein exakter
 * Schlüssel, es muss nichts geraten werden.
 *
 * Mehrfach vergebene IDs werden ausgelassen: solange unklar ist, welches Kind
 * gemeint ist, darf die ID den Abgleich nicht steuern.
 */
const ladeIdIndex = async (client) => {
  const res = await client.query(
    'SELECT nachname, vorname, kitafino_id FROM kinder WHERE kitafino_id IS NOT NULL'
  );
  const zaehler = new Map();
  for (const r of res.rows) zaehler.set(r.kitafino_id, (zaehler.get(r.kitafino_id) || 0) + 1);

  const index = new Map();
  for (const r of res.rows) {
    if (zaehler.get(r.kitafino_id) > 1) continue;
    index.set(nameKey(r.nachname, r.vorname), r.kitafino_id);
  }
  return index;
};

/** Verknüpfung setzen (Vorschlag bestätigen). */
const verknuepfe = async (client, { kindId, kitafinoId }) => {
  if (!kindId || !kitafinoId) throw new Error('Kind und kitafino-ID werden benötigt');
  const belegt = await client.query(
    'SELECT id FROM kinder WHERE kitafino_id = $1 AND id <> $2',
    [kitafinoId, kindId]
  );
  if (belegt.rows.length > 0) {
    throw new Error('Diese kitafino-ID ist bereits einem anderen Kind zugeordnet');
  }
  const res = await client.query(
    'UPDATE kinder SET kitafino_id = $1 WHERE id = $2',
    [kitafinoId, kindId]
  );
  return res.rowCount > 0;
};

/** Verknüpfung lösen. */
const loese = async (client, kindId) => {
  const res = await client.query(
    'UPDATE kinder SET kitafino_id = NULL WHERE id = $1',
    [kindId]
  );
  return res.rowCount > 0;
};

/** Stammliste mit Verknüpfungsstatus, für die Oberfläche. */
const listeStamm = async (client) => {
  const res = await client.query(`
    SELECT b.kitafino_id, b.nachname, b.vorname, b.status, b.zuletzt_gesehen,
           k.id AS kind_id, k.nachname AS kind_nachname, k.vorname AS kind_vorname
    FROM kitafino_benutzer b
    LEFT JOIN kinder k ON k.kitafino_id = b.kitafino_id
    ORDER BY b.nachname, b.vorname
  `);
  return res.rows;
};

module.exports = {
  speichereRoster, verknuepfeEindeutige, ladeIdIndex,
  verknuepfe, loese, listeStamm, nameKey, VORSCHLAG_AB,
};
