// Ferienblöcke verwalten
// GET    -> alle Blöcke laden
// POST   -> neuen Block erstellen  ODER  { action:'delete', id } -> löschen
// PUT    -> Block bearbeiten

const { Client } = require('pg');

const getClient = () => new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const respond = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
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
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    // GET - alle Ferienblöcke mit Statistiken
    if (event.httpMethod === 'GET') {
      const result = await client.query(`
        SELECT
          f.*,
          (SELECT COUNT(DISTINCT CONCAT(nachname, vorname)) FROM liste_a WHERE ferienblock_id = f.id) as anmeldungen_count,
          (SELECT COUNT(DISTINCT CONCAT(nachname, vorname)) FROM liste_b WHERE ferienblock_id = f.id) as buchungen_count,
          (SELECT COUNT(*) FROM abgleich WHERE ferienblock_id = f.id AND status = 'abgeschlossen') as abgleiche_count
        FROM ferienblock f
        ORDER BY f.startdatum DESC
      `);
      return respond(200, result.rows);
    }

    // POST - neuen Ferienblock erstellen ODER löschen
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // action=delete → Ferienblock löschen (mit Cascade)
      if (body.action === 'delete') {
        const { id } = body;
        if (!id) return respond(400, { error: 'id erforderlich' });
        const delId = parseInt(id, 10);
        if (isNaN(delId)) return respond(400, { error: 'Ungültige ID' });
        await client.query('DELETE FROM ferienblock WHERE id = $1', [delId]);
        return respond(200, { success: true });
      }

      // Neuen Block erstellen
      const { name, startdatum, enddatum, preis_pro_tag } = body;
      if (!name || !startdatum || !enddatum) {
        return respond(400, { error: 'Name, Startdatum und Enddatum erforderlich' });
      }
      const result = await client.query(
        'INSERT INTO ferienblock (name, startdatum, enddatum, preis_pro_tag) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, startdatum, enddatum, preis_pro_tag || 3.50]
      );
      return respond(201, result.rows[0]);
    }

    // PUT - Ferienblock bearbeiten
    if (event.httpMethod === 'PUT') {
      const { id, name, startdatum, enddatum, preis_pro_tag } = JSON.parse(event.body);
      const editId = parseInt(id, 10);
      if (isNaN(editId)) return respond(400, { error: 'Ungültige ID' });
      const result = await client.query(
        'UPDATE ferienblock SET name=$1, startdatum=$2, enddatum=$3, preis_pro_tag=$4 WHERE id=$5 RETURNING *',
        [name, startdatum, enddatum, preis_pro_tag, editId]
      );
      return respond(200, result.rows[0]);
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Ferienblock Fehler:', err);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
