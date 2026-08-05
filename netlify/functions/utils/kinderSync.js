// Übernimmt Kinder aus den Anmeldungen (liste_a) ins Stammverzeichnis.
//
// Reines Upsert: neue Kinder kommen dazu, bei bekannten wird höchstens eine
// fehlende Klasse ergänzt. Es wird nichts gelöscht und nichts überschrieben —
// deshalb darf der Nachtlauf das ohne Rückfrage mitmachen.
//
// Nicht zu verwechseln mit sync_preview/sync_apply in kinder.js: die ordnen
// ähnliche Namen einander zu und brauchen dafür menschliche Entscheidungen.

const cleanName = (s) => (s || '').trim().replace(/,+$/, '').trim();

const BATCH = 200;

/**
 * @param {import('pg').Client} client
 * @returns {Promise<{uebernommen:number, meldung:string}>}
 */
const synchronisiereKinder = async (client) => {
  const rohe = await client.query(`
    SELECT nachname, vorname, klasse
    FROM liste_a
    WHERE nachname IS NOT NULL AND vorname IS NOT NULL
  `);

  // Vorab entdoppeln: stünde dasselbe Kind zweimal in einem INSERT, würde
  // ON CONFLICT innerhalb derselben Anweisung nicht greifen.
  const eindeutig = new Map();
  for (const e of rohe.rows) {
    const n = cleanName(e.nachname);
    const v = cleanName(e.vorname);
    if (!n || !v) continue;
    const nl = n.toLowerCase();
    const vl = v.toLowerCase();
    // Vor- und Nachname können vertauscht ankommen — der Schlüssel ist deshalb
    // reihenfolgeunabhängig, passend zum Index auf der Tabelle.
    const key = nl < vl ? `${nl}|${vl}` : `${vl}|${nl}`;

    if (!eindeutig.has(key)) {
      eindeutig.set(key, { nachname: n, vorname: v, klasse: e.klasse?.trim() || null });
    } else if (e.klasse && !eindeutig.get(key).klasse) {
      eindeutig.get(key).klasse = e.klasse.trim();
    }
  }

  const zuSchreiben = [...eindeutig.values()];
  if (zuSchreiben.length === 0) {
    return { uebernommen: 0, meldung: 'Keine gültigen Kinder in den Anmeldungen gefunden' };
  }

  for (let i = 0; i < zuSchreiben.length; i += BATCH) {
    const teil = zuSchreiben.slice(i, i + BATCH);
    const werte = [];
    const params = [];
    let idx = 1;
    for (const e of teil) {
      werte.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
      params.push(e.nachname, e.vorname, e.klasse);
      idx += 3;
    }
    await client.query(`
      INSERT INTO kinder (nachname, vorname, klasse)
      VALUES ${werte.join(',')}
      ON CONFLICT (GREATEST(LOWER(TRIM(nachname)), LOWER(TRIM(vorname))), LEAST(LOWER(TRIM(nachname)), LOWER(TRIM(vorname))))
      DO UPDATE SET klasse = COALESCE(NULLIF(EXCLUDED.klasse, ''), kinder.klasse)
    `, params);
  }

  return {
    uebernommen: zuSchreiben.length,
    meldung: `${zuSchreiben.length} eindeutige Kinder aus den Anmeldungen synchronisiert bzw. zusammengeführt`,
  };
};

module.exports = { synchronisiereKinder, cleanName };
