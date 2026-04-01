// Angebote-Verwaltung
// GET                          -> alle Angebote (optional ?ferienblock_id=X)
// GET ?id=X                    -> Einzelnes Angebot mit Tagen, Kindern + Buchungsstatus
// POST action:create           -> Angebot erstellen (inkl. tage:[])
// POST action:edit             -> Angebot bearbeiten (inkl. tage:[])
// POST action:delete           -> Angebot löschen
// POST action:add_kind         -> Kind zum Angebot hinzufügen
// POST action:remove_kind      -> Kind aus Angebot entfernen

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

// Tage für ein Angebot komplett ersetzen
const saveTage = async (client, angebotId, tage) => {
  await client.query('DELETE FROM angebot_tage WHERE angebot_id = $1', [angebotId]);
  if (!Array.isArray(tage) || tage.length === 0) return;
  const values = tage.map((d, i) => `($1, $${i + 2})`).join(', ');
  await client.query(
    `INSERT INTO angebot_tage (angebot_id, datum) VALUES ${values} ON CONFLICT DO NOTHING`,
    [angebotId, ...tage]
  );
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

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    const params = event.queryStringParameters || {};

    // ═══════════════════════════════════════════════════════════
    // GET
    // ═══════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET') {

      // ── Einzelnes Angebot mit Tagen, Kindern + Buchungsstatus ──
      if (params.id) {
        const angebotId = parseInt(params.id, 10);
        if (isNaN(angebotId)) return respond(400, { error: 'Ungültige ID' });

        const angebotRes = await client.query(`
          SELECT a.*, f.name as block_name, f.startdatum, f.enddatum, f.preis_pro_tag
          FROM angebote a
          JOIN ferienblock f ON a.ferienblock_id = f.id
          WHERE a.id = $1
        `, [angebotId]);

        if (angebotRes.rows.length === 0) return respond(404, { error: 'Angebot nicht gefunden' });
        const angebot = angebotRes.rows[0];
        const fbId = angebot.ferienblock_id;

        // Tage dieses Angebots laden
        const tageRes = await client.query(
          'SELECT datum FROM angebot_tage WHERE angebot_id = $1 ORDER BY datum',
          [angebotId]
        );
        const angebotTage = tageRes.rows.map(r => new Date(r.datum).toISOString().slice(0, 10));

        // Kinder des Angebots laden
        const kinderRes = await client.query(`
          SELECT k.id, k.nachname, k.vorname, k.klasse, k.notizen
          FROM angebot_kinder ak
          JOIN kinder k ON ak.kind_id = k.id
          WHERE ak.angebot_id = $1
          ORDER BY k.nachname, k.vorname
        `, [angebotId]);

        // Pro Kind: Buchungsstatus NUR für die Angebots-Tage prüfen
        const kinderMitStatus = await Promise.all(kinderRes.rows.map(async (kind) => {

          // Liste A: nur Angebots-Tage
          const listeARes = await client.query(`
            SELECT datum FROM liste_a
            WHERE ferienblock_id = $1
              AND datum = ANY($2::date[])
              AND (
                (LOWER(nachname) = LOWER($3) AND LOWER(vorname) = LOWER($4))
                OR (LOWER(nachname) = LOWER($4) AND LOWER(vorname) = LOWER($3))
              )
            ORDER BY datum
          `, [fbId, angebotTage, kind.nachname, kind.vorname]);

          // Liste B: nur Angebots-Tage
          const listeBRes = await client.query(`
            SELECT datum, menu FROM liste_b
            WHERE ferienblock_id = $1
              AND datum = ANY($2::date[])
              AND (
                (LOWER(nachname) = LOWER($3) AND LOWER(vorname) = LOWER($4))
                OR (LOWER(nachname) = LOWER($4) AND LOWER(vorname) = LOWER($3))
              )
            ORDER BY datum
          `, [fbId, angebotTage, kind.nachname, kind.vorname]);

          const tageA = listeARes.rows.map(r => new Date(r.datum).toISOString().slice(0, 10));
          const tageB = listeBRes.rows.map(r => new Date(r.datum).toISOString().slice(0, 10));

          // Angebots-Tage wo Kind in A aber nicht in B steht
          const nurInA = tageA.filter(d => !tageB.includes(d));
          // Angebots-Tage wo Kind in B aber nicht in A steht
          const nurInB = tageB.filter(d => !tageA.includes(d));
          // Angebots-Tage wo Kind gar nicht vorkommt
          const fehlend = angebotTage.filter(d => !tageA.includes(d) && !tageB.includes(d));

          let status;
          if (tageA.length === 0 && tageB.length === 0) {
            status = 'nicht_vorhanden';
          } else if (tageA.length === 0) {
            status = 'nur_gebucht';
          } else if (tageB.length === 0) {
            status = 'nicht_gebucht';
          } else if (nurInA.length === 0 && nurInB.length === 0) {
            status = 'vollstaendig';
          } else {
            status = 'teilweise';
          }

          return {
            ...kind,
            tage_liste_a: tageA,
            tage_liste_b: tageB,
            nur_in_a: nurInA,
            nur_in_b: nurInB,
            fehlend,
            status
          };
        }));

        const summary = {
          gesamt: kinderMitStatus.length,
          vollstaendig: kinderMitStatus.filter(k => k.status === 'vollstaendig').length,
          teilweise: kinderMitStatus.filter(k => k.status === 'teilweise').length,
          nicht_gebucht: kinderMitStatus.filter(k => k.status === 'nicht_gebucht').length,
          nur_gebucht: kinderMitStatus.filter(k => k.status === 'nur_gebucht').length,
          nicht_vorhanden: kinderMitStatus.filter(k => k.status === 'nicht_vorhanden').length
        };

        return respond(200, {
          angebot: { ...angebot, tage: angebotTage },
          kinder: kinderMitStatus,
          summary
        });
      }

      // ── Alle Angebote (optional nach Ferienblock gefiltert) ──
      const fbFilter = params.ferienblock_id ? parseInt(params.ferienblock_id, 10) : null;

      let query = `
        SELECT a.*, f.name as block_name, f.startdatum, f.enddatum,
          (SELECT COUNT(*) FROM angebot_kinder ak WHERE ak.angebot_id = a.id) as kinder_count,
          (SELECT COUNT(*) FROM angebot_tage at2 WHERE at2.angebot_id = a.id) as tage_count
        FROM angebote a
        JOIN ferienblock f ON a.ferienblock_id = f.id
      `;
      const queryParams = [];

      if (fbFilter && !isNaN(fbFilter)) {
        query += ' WHERE a.ferienblock_id = $1';
        queryParams.push(fbFilter);
      }

      query += ' ORDER BY f.startdatum DESC, a.name';

      const angeboteRes = await client.query(query, queryParams);
      return respond(200, angeboteRes.rows);
    }

    // ═══════════════════════════════════════════════════════════
    // POST
    // ═══════════════════════════════════════════════════════════
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // ── Angebot erstellen ──
      if (body.action === 'create') {
        const { name, ferienblock_id, beschreibung, tage } = body;
        if (!name || !ferienblock_id) return respond(400, { error: 'name und ferienblock_id erforderlich' });

        const result = await client.query(
          'INSERT INTO angebote (name, ferienblock_id, beschreibung) VALUES ($1, $2, $3) RETURNING *',
          [name.trim(), parseInt(ferienblock_id, 10), beschreibung?.trim() || null]
        );
        const angebot = result.rows[0];
        if (Array.isArray(tage) && tage.length > 0) {
          await saveTage(client, angebot.id, tage);
        }
        return respond(200, { success: true, angebot });
      }

      // ── Angebot bearbeiten ──
      if (body.action === 'edit') {
        const { id, name, beschreibung, tage } = body;
        if (!id) return respond(400, { error: 'id erforderlich' });

        const result = await client.query(
          'UPDATE angebote SET name = COALESCE($1, name), beschreibung = $2 WHERE id = $3 RETURNING *',
          [name?.trim() || null, beschreibung?.trim() || null, parseInt(id, 10)]
        );
        if (result.rows.length === 0) return respond(404, { error: 'Angebot nicht gefunden' });
        if (Array.isArray(tage)) {
          await saveTage(client, parseInt(id, 10), tage);
        }
        return respond(200, { success: true, angebot: result.rows[0] });
      }

      // ── Angebot löschen ──
      if (body.action === 'delete') {
        const { id } = body;
        if (!id) return respond(400, { error: 'id erforderlich' });
        await client.query('DELETE FROM angebote WHERE id = $1', [parseInt(id, 10)]);
        return respond(200, { success: true });
      }

      // ── Kind zum Angebot hinzufügen ──
      if (body.action === 'add_kind') {
        const { angebot_id, kind_id } = body;
        if (!angebot_id || !kind_id) return respond(400, { error: 'angebot_id und kind_id erforderlich' });

        await client.query(
          'INSERT INTO angebot_kinder (angebot_id, kind_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [parseInt(angebot_id, 10), parseInt(kind_id, 10)]
        );
        return respond(200, { success: true });
      }

      // ── Kind aus Angebot entfernen ──
      if (body.action === 'remove_kind') {
        const { angebot_id, kind_id } = body;
        if (!angebot_id || !kind_id) return respond(400, { error: 'angebot_id und kind_id erforderlich' });

        await client.query(
          'DELETE FROM angebot_kinder WHERE angebot_id = $1 AND kind_id = $2',
          [parseInt(angebot_id, 10), parseInt(kind_id, 10)]
        );
        return respond(200, { success: true });
      }

      return respond(400, { error: 'Unbekannte action' });
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Angebote Fehler:', err);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
