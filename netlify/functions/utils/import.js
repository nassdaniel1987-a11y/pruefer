// Bulk-Import für Liste A und B.
//
// Herausgelöst aus listen.js, damit der tägliche Automatiklauf dieselbe Logik
// benutzt, statt über HTTP auf die eigene Function zuzugreifen oder den Code
// ein zweites Mal zu haben.

const { toYmd } = require('./datum');

// Baut die Personen-Übersicht (Name -> Menge der Tage) für den Import-Diff.
const gruppierePersonen = (zeilen, datumFeld = 'datum') => {
  const map = new Map();
  for (const r of zeilen) {
    const key = (r.nachname + '|' + (r.vorname || '')).toLowerCase();
    if (!map.has(key)) map.set(key, { nachname: r.nachname, vorname: r.vorname || '', tage: new Set() });
    const tag = toYmd(r[datumFeld]);
    if (tag) map.get(key).tage.add(tag);
  }
  return map;
};

/**
 * Importiert Einträge in liste_a oder liste_b.
 *
 * Ohne mergeVon/mergeBis wird die komplette Liste des Blocks ersetzt.
 * Mit Zeitraum werden nur die Tage darin ersetzt — sonst gingen die übrigen
 * Tage verloren und gälten anschließend als "kein Essen gebucht".
 *
 * @returns {Promise<{count:number, neu:number, weg:number, gesamt:number}>}
 */
const importiereListe = async (client, {
  ferienblockId,
  liste,
  eintraege,
  mergeVon = null,
  mergeBis = null,
}) => {
  const table = liste === 'A' ? 'liste_a' : 'liste_b';
  const istMerge = Boolean(mergeVon && mergeBis);
  const rangeFilter = istMerge ? ' AND datum BETWEEN $2 AND $3' : '';
  const rangeParams = istMerge ? [mergeVon, mergeBis] : [];

  // Alten Stand für den Diff festhalten. Beim Merge nur den betroffenen
  // Zeitraum, sonst meldet das Log alle übrigen Tage fälschlich als weggefallen.
  const alt = await client.query(
    `SELECT nachname, vorname, datum FROM ${table} WHERE ferienblock_id = $1${rangeFilter}`,
    [ferienblockId, ...rangeParams]
  );
  const altePersonen = gruppierePersonen(alt.rows);

  await client.query(
    `DELETE FROM ${table} WHERE ferienblock_id = $1${rangeFilter}`,
    [ferienblockId, ...rangeParams]
  );

  const gueltig = (eintraege || []).filter(e => e.nachname && e.datum);
  let count = 0;

  if (gueltig.length > 0) {
    const BATCH = 200; // Postgres begrenzt die Parameterzahl pro Query
    for (let i = 0; i < gueltig.length; i += BATCH) {
      const batch = gueltig.slice(i, i + BATCH);
      const werte = [];
      const params = [];
      let idx = 1;

      if (liste === 'A') {
        for (const e of batch) {
          werte.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4})`);
          params.push(ferienblockId, e.nachname, e.vorname || '', e.klasse || '', e.datum);
          idx += 5;
        }
        await client.query(
          `INSERT INTO liste_a (ferienblock_id, nachname, vorname, klasse, datum) VALUES ${werte.join(',')}`,
          params
        );
      } else {
        for (const e of batch) {
          werte.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7})`);
          params.push(ferienblockId, e.nachname, e.vorname || '', e.klasse || '', e.datum, e.menu || '', e.kontostand || null, e.kitafino_id || null);
          idx += 8;
        }
        await client.query(
          `INSERT INTO liste_b (ferienblock_id, nachname, vorname, klasse, datum, menu, kontostand, kitafino_id) VALUES ${werte.join(',')}`,
          params
        );
      }
      count += batch.length;
    }
  }

  // Ein Import ersetzt die Listen-IDs. Vorhandene Abgleiche bleiben historisch
  // erhalten, sind aber nicht mehr aktuell.
  await client.query('UPDATE abgleich SET veraltet = TRUE WHERE ferienblock_id = $1', [ferienblockId]);

  // ── Import-Log ── (nicht kritisch: ein Fehler hier darf den Import nicht kippen)
  let neu = 0, weg = 0, gesamt = 0;
  try {
    const neuePersonen = gruppierePersonen(gueltig);
    const details = [];
    for (const [key, p] of neuePersonen) {
      if (!altePersonen.has(key)) details.push({ aktion: 'neu', nachname: p.nachname, vorname: p.vorname, tage: [...p.tage].sort() });
    }
    for (const [key, p] of altePersonen) {
      if (!neuePersonen.has(key)) details.push({ aktion: 'weg', nachname: p.nachname, vorname: p.vorname, tage: [...p.tage].sort() });
    }

    const istErsterImport = altePersonen.size === 0;
    neu = istErsterImport ? neuePersonen.size : details.filter(d => d.aktion === 'neu').length;
    weg = details.filter(d => d.aktion === 'weg').length;
    const detailsJson = istErsterImport ? null : JSON.stringify(details);

    // "Gesamt" meint immer den ganzen Block. Beim Merge kennt neuePersonen nur
    // den geholten Zeitraum, also aus der DB nachzählen.
    gesamt = neuePersonen.size;
    if (istMerge) {
      const total = await client.query(
        `SELECT COUNT(DISTINCT LOWER(nachname || '|' || vorname)) AS n
         FROM ${table} WHERE ferienblock_id = $1`,
        [ferienblockId]
      );
      gesamt = parseInt(total.rows[0].n, 10) || 0;
    }

    await client.query(
      `INSERT INTO import_log (ferienblock_id, liste, eintraege_neu, eintraege_weg, eintraege_gesamt, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ferienblockId, liste, neu, weg, gesamt, detailsJson]
    );
  } catch (err) {
    console.error('Import-Log Fehler (nicht kritisch):', err.message);
  }

  return { count, neu, weg, gesamt };
};

module.exports = { importiereListe, gruppierePersonen };
