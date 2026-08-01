// Täglicher automatischer Abgleich um 09:01 deutscher Zeit.
//
// Holt Liste A aus Firebase und Liste B aus dem kitafino-Portal, speichert
// beide, rechnet den Abgleich und verschickt einen Bericht.
//
// Zeitzone: Netlify plant ausschließlich in UTC, 09:01 deutscher Zeit wandert
// also mit der Sommerzeit. Deshalb laufen wir zu beiden Kandidaten (07:01 und
// 08:01 UTC) an und brechen ab, wenn es in Europe/Berlin gerade nicht 9 Uhr ist.
//
// Derselbe Ablauf lässt sich über action:'jetzt' von Hand auslösen — dafür
// ist ein gültiges Sitzungs-Token nötig.

const { schedule } = require('@netlify/functions');
const { Client } = require('pg');

const { toYmd } = require('./utils/datum');
const { holeListeA } = require('./utils/firebase');
const { holeBuchungen } = require('./utils/kitafinoClient');
const { importiereListe } = require('./utils/import');
const { vergleiche } = require('./utils/vergleich');
const { baueBericht } = require('./utils/bericht');
const { sendeMail } = require('./utils/mail');
const { leseEinstellungen } = require('./einstellungen');

const getClient = () => new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const respond = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});

// Aktuelles Datum und Stunde in deutscher Zeit — unabhängig davon, in welcher
// Zone die Function gerade läuft.
const berlinJetzt = () => {
  const teile = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((acc, t) => { acc[t.type] = t.value; return acc; }, {});
  return {
    datum: `${teile.year}-${teile.month}-${teile.day}`,
    stunde: parseInt(teile.hour, 10),
  };
};

const protokolliere = async (client, { ferienblockId, erfolg, meldung, kennzahlen }) => {
  try {
    await client.query(
      `INSERT INTO automatik_log (ferienblock_id, erfolg, meldung, kennzahlen)
       VALUES ($1, $2, $3, $4)`,
      [ferienblockId || null, erfolg, meldung || null, kennzahlen ? JSON.stringify(kennzahlen) : null]
    );
  } catch (e) {
    console.error('automatik_log nicht schreibbar:', e.message);
  }
};

/**
 * Der eigentliche Lauf. Gibt eine Zusammenfassung zurück und wirft nicht —
 * Fehler landen im Rückgabewert und im Protokoll, damit ein Fehlschlag
 * sichtbar wird statt still zu verschwinden.
 */
const fuehreAus = async (client, { heute, erzwingen = false }) => {
  const einstellungen = await leseEinstellungen(client);

  if (!erzwingen && !einstellungen.automatik_aktiv) {
    return { uebersprungen: true, meldung: 'Automatik ist ausgeschaltet' };
  }

  // Aktiver Ferienblock: der, in dessen Zeitraum heute liegt.
  const blockRes = await client.query(
    `SELECT id, name, startdatum, enddatum FROM ferienblock
     WHERE startdatum <= $1 AND enddatum >= $1
     ORDER BY startdatum DESC LIMIT 1`,
    [heute]
  );
  if (blockRes.rows.length === 0) {
    return { uebersprungen: true, meldung: `Kein laufender Ferienblock am ${heute}` };
  }
  const block = blockRes.rows[0];
  const von = toYmd(block.startdatum);
  const bis = toYmd(block.enddatum);

  // ── Liste A aus Firebase ──
  const a = await holeListeA(block);
  await importiereListe(client, {
    ferienblockId: block.id, liste: 'A', eintraege: a.eintraege
  });

  // ── Liste B aus kitafino ──
  const projektId = process.env.KITAFINO_PROJEKT_ID;
  if (!projektId) throw new Error('KITAFINO_PROJEKT_ID ist nicht gesetzt');
  const b = await holeBuchungen({ von, bis, projektId });
  await importiereListe(client, {
    ferienblockId: block.id, liste: 'B', eintraege: b.eintraege
  });

  // ── Vergleich auf dem frisch gespeicherten Stand ──
  const [zeilenA, zeilenB] = await Promise.all([
    client.query('SELECT id, nachname, vorname, klasse, datum FROM liste_a WHERE ferienblock_id = $1', [block.id]),
    client.query('SELECT id, nachname, vorname, klasse, datum FROM liste_b WHERE ferienblock_id = $1', [block.id]),
  ]);
  const ergebnis = vergleiche(zeilenA.rows, zeilenB.rows);

  // ── Als eigenen Abgleich speichern; bestehende bleiben unangetastet ──
  const neuerAbgleich = await client.query(
    `INSERT INTO abgleich (ferienblock_id, status, abgeschlossen_am, veraltet)
     VALUES ($1, 'abgeschlossen', NOW(), FALSE) RETURNING id`,
    [block.id]
  );
  const abgleichId = neuerAbgleich.rows[0].id;

  const BATCH = 150;
  for (let i = 0; i < ergebnis.matchRows.length; i += BATCH) {
    const batch = ergebnis.matchRows.slice(i, i + BATCH);
    const werte = [];
    const params = [];
    let idx = 1;
    for (const m of batch) {
      werte.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5})`);
      params.push(abgleichId, m.liste_a_id, m.liste_b_id, m.match_typ, m.score, m.grund);
      idx += 6;
    }
    await client.query(
      `INSERT INTO abgleich_matches (abgleich_id, liste_a_id, liste_b_id, match_typ, score, grund)
       VALUES ${werte.join(',')}`,
      params
    );
  }

  // Namen denormalisieren, damit der Abgleich auch nach einem Neuimport der
  // Listen lesbar bleibt (dieselbe Logik wie in abgleich.js).
  await client.query(`
    UPDATE abgleich_matches am SET
      a_nachname = la.nachname, a_vorname = la.vorname, a_datum = la.datum, a_klasse = la.klasse
    FROM liste_a la WHERE am.abgleich_id = $1 AND am.liste_a_id = la.id
  `, [abgleichId]);
  await client.query(`
    UPDATE abgleich_matches am SET
      b_nachname = lb.nachname, b_vorname = lb.vorname, b_datum = lb.datum,
      b_klasse = lb.klasse, b_menu = lb.menu
    FROM liste_b lb WHERE am.abgleich_id = $1 AND am.liste_b_id = lb.id
  `, [abgleichId]);

  // ── Bericht verschicken ──
  const empfaenger = (einstellungen.automatik_empfaenger || []).length > 0
    ? einstellungen.automatik_empfaenger
    : (process.env.MAIL_EMPFAENGER ? [process.env.MAIL_EMPFAENGER] : []);

  const appUrl = process.env.URL || 'https://pruefer.netlify.app';
  const { betreff, html, text } = baueBericht({
    block,
    ergebnis: { ...ergebnis, von, bis, heute },
    appUrl,
  });

  let mailMeldung = 'Bericht verschickt';
  let mailOk = true;
  try {
    await sendeMail({ an: empfaenger, betreff, html, text });
  } catch (e) {
    mailOk = false;
    mailMeldung = e.message;
  }

  return {
    uebersprungen: false,
    block,
    abgleichId,
    mailOk,
    meldung: mailMeldung,
    kennzahlen: {
      ...ergebnis.kennzahlen,
      firebase_eintraege: a.eintraege.length,
      kitafino_eintraege: b.eintraege.length,
      empfaenger: empfaenger.length,
    },
    ergebnis,
  };
};

// Scheitert der Lauf, muss das auffallen. Nur ins Protokoll zu schreiben
// reicht nicht — dort schaut niemand nach, solange er nichts vermisst.
const meldeFehler = async (client, fehler) => {
  try {
    const einstellungen = await leseEinstellungen(client);
    const empfaenger = (einstellungen.automatik_empfaenger || []).length > 0
      ? einstellungen.automatik_empfaenger
      : (process.env.MAIL_EMPFAENGER ? [process.env.MAIL_EMPFAENGER] : []);
    if (empfaenger.length === 0) return;

    const appUrl = process.env.URL || 'https://pruefer.netlify.app';
    await sendeMail({
      an: empfaenger,
      betreff: 'Prüfer: automatischer Abgleich fehlgeschlagen',
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px">
        <h2 style="margin:0 0 8px">Der automatische Abgleich ist heute nicht durchgelaufen</h2>
        <p style="background:#fdecea;border-left:4px solid #d32f2f;padding:10px 14px;margin:16px 0">
          ${String(fehler.message).replace(/</g, '&lt;')}
        </p>
        <p style="font-size:14px;color:#555">
          Die Listen wurden möglicherweise nicht aktualisiert. Du kannst den Abgleich
          jederzeit von Hand im Abgleich-Tool durchführen.
        </p>
        <p><a href="${appUrl}/einstellungen">Einstellungen öffnen</a></p>
      </div>`,
      text: `Der automatische Abgleich ist heute nicht durchgelaufen.\n\n${fehler.message}\n\n${appUrl}/einstellungen`,
    });
  } catch (e) {
    // Auch der Fehlerbericht kann scheitern (kein Schlüssel, kein Empfänger).
    // Dann bleibt das Protokoll als letzte Spur.
    console.error('Fehlerbericht konnte nicht verschickt werden:', e.message);
  }
};

// ─── Geplanter Aufruf ──────────────────────────────────────
const geplanterLauf = async () => {
  const { datum, stunde } = berlinJetzt();
  if (stunde !== 9) {
    // Der zweite Cron-Kandidat für die jeweils andere Jahreszeit.
    return { statusCode: 200, body: `Uebersprungen: in Berlin ist es ${stunde} Uhr, nicht 9` };
  }

  const client = getClient();
  try {
    await client.connect();
    const r = await fuehreAus(client, { heute: datum });
    if (r.uebersprungen) {
      await protokolliere(client, { erfolg: true, meldung: r.meldung });
      return { statusCode: 200, body: r.meldung };
    }
    await protokolliere(client, {
      ferienblockId: r.block.id,
      erfolg: r.mailOk,
      meldung: r.meldung,
      kennzahlen: r.kennzahlen,
    });
    return { statusCode: 200, body: JSON.stringify(r.kennzahlen) };
  } catch (err) {
    console.error('Automatiklauf fehlgeschlagen:', err);
    try { await protokolliere(client, { erfolg: false, meldung: err.message }); } catch { /* egal */ }
    await meldeFehler(client, err);
    return { statusCode: 500, body: err.message };
  } finally {
    try { await client.end(); } catch { /* egal */ }
  }
};

exports.handler = schedule('1 7,8 * * *', geplanterLauf);

// Für den "Jetzt testen"-Knopf in den Einstellungen.
exports.fuehreAus = fuehreAus;
exports.protokolliere = protokolliere;
exports.berlinJetzt = berlinJetzt;
