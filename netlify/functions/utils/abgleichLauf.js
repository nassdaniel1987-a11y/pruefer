// Ein vollständiger Abgleich: beide Listen holen, importieren, Kinder-
// Verzeichnis mitziehen, vergleichen, speichern und optional den Bericht
// verschicken.
//
// Wird von drei Stellen genutzt, die sich nur in den Optionen unterscheiden:
//   - taeglicher-abgleich.js  Nachtlauf, mit Mail
//   - automatik-jetzt.js      "Jetzt testen", mit Mail, erzwungen
//   - abgleich.js             "Jetzt abgleichen" in der Oberfläche, ohne Mail
//
// Wirft nicht: Fehler landen im Rückgabewert, damit der Aufrufer sie
// protokollieren und melden kann, statt dass ein Lauf still verschwindet.

const { toYmd } = require('./datum');
const { holeListeA } = require('./firebase');
const { holeBuchungen } = require('./kitafinoClient');
const { importiereListe } = require('./import');
const { vergleiche } = require('./vergleich');
const { ladeZuordnungen } = require('./zuordnungen');
const { synchronisiereKinder } = require('./kinderSync');
const { baueBericht } = require('./bericht');
const { sendeMail } = require('./mail');
const { leseEinstellungen } = require('../einstellungen');

const BATCH = 150;

/**
 * @param {import('pg').Client} client
 * @param {Object} opt
 * @param {string}  opt.heute       Bezugstag (YYYY-MM-DD), Fokus des Berichts
 * @param {boolean} [opt.erzwingen] Auch laufen, wenn die Automatik aus ist
 * @param {number}  [opt.blockId]   Bestimmter Ferienblock statt "der heute läuft"
 * @param {boolean} [opt.mailSenden=true] Bericht verschicken
 */
const fuehreAbgleichAus = async (client, { heute, erzwingen = false, blockId = null, mailSenden = true }) => {
  const einstellungen = await leseEinstellungen(client);

  if (!erzwingen && !einstellungen.automatik_aktiv) {
    return { uebersprungen: true, meldung: 'Automatik ist ausgeschaltet' };
  }

  // Entweder der ausdrücklich gewünschte Block oder der, in dessen Zeitraum
  // heute liegt.
  const blockRes = blockId
    ? await client.query(
        'SELECT id, name, startdatum, enddatum FROM ferienblock WHERE id = $1',
        [blockId]
      )
    : await client.query(
        `SELECT id, name, startdatum, enddatum FROM ferienblock
         WHERE startdatum <= $1 AND enddatum >= $1
         ORDER BY startdatum DESC LIMIT 1`,
        [heute]
      );

  if (blockRes.rows.length === 0) {
    return {
      uebersprungen: true,
      meldung: blockId
        ? `Ferienblock ${blockId} nicht gefunden`
        : `Kein laufender Ferienblock am ${heute}`,
    };
  }
  const block = blockRes.rows[0];
  const von = toYmd(block.startdatum);
  const bis = toYmd(block.enddatum);

  // ── Anmeldungen aus Firebase ──
  const a = await holeListeA(block);
  await importiereListe(client, {
    ferienblockId: block.id, liste: 'A', eintraege: a.eintraege
  });

  // ── Essensbuchungen aus kitafino ──
  const projektId = process.env.KITAFINO_PROJEKT_ID;
  if (!projektId) throw new Error('KITAFINO_PROJEKT_ID ist nicht gesetzt');
  const b = await holeBuchungen({ von, bis, projektId });
  await importiereListe(client, {
    ferienblockId: block.id, liste: 'B', eintraege: b.eintraege
  });

  // ── Kinder-Verzeichnis mitziehen ──
  // Reines Upsert, ohne Rückfragen. Musste bisher nach jedem Lauf von Hand
  // angestoßen werden; ein Fehlschlag hier darf den Abgleich nicht aufhalten.
  let kinderSync = null;
  try {
    kinderSync = await synchronisiereKinder(client);
  } catch (e) {
    console.error('Kinder-Synchronisation fehlgeschlagen:', e.message);
    kinderSync = { uebernommen: 0, meldung: 'fehlgeschlagen: ' + e.message };
  }

  // ── Vergleich auf dem frisch gespeicherten Stand ──
  // Die gemerkten Entscheidungen kommen mit, damit einmal geklärte Namenspaare
  // nicht jeden Morgen erneut als unsicher gemeldet werden.
  const [zeilenA, zeilenB, zuordnungen] = await Promise.all([
    client.query('SELECT id, nachname, vorname, klasse, datum FROM liste_a WHERE ferienblock_id = $1', [block.id]),
    client.query('SELECT id, nachname, vorname, klasse, datum FROM liste_b WHERE ferienblock_id = $1', [block.id]),
    ladeZuordnungen(client),
  ]);
  const ergebnis = vergleiche(zeilenA.rows, zeilenB.rows, zuordnungen);

  // ── Als eigenen Abgleich speichern; bestehende bleiben unangetastet ──
  const neuerAbgleich = await client.query(
    `INSERT INTO abgleich (ferienblock_id, status, abgeschlossen_am, veraltet)
     VALUES ($1, 'abgeschlossen', NOW(), FALSE) RETURNING id`,
    [block.id]
  );
  const abgleichId = neuerAbgleich.rows[0].id;

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

  let mailMeldung = 'Bericht verschickt';
  let mailOk = true;

  if (mailSenden) {
    const appUrl = process.env.URL || 'https://pruefer.netlify.app';
    const { betreff, html, text } = baueBericht({
      block,
      ergebnis: { ...ergebnis, von, bis, heute },
      appUrl,
    });
    try {
      await sendeMail({ an: empfaenger, betreff, html, text });
    } catch (e) {
      mailOk = false;
      mailMeldung = e.message;
    }
  } else {
    mailMeldung = 'Abgleich gespeichert';
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
      empfaenger: mailSenden ? empfaenger.length : 0,
      kinder_sync: kinderSync?.uebernommen ?? 0,
    },
    ergebnis,
  };
};

module.exports = { fuehreAbgleichAus };
