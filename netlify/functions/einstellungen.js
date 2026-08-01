// Anwendungsweite Einstellungen (Schlüssel/Wert) und das Protokoll der
// automatischen Läufe.
//
// POST { action:'get' }                    -> alle Einstellungen + letzte Läufe
// POST { action:'set', schluessel, wert }  -> eine Einstellung speichern

const { Client } = require('pg');

// Erlaubte Schlüssel — verhindert, dass sich über diesen Endpunkt beliebige
// Daten in der Tabelle ablegen lassen.
const ERLAUBT = {
  automatik_aktiv: (w) => typeof w === 'boolean',
  automatik_empfaenger: (w) => Array.isArray(w) && w.every(x => typeof x === 'string'),
};

const STANDARD = {
  automatik_aktiv: false,
  automatik_empfaenger: [],
};

const getClient = () => new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const respond = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  },
  body: JSON.stringify(body)
});

const validateToken = async (client, event) => {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const result = await client.query(
    'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
    [token]
  );
  return result.rows.length > 0 ? result.rows[0].user_id : null;
};

// Wird auch vom Automatiklauf genutzt.
const leseEinstellungen = async (client) => {
  const werte = { ...STANDARD };
  try {
    const res = await client.query('SELECT schluessel, wert FROM einstellungen');
    for (const r of res.rows) werte[r.schluessel] = r.wert;
  } catch {
    // Tabelle fehlt (Migration nicht gelaufen) — Standardwerte genügen,
    // die Automatik ist dann schlicht aus.
  }
  return werte;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method Not Allowed' });

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    let body;
    try { body = JSON.parse(event.body); }
    catch { return respond(400, { error: 'Ungültiges JSON' }); }

    if (body.action === 'get') {
      const werte = await leseEinstellungen(client);
      let laeufe = [];
      try {
        const res = await client.query(`
          SELECT al.id, al.gestartet_am, al.erfolg, al.meldung, al.kennzahlen, fb.name AS block_name
          FROM automatik_log al
          LEFT JOIN ferienblock fb ON fb.id = al.ferienblock_id
          ORDER BY al.gestartet_am DESC LIMIT 10
        `);
        laeufe = res.rows;
      } catch { /* Tabelle fehlt noch */ }
      return respond(200, { success: true, einstellungen: werte, laeufe });
    }

    if (body.action === 'set') {
      const { schluessel, wert } = body;
      if (!ERLAUBT[schluessel]) return respond(400, { error: `Unbekannte Einstellung: ${schluessel}` });
      if (!ERLAUBT[schluessel](wert)) return respond(400, { error: `Ungültiger Wert für ${schluessel}` });

      await client.query(`
        INSERT INTO einstellungen (schluessel, wert, geaendert_am)
        VALUES ($1, $2, NOW())
        ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert, geaendert_am = NOW()
      `, [schluessel, JSON.stringify(wert)]);

      return respond(200, { success: true });
    }

    return respond(400, { error: 'Unbekannte action' });

  } catch (err) {
    console.error('Einstellungen Fehler:', err.message);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};

module.exports.leseEinstellungen = leseEinstellungen;
module.exports.STANDARD = STANDARD;
