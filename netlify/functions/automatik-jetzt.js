// Löst denselben Ablauf wie der geplante Lauf sofort aus.
//
// Nötig, weil eine über schedule() gekapselte Function nur vom Netlify-Planer
// aufgerufen werden kann, nicht per HTTP. Der eigentliche Ablauf liegt in
// taeglicher-abgleich.js und wird hier nur angestoßen — es gibt ihn also
// weiterhin nur einmal.
//
// POST { }  -> führt den Lauf aus, auch wenn die Automatik ausgeschaltet ist

const { Client } = require('pg');
const { fuehreAus, protokolliere, berlinJetzt } = require('./taeglicher-abgleich');

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

    const { datum } = berlinJetzt();
    // erzwingen: der Testlauf soll auch bei ausgeschalteter Automatik gehen.
    const r = await fuehreAus(client, { heute: datum, erzwingen: true });

    if (r.uebersprungen) {
      await protokolliere(client, { erfolg: true, meldung: r.meldung });
      return respond(200, { success: true, uebersprungen: true, meldung: r.meldung });
    }

    await protokolliere(client, {
      ferienblockId: r.block.id,
      erfolg: r.mailOk,
      meldung: r.meldung,
      kennzahlen: r.kennzahlen,
    });

    return respond(200, {
      success: true,
      uebersprungen: false,
      mail_ok: r.mailOk,
      meldung: r.meldung,
      block: r.block.name,
      kennzahlen: r.kennzahlen,
    });

  } catch (err) {
    console.error('Testlauf fehlgeschlagen:', err.message);
    try { await protokolliere(client, { erfolg: false, meldung: err.message }); } catch { /* egal */ }
    return respond(500, { error: err.message });
  } finally {
    try { await client.end(); } catch { /* egal */ }
  }
};
