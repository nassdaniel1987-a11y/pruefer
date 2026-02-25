// Finanzberechnung: 3,50€ pro Tag pro Kind aus Liste B
// GET ?ferienblock_id=X -> Finanzübersicht für einen Block

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
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method Not Allowed' });

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    const params = event.queryStringParameters || {};
    const { ferienblock_id } = params;

    if (!ferienblock_id) return respond(400, { error: 'ferienblock_id erforderlich' });
    const fbId = parseInt(ferienblock_id, 10);
    if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });

    // Ferienblock-Info (Preis pro Tag)
    const blockResult = await client.query(
      'SELECT * FROM ferienblock WHERE id = $1',
      [fbId]
    );
    if (blockResult.rows.length === 0) return respond(404, { error: 'Ferienblock nicht gefunden' });
    const block = blockResult.rows[0];
    const preis = parseFloat(block.preis_pro_tag);

    // Pro Kind aus Liste B: Anzahl gebuchter Tage zählen
    const buchungenResult = await client.query(`
      SELECT
        nachname,
        vorname,
        klasse,
        COUNT(*) as tage_gebucht,
        COUNT(*) * $1 as gesamtbetrag,
        MIN(datum) as erster_tag,
        MAX(datum) as letzter_tag,
        ARRAY_AGG(datum ORDER BY datum) as tage,
        ARRAY_AGG(menu ORDER BY datum) as menus,
        MAX(kontostand) as kontostand
      FROM liste_b
      WHERE ferienblock_id = $2
      GROUP BY nachname, vorname, klasse
      ORDER BY nachname, vorname
    `, [preis, fbId]);

    // Gesamtstatistik
    const gesamtKinder = buchungenResult.rows.length;
    const gesamtBuchungen = buchungenResult.rows.reduce((sum, r) => sum + parseInt(r.tage_gebucht), 0);
    const gesamtBetrag = gesamtKinder > 0
      ? buchungenResult.rows.reduce((sum, r) => sum + parseFloat(r.gesamtbetrag), 0)
      : 0;

    // Tage im Ferienblock (für "erwartet")
    const startDate = new Date(block.startdatum);
    const endDate = new Date(block.enddatum);
    const tageImBlock = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Kinder aus Liste A die NICHT in Liste B sind (fehlende Buchungen)
    const fehlendeResult = await client.query(`
      SELECT DISTINCT
        a.nachname, a.vorname, a.klasse,
        COUNT(a.datum) as tage_angemeldet
      FROM liste_a a
      WHERE a.ferienblock_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM liste_b b
          WHERE b.ferienblock_id = $1
            AND LOWER(b.nachname) = LOWER(a.nachname)
            AND LOWER(b.vorname) = LOWER(a.vorname)
        )
      GROUP BY a.nachname, a.vorname, a.klasse
      ORDER BY a.nachname, a.vorname
    `, [fbId]);

    return respond(200, {
      block: {
        id: block.id,
        name: block.name,
        startdatum: block.startdatum,
        enddatum: block.enddatum,
        preis_pro_tag: preis,
        tage_im_block: tageImBlock
      },
      statistik: {
        kinder_mit_buchung: gesamtKinder,
        gesamt_buchungen: gesamtBuchungen,
        gesamt_betrag: Math.round(gesamtBetrag * 100) / 100,
        kinder_ohne_buchung: fehlendeResult.rows.length
      },
      buchungen: buchungenResult.rows,
      fehlende_buchungen: fehlendeResult.rows
    });

  } catch (err) {
    console.error('Finanzen Fehler:', err);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
