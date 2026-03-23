// Komplett-Backup: Export und Import aller Daten
// GET  -> Alle Tabellen als JSON exportieren
// POST { action:'import', data:{...} } -> Alle Daten wiederherstellen

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

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    // ── GET: Komplett-Export ────────────────────────────
    if (event.httpMethod === 'GET') {
      const ferienblock = await client.query('SELECT * FROM ferienblock ORDER BY id');
      const liste_a = await client.query('SELECT * FROM liste_a ORDER BY id');
      const liste_b = await client.query('SELECT * FROM liste_b ORDER BY id');
      const abgleich = await client.query('SELECT * FROM abgleich ORDER BY id');
      const abgleich_matches = await client.query('SELECT * FROM abgleich_matches ORDER BY id');

      // Kinder-Tabelle nur wenn sie existiert
      let kinder = { rows: [] };
      try {
        kinder = await client.query('SELECT * FROM kinder ORDER BY id');
      } catch (e) { /* Tabelle existiert ggf. noch nicht */ }

      return respond(200, {
        version: '1.0',
        exported_at: new Date().toISOString(),
        data: {
          ferienblock: ferienblock.rows,
          liste_a: liste_a.rows,
          liste_b: liste_b.rows,
          abgleich: abgleich.rows,
          abgleich_matches: abgleich_matches.rows,
          kinder: kinder.rows
        }
      });
    }

    // ── POST: Import / Restore ─────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      if (body.action !== 'import' || !body.data) {
        return respond(400, { error: 'action=import und data erforderlich' });
      }

      const d = body.data;
      const counts = {};

      // Reihenfolge beachten wegen Foreign Keys
      // 1. Erst abhängige Tabellen leeren
      await client.query('DELETE FROM abgleich_matches');
      await client.query('DELETE FROM abgleich');
      await client.query('DELETE FROM liste_a');
      await client.query('DELETE FROM liste_b');
      try { await client.query('DELETE FROM kinder'); } catch (e) {}
      await client.query('DELETE FROM ferienblock');

      // 2. Ferienblöcke einfügen
      if (d.ferienblock && d.ferienblock.length > 0) {
        for (const f of d.ferienblock) {
          await client.query(
            `INSERT INTO ferienblock (id, name, startdatum, enddatum, preis_pro_tag, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [f.id, f.name, f.startdatum, f.enddatum, f.preis_pro_tag || 0, f.created_at || new Date()]
          );
        }
        // Sequenz aktualisieren
        await client.query(`SELECT setval('ferienblock_id_seq', (SELECT COALESCE(MAX(id),0) FROM ferienblock))`);
        counts.ferienblock = d.ferienblock.length;
      }

      // 3. Listen einfügen (Batch)
      const insertBatch = async (table, rows, cols, mapFn) => {
        if (!rows || rows.length === 0) return 0;
        const BATCH = 150;
        let total = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const values = [];
          const params = [];
          let idx = 1;
          for (const r of batch) {
            const mapped = mapFn(r);
            const placeholders = mapped.map(() => `$${idx++}`);
            values.push(`(${placeholders.join(',')})`);
            params.push(...mapped);
          }
          await client.query(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`,
            params
          );
          total += batch.length;
        }
        return total;
      };

      if (d.liste_a && d.liste_a.length > 0) {
        counts.liste_a = await insertBatch('liste_a', d.liste_a,
          ['id', 'ferienblock_id', 'nachname', 'vorname', 'klasse', 'datum', 'created_at'],
          r => [r.id, r.ferienblock_id, r.nachname, r.vorname || '', r.klasse || '', r.datum, r.created_at || new Date()]
        );
        await client.query(`SELECT setval('liste_a_id_seq', (SELECT COALESCE(MAX(id),0) FROM liste_a))`);
      }

      if (d.liste_b && d.liste_b.length > 0) {
        counts.liste_b = await insertBatch('liste_b', d.liste_b,
          ['id', 'ferienblock_id', 'nachname', 'vorname', 'klasse', 'datum', 'menu', 'kontostand', 'created_at'],
          r => [r.id, r.ferienblock_id, r.nachname, r.vorname || '', r.klasse || '', r.datum, r.menu || '', r.kontostand || null, r.created_at || new Date()]
        );
        await client.query(`SELECT setval('liste_b_id_seq', (SELECT COALESCE(MAX(id),0) FROM liste_b))`);
      }

      // 4. Kinder einfügen
      if (d.kinder && d.kinder.length > 0) {
        try {
          counts.kinder = await insertBatch('kinder', d.kinder,
            ['id', 'nachname', 'vorname', 'klasse', 'notizen', 'created_at'],
            r => [r.id, r.nachname, r.vorname || '', r.klasse || '', r.notizen || '', r.created_at || new Date()]
          );
          await client.query(`SELECT setval('kinder_id_seq', (SELECT COALESCE(MAX(id),0) FROM kinder))`);
        } catch (e) { counts.kinder_error = e.message; }
      }

      // 5. Abgleiche einfügen
      if (d.abgleich && d.abgleich.length > 0) {
        for (const a of d.abgleich) {
          await client.query(
            `INSERT INTO abgleich (id, ferienblock_id, status, erstellt_am, abgeschlossen_am)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [a.id, a.ferienblock_id, a.status || 'abgeschlossen', a.erstellt_am || new Date(), a.abgeschlossen_am]
          );
        }
        await client.query(`SELECT setval('abgleich_id_seq', (SELECT COALESCE(MAX(id),0) FROM abgleich))`);
        counts.abgleich = d.abgleich.length;
      }

      if (d.abgleich_matches && d.abgleich_matches.length > 0) {
        counts.abgleich_matches = await insertBatch('abgleich_matches', d.abgleich_matches,
          ['id', 'abgleich_id', 'liste_a_id', 'liste_b_id', 'match_typ', 'score', 'grund',
           'a_nachname', 'a_vorname', 'a_datum', 'a_klasse', 'b_nachname', 'b_vorname', 'b_datum', 'b_klasse', 'b_menu'],
          r => [r.id, r.abgleich_id, r.liste_a_id || null, r.liste_b_id || null, r.match_typ, r.score || null, r.grund || null,
                r.a_nachname || null, r.a_vorname || null, r.a_datum || null, r.a_klasse || null,
                r.b_nachname || null, r.b_vorname || null, r.b_datum || null, r.b_klasse || null, r.b_menu || null]
        );
        await client.query(`SELECT setval('abgleich_matches_id_seq', (SELECT COALESCE(MAX(id),0) FROM abgleich_matches))`);
      }

      return respond(200, { success: true, counts });
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Backup Fehler:', err.message);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
