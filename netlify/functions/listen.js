// Listen A und B verwalten
// GET  ?ferienblock_id=X&liste=A          -> Einträge laden
// POST { liste, ferienblock_id, eintraege } -> Bulk-Import
// POST { action:'delete', ferienblock_id, liste } -> Leeren

const { Client } = require('pg');

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
        'Access-Control-Allow-Methods': 'GET,POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }

  const params = event.queryStringParameters || {};
  const client = getClient();

  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    // ── GET: Einträge laden ──────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { ferienblock_id, liste } = params;
      if (!ferienblock_id || !liste) {
        return respond(400, { error: 'ferienblock_id und liste erforderlich' });
      }
      const fbId = parseInt(ferienblock_id, 10);
      if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
      const table = liste === 'A' ? 'liste_a' : 'liste_b';
      const extraCols = liste === 'B' ? ', menu, kontostand' : '';
      const result = await client.query(
        `SELECT id, nachname, vorname, klasse, datum${extraCols}, created_at
         FROM ${table}
         WHERE ferienblock_id = $1
         ORDER BY nachname, vorname, datum`,
        [fbId]
      );
      return respond(200, result.rows);
    }

    // ── POST ────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // action=add_day → einzelnen Tag für ein Kind in Liste A eintragen
      if (body.action === 'add_day') {
        const { ferienblock_id, nachname, vorname, klasse, datum } = body;
        if (!ferienblock_id || !nachname || !vorname || !datum) {
          return respond(400, { error: 'ferienblock_id, nachname, vorname, datum erforderlich' });
        }
        const fbId = parseInt(ferienblock_id, 10);
        if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        // Duplikat-Check
        const existing = await client.query(
          `SELECT id FROM liste_a WHERE ferienblock_id=$1 AND LOWER(nachname)=LOWER($2) AND LOWER(vorname)=LOWER($3) AND datum=$4`,
          [fbId, nachname.trim(), vorname.trim(), datum]
        );
        if (existing.rows.length > 0) {
          return respond(200, { success: true, skipped: true });
        }
        await client.query(
          `INSERT INTO liste_a (ferienblock_id, nachname, vorname, klasse, datum) VALUES ($1,$2,$3,$4,$5)`,
          [fbId, nachname.trim(), vorname.trim(), (klasse || '').trim(), datum]
        );
        return respond(200, { success: true });
      }

      // action=remove_day → einzelnen Tag für ein Kind aus Liste A entfernen
      if (body.action === 'remove_day') {
        const { ferienblock_id, nachname, vorname, datum } = body;
        if (!ferienblock_id || !nachname || !vorname || !datum) {
          return respond(400, { error: 'ferienblock_id, nachname, vorname, datum erforderlich' });
        }
        const fbId = parseInt(ferienblock_id, 10);
        if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        await client.query(
          `DELETE FROM liste_a WHERE ferienblock_id=$1 AND LOWER(nachname)=LOWER($2) AND LOWER(vorname)=LOWER($3) AND datum=$4`,
          [fbId, nachname.trim(), vorname.trim(), datum]
        );
        return respond(200, { success: true });
      }

      // action=delete → Liste leeren
      if (body.action === 'delete') {
        const { ferienblock_id, liste } = body;
        if (!ferienblock_id || !liste) {
          return respond(400, { error: 'ferienblock_id und liste erforderlich' });
        }
        const delFbId = parseInt(ferienblock_id, 10);
        if (isNaN(delFbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        const table = liste === 'A' ? 'liste_a' : 'liste_b';
        const result = await client.query(
          `DELETE FROM ${table} WHERE ferienblock_id = $1`,
          [delFbId]
        );
        return respond(200, { success: true, deleted: result.rowCount });
      }

      // Bulk-Import (schnell: 1 Query pro Batch statt 1 pro Zeile)
      const { ferienblock_id, liste, eintraege } = body;
      if (!ferienblock_id || !liste || !Array.isArray(eintraege)) {
        return respond(400, { error: 'ferienblock_id, liste und eintraege erforderlich' });
      }
      const fbIdImport = parseInt(ferienblock_id, 10);
      if (isNaN(fbIdImport)) return respond(400, { error: 'Ungültige ferienblock_id' });
      const table = liste === 'A' ? 'liste_a' : 'liste_b';

      // Bestehende Einträge überschreiben
      await client.query(`DELETE FROM ${table} WHERE ferienblock_id = $1`, [fbIdImport]);

      if (eintraege.length === 0) return respond(200, { success: true, count: 0 });

      // Gültige Einträge filtern
      const valid = eintraege.filter(e => e.nachname && e.datum);
      if (valid.length === 0) return respond(200, { success: true, count: 0 });

      // Batch-Insert: max 200 pro Query (Postgres hat ein Parameter-Limit)
      const BATCH = 200;
      let count = 0;

      for (let i = 0; i < valid.length; i += BATCH) {
        const batch = valid.slice(i, i + BATCH);

        if (liste === 'A') {
          const values = [];
          const params = [];
          let idx = 1;
          for (const e of batch) {
            values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4})`);
            params.push(fbIdImport, e.nachname, e.vorname || '', e.klasse || '', e.datum);
            idx += 5;
          }
          await client.query(
            `INSERT INTO liste_a (ferienblock_id, nachname, vorname, klasse, datum) VALUES ${values.join(',')}`,
            params
          );
        } else {
          const values = [];
          const params = [];
          let idx = 1;
          for (const e of batch) {
            values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6})`);
            params.push(fbIdImport, e.nachname, e.vorname || '', e.klasse || '', e.datum, e.menu || '', e.kontostand || null);
            idx += 7;
          }
          await client.query(
            `INSERT INTO liste_b (ferienblock_id, nachname, vorname, klasse, datum, menu, kontostand) VALUES ${values.join(',')}`,
            params
          );
        }
        count += batch.length;
      }
      return respond(201, { success: true, count });
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Listen Fehler:', err.message);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
