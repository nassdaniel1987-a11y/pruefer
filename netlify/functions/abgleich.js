// Abgleich speichern und laden
// GET  ?ferienblock_id=X          -> Abgleiche des Blocks laden
// GET  ?abgleich_id=X             -> Einzelnen Abgleich mit Matches laden
// POST -> Abgleich-Ergebnis speichern
// GET  ?ferienblock_id=X&action=dashboard -> Dashboard-Statistiken

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
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateToken(client, event);
    if (!userId) return respond(401, { error: 'Nicht autorisiert' });

    const params = event.queryStringParameters || {};

    if (event.httpMethod === 'GET') {

      // Dashboard-Statistiken
      if (params.action === 'dashboard') {
        const blocks = await client.query(`
          SELECT
            f.id, f.name, f.startdatum, f.enddatum, f.preis_pro_tag,
            (SELECT COUNT(*) FROM liste_a WHERE ferienblock_id = f.id) as a_eintraege,
            (SELECT COUNT(*) FROM liste_b WHERE ferienblock_id = f.id) as b_eintraege,
            (SELECT COUNT(*) FROM abgleich WHERE ferienblock_id = f.id AND status = 'abgeschlossen') as abgleiche,
            (
              SELECT COUNT(*) FROM abgleich_matches am
              JOIN abgleich a ON am.abgleich_id = a.id
              WHERE a.ferienblock_id = f.id AND am.match_typ = 'nur_in_a'
              AND a.id = (SELECT id FROM abgleich WHERE ferienblock_id = f.id ORDER BY erstellt_am DESC LIMIT 1)
            ) as fehlend_in_b
          FROM ferienblock f
          ORDER BY f.startdatum DESC
          LIMIT 5
        `);

        const gesamtFehlend = await client.query(`
          SELECT COUNT(*) as count
          FROM abgleich_matches am
          JOIN abgleich a ON am.abgleich_id = a.id
          WHERE am.match_typ = 'nur_in_a'
          AND a.id IN (
            SELECT DISTINCT ON (ferienblock_id) id
            FROM abgleich
            ORDER BY ferienblock_id, erstellt_am DESC
          )
        `);

        return respond(200, {
          blocks: blocks.rows,
          gesamt_fehlend: parseInt(gesamtFehlend.rows[0].count)
        });
      }

      // Einzelnen Abgleich mit allen Matches laden
      if (params.abgleich_id) {
        const aId = parseInt(params.abgleich_id, 10);
        if (isNaN(aId)) return respond(400, { error: 'Ungültige abgleich_id' });
        const abgleich = await client.query(
          'SELECT * FROM abgleich WHERE id = $1',
          [aId]
        );
        if (abgleich.rows.length === 0) return respond(404, { error: 'Nicht gefunden' });

        const matches = await client.query(`
          SELECT
            am.id, am.abgleich_id, am.liste_a_id, am.liste_b_id, am.match_typ, am.score, am.grund,
            COALESCE(la.nachname, am.a_nachname) as a_nachname,
            COALESCE(la.vorname,  am.a_vorname)  as a_vorname,
            COALESCE(la.datum,    am.a_datum)     as a_datum,
            COALESCE(la.klasse,   am.a_klasse)    as a_klasse,
            COALESCE(lb.nachname, am.b_nachname) as b_nachname,
            COALESCE(lb.vorname,  am.b_vorname)  as b_vorname,
            COALESCE(lb.datum,    am.b_datum)     as b_datum,
            COALESCE(lb.klasse,   am.b_klasse)    as b_klasse,
            COALESCE(lb.menu,     am.b_menu)      as b_menu,
            lb.kontostand as b_kontostand
          FROM abgleich_matches am
          LEFT JOIN liste_a la ON am.liste_a_id = la.id
          LEFT JOIN liste_b lb ON am.liste_b_id = lb.id
          WHERE am.abgleich_id = $1
          ORDER BY am.match_typ, am.score DESC
        `, [aId]);

        return respond(200, { abgleich: abgleich.rows[0], matches: matches.rows });
      }

      // Alle Abgleiche eines Ferienblocks
      if (params.ferienblock_id) {
        const fbId = parseInt(params.ferienblock_id, 10);
        if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        const result = await client.query(`
          SELECT
            a.*,
            (SELECT COUNT(*) FROM abgleich_matches WHERE abgleich_id = a.id AND match_typ IN ('exact','fuzzy_accepted')) as matches_count,
            (SELECT COUNT(*) FROM abgleich_matches WHERE abgleich_id = a.id AND match_typ = 'nur_in_a') as nur_in_a_count,
            (SELECT COUNT(*) FROM abgleich_matches WHERE abgleich_id = a.id AND match_typ = 'nur_in_b') as nur_in_b_count,
            (SELECT COUNT(DISTINCT LOWER(
              COALESCE(la.nachname, am2.a_nachname, '') || '|' || COALESCE(la.vorname, am2.a_vorname, '')
             ))
             FROM abgleich_matches am2
             LEFT JOIN liste_a la ON am2.liste_a_id = la.id
             WHERE am2.abgleich_id = a.id AND am2.match_typ IN ('exact','fuzzy_accepted')
            ) as matches_kinder,
            (SELECT COUNT(DISTINCT LOWER(
              COALESCE(la.nachname, am2.a_nachname, '') || '|' || COALESCE(la.vorname, am2.a_vorname, '')
             ))
             FROM abgleich_matches am2
             LEFT JOIN liste_a la ON am2.liste_a_id = la.id
             WHERE am2.abgleich_id = a.id AND am2.match_typ = 'nur_in_a'
            ) as nur_in_a_kinder,
            (SELECT COUNT(DISTINCT LOWER(
              COALESCE(lb.nachname, am2.b_nachname, '') || '|' || COALESCE(lb.vorname, am2.b_vorname, '')
             ))
             FROM abgleich_matches am2
             LEFT JOIN liste_b lb ON am2.liste_b_id = lb.id
             WHERE am2.abgleich_id = a.id AND am2.match_typ = 'nur_in_b'
            ) as nur_in_b_kinder
          FROM abgleich a
          WHERE a.ferienblock_id = $1
          ORDER BY a.erstellt_am DESC
        `, [fbId]);
        return respond(200, result.rows);
      }

      return respond(400, { error: 'Parameter fehlen' });
    }

    // POST - Abgleich-Ergebnis speichern oder löschen
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // ── Delete: Einzelnen Abgleich löschen ──
      if (body.action === 'delete') {
        const delId = parseInt(body.id, 10);
        if (isNaN(delId)) return respond(400, { error: 'Ungültige ID' });
        await client.query('DELETE FROM abgleich_matches WHERE abgleich_id = $1', [delId]);
        await client.query('DELETE FROM abgleich WHERE id = $1', [delId]);
        return respond(200, { success: true });
      }

      // ── Delete All: Alle Abgleiche eines Blocks löschen ──
      if (body.action === 'delete_all') {
        const fbId = parseInt(body.ferienblock_id, 10);
        if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        const abgleiche = await client.query('SELECT id FROM abgleich WHERE ferienblock_id = $1', [fbId]);
        const ids = abgleiche.rows.map(r => r.id);
        if (ids.length > 0) {
          await client.query('DELETE FROM abgleich_matches WHERE abgleich_id = ANY($1)', [ids]);
          await client.query('DELETE FROM abgleich WHERE ferienblock_id = $1', [fbId]);
        }
        return respond(200, { success: true, deleted: ids.length });
      }

      const { ferienblock_id, matches } = body;
      // matches = Array von { liste_a_id, liste_b_id, match_typ, score, grund }

      if (!ferienblock_id || !Array.isArray(matches)) {
        return respond(400, { error: 'ferienblock_id und matches erforderlich' });
      }
      const fbIdPost = parseInt(ferienblock_id, 10);
      if (isNaN(fbIdPost)) return respond(400, { error: 'Ungültige ferienblock_id' });

      // Prüfen ob seit dem letzten Abgleich eine neue Liste hochgeladen wurde
      // → Liste A oder B hat Einträge die NACH dem letzten Abgleich erstellt wurden
      const existingAbgleich = await client.query(
        `SELECT id, veraltet, abgeschlossen_am FROM abgleich WHERE ferienblock_id = $1 ORDER BY erstellt_am DESC LIMIT 1`,
        [fbIdPost]
      );

      let abgleich_id;
      // partial=true → Patch-Modus erzwingen (einzelner Tag, kein neuer Abgleich)
      // partial=false/undefined → prüfen ob neue Liste hochgeladen wurde
      const forcePatch = body.partial === true;
      let istVeraltet = false;

      if (!forcePatch && existingAbgleich.rows.length > 0) {
        const letzterAbgleich = existingAbgleich.rows[0];
        // veraltet-Flag direkt prüfen (gesetzt beim Listen-Upload)
        istVeraltet = letzterAbgleich.veraltet === true;

        // Zusätzlich: prüfen ob eine komplett neue Liste hochgeladen wurde
        // (erkennbar daran dass ALLE liste_b Einträge nach dem letzten Abgleich created wurden)
        if (!istVeraltet && letzterAbgleich.abgeschlossen_am) {
          const neueImporte = await client.query(`
            SELECT 1 FROM (
              SELECT created_at FROM liste_b WHERE ferienblock_id = $1
              ORDER BY created_at DESC LIMIT 1
            ) sub WHERE sub.created_at > $2
          `, [fbIdPost, letzterAbgleich.abgeschlossen_am]);
          if (neueImporte.rows.length > 0) istVeraltet = true;
        }
      }

      if (existingAbgleich.rows.length > 0 && !istVeraltet) {
        // Patch-Modus: nur wenn nicht veraltet — betroffene Tage ermitteln
        abgleich_id = existingAbgleich.rows[0].id;

        const aIds = matches.map(m => m.liste_a_id).filter(Boolean);
        const bIds = matches.map(m => m.liste_b_id).filter(Boolean);

        const affectedDates = new Set();
        if (aIds.length > 0) {
          const aDates = await client.query(
            `SELECT DISTINCT datum FROM liste_a WHERE id = ANY($1)`, [aIds]
          );
          aDates.rows.forEach(r => affectedDates.add(r.datum.toISOString().split('T')[0]));
        }
        if (bIds.length > 0) {
          const bDates = await client.query(
            `SELECT DISTINCT datum FROM liste_b WHERE id = ANY($1)`, [bIds]
          );
          bDates.rows.forEach(r => affectedDates.add(r.datum.toISOString().split('T')[0]));
        }
        // Denormalisierte Daten aus den Matches selbst (für nur-in-A/B ohne Gegenseite)
        matches.forEach(m => {
          if (m.a_datum) affectedDates.add(m.a_datum);
          if (m.b_datum) affectedDates.add(m.b_datum);
        });

        const dateArr = [...affectedDates];
        if (dateArr.length > 0) {
          await client.query(`
            DELETE FROM abgleich_matches
            WHERE abgleich_id = $1
            AND (
              a_datum = ANY($2::date[])
              OR b_datum = ANY($2::date[])
              OR liste_a_id IN (SELECT id FROM liste_a WHERE datum = ANY($2::date[]))
              OR liste_b_id IN (SELECT id FROM liste_b WHERE datum = ANY($2::date[]))
            )
          `, [abgleich_id, dateArr]);
        }

        await client.query(
          `UPDATE abgleich SET abgeschlossen_am = NOW() WHERE id = $1`,
          [abgleich_id]
        );
      } else {
        // Kein bestehender Abgleich, oder veraltet → immer neu anlegen
        const abgleichResult = await client.query(
          "INSERT INTO abgleich (ferienblock_id, status, abgeschlossen_am) VALUES ($1, 'abgeschlossen', NOW()) RETURNING id",
          [fbIdPost]
        );
        abgleich_id = abgleichResult.rows[0].id;
      }

      // Alle Matches per Batch speichern (schnell)
      if (matches.length > 0) {
        const BATCH = 150;
        for (let i = 0; i < matches.length; i += BATCH) {
          const batch = matches.slice(i, i + BATCH);
          const values = [];
          const params = [];
          let idx = 1;
          for (const m of batch) {
            values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5})`);
            params.push(abgleich_id, m.liste_a_id || null, m.liste_b_id || null, m.match_typ, m.score || null, m.grund || null);
            idx += 6;
          }
          await client.query(
            `INSERT INTO abgleich_matches (abgleich_id, liste_a_id, liste_b_id, match_typ, score, grund) VALUES ${values.join(',')}`,
            params
          );
        }
      }

      // Namen direkt in abgleich_matches speichern (für spätere Vergleiche)
      try {
        await client.query(`
          UPDATE abgleich_matches am SET
            a_nachname = la.nachname,
            a_vorname  = la.vorname,
            a_datum    = la.datum,
            a_klasse   = la.klasse
          FROM liste_a la
          WHERE am.abgleich_id = $1 AND am.liste_a_id = la.id
        `, [abgleich_id]);

        await client.query(`
          UPDATE abgleich_matches am SET
            b_nachname = lb.nachname,
            b_vorname  = lb.vorname,
            b_datum    = lb.datum,
            b_klasse   = lb.klasse,
            b_menu     = lb.menu
          FROM liste_b lb
          WHERE am.abgleich_id = $1 AND am.liste_b_id = lb.id
        `, [abgleich_id]);
      } catch (e) {
        // Spalten existieren evtl. noch nicht (vor Migration 3) - kein Fehler
        console.log('Namen-Spalten nicht verfügbar:', e.message);
      }

      // Abgleich ist jetzt aktuell
      await client.query(`UPDATE abgleich SET veraltet = FALSE WHERE id = $1`, [abgleich_id]);

      return respond(201, { success: true, abgleich_id, patched: existingAbgleich.rows.length > 0 && !istVeraltet });
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Abgleich Fehler:', err);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
