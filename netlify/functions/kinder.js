// Kinder-Verzeichnis (Stammdaten + Akten)
// GET                -> alle Kinder mit Statistiken
// GET ?id=X          -> Einzelne Akte (alle Blöcke, Anmeldungen, Buchungen)
// POST action:import -> Excel-Import (Array von {nachname, vorname, klasse})
// POST action:sync   -> Aus bestehenden Listen A synchronisieren
// POST action:edit   -> Kind bearbeiten
// POST action:delete -> Kind aus Stamm löschen

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

// Prüft ob ein Name schon in der kinder-Tabelle existiert (auch vertauscht)
const findExistingKind = async (client, nachname, vorname) => {
  const result = await client.query(`
    SELECT id, nachname, vorname FROM kinder
    WHERE (LOWER(nachname) = LOWER($1) AND LOWER(vorname) = LOWER($2))
       OR (LOWER(nachname) = LOWER($2) AND LOWER(vorname) = LOWER($1))
    LIMIT 1
  `, [nachname.trim(), vorname.trim()]);
  return result.rows.length > 0 ? result.rows[0] : null;
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
    // GET — Kinder laden
    // ═══════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET') {

      // ── Einzelne Akte ──
      if (params.id) {
        const kindId = parseInt(params.id, 10);
        if (isNaN(kindId)) return respond(400, { error: 'Ungültige ID' });
        const kindResult = await client.query('SELECT * FROM kinder WHERE id = $1', [kindId]);
        if (kindResult.rows.length === 0) return respond(404, { error: 'Kind nicht gefunden' });
        const kind = kindResult.rows[0];

        // Alle Ferienblöcke holen
        const blocksResult = await client.query('SELECT * FROM ferienblock ORDER BY startdatum DESC');

        // Fuzzy-Aliases für dieses Kind finden (aus abgleich_matches)
        const aliasResult = await client.query(`
          SELECT DISTINCT
            LOWER(lb.nachname) as b_nachname, LOWER(lb.vorname) as b_vorname
          FROM abgleich_matches am
          JOIN abgleich a ON am.abgleich_id = a.id
          JOIN liste_a la ON am.liste_a_id = la.id
          JOIN liste_b lb ON am.liste_b_id = lb.id
          WHERE am.match_typ = 'fuzzy_accepted'
            AND am.liste_a_id IS NOT NULL AND am.liste_b_id IS NOT NULL
            AND (
              (LOWER(la.nachname) = LOWER($1) AND LOWER(la.vorname) = LOWER($2))
              OR (LOWER(la.nachname) = LOWER($2) AND LOWER(la.vorname) = LOWER($1))
            )
        `, [kind.nachname, kind.vorname]);

        // Name-Varianten sammeln (eigener Name + Aliases)
        const nameVariants = [
          { n: kind.nachname.toLowerCase(), v: kind.vorname.toLowerCase() }
        ];
        // Auch vertauschte Version
        nameVariants.push({ n: kind.vorname.toLowerCase(), v: kind.nachname.toLowerCase() });

        for (const alias of aliasResult.rows) {
          nameVariants.push({ n: alias.b_nachname, v: alias.b_vorname });
          nameVariants.push({ n: alias.b_vorname, v: alias.b_nachname });
        }

        // SQL WHERE-Bedingung für alle Varianten bauen
        const whereParts = [];
        const whereParams = [];
        let paramIdx = 1;
        for (const v of nameVariants) {
          whereParts.push(`(LOWER(nachname) = $${paramIdx} AND LOWER(vorname) = $${paramIdx + 1})`);
          whereParams.push(v.n, v.v);
          paramIdx += 2;
        }
        const whereClause = whereParts.join(' OR ');

        // Pro Block: Anmeldungen + Buchungen laden
        const blocks = [];
        let totalAnmeldungen = 0;
        let totalBuchungen = 0;
        let totalKosten = 0;

        for (const block of blocksResult.rows) {
          const aResult = await client.query(
            `SELECT id, nachname, vorname, klasse, datum, created_at
             FROM liste_a
             WHERE ferienblock_id = $${paramIdx} AND (${whereClause})
             ORDER BY datum`,
            [...whereParams, block.id]
          );

          const bQuery = `
            SELECT id, nachname, vorname, klasse, datum, menu, kontostand, created_at
            FROM liste_b
            WHERE ferienblock_id = $${paramIdx} AND (${whereClause})
            ORDER BY datum
          `;
          const bResult = await client.query(bQuery, [...whereParams, block.id]);

          // Nur Blöcke einbeziehen wo das Kind vorkommt
          if (aResult.rows.length === 0 && bResult.rows.length === 0) continue;

          // Match-Status ermitteln (aus letztem Abgleich)
          // Parameter-Nummern korrekt aufbauen: $1=block.id, dann whereParams für liste_a, dann whereParams für liste_b
          const abglParams = [block.id];
          let abglIdx = 2;

          // whereClause für liste_a mit korrekten Parameter-Nummern
          const wherePartsA = [];
          for (const v of nameVariants) {
            wherePartsA.push(`(LOWER(nachname) = $${abglIdx} AND LOWER(vorname) = $${abglIdx + 1})`);
            abglParams.push(v.n, v.v);
            abglIdx += 2;
          }
          const whereClauseA = wherePartsA.join(' OR ');

          // whereClause für liste_b mit korrekten Parameter-Nummern
          const wherePartsB = [];
          for (const v of nameVariants) {
            wherePartsB.push(`(LOWER(nachname) = $${abglIdx} AND LOWER(vorname) = $${abglIdx + 1})`);
            abglParams.push(v.n, v.v);
            abglIdx += 2;
          }
          const whereClauseB = wherePartsB.join(' OR ');

          const abglResult = await client.query(`
            SELECT am.match_typ, am.score
            FROM abgleich_matches am
            JOIN abgleich a ON am.abgleich_id = a.id
            WHERE a.ferienblock_id = $1
              AND a.id = (SELECT id FROM abgleich WHERE ferienblock_id = $1 ORDER BY erstellt_am DESC LIMIT 1)
              AND (
                am.liste_a_id IN (SELECT id FROM liste_a WHERE ferienblock_id = $1 AND (${whereClauseA}))
                OR am.liste_b_id IN (SELECT id FROM liste_b WHERE ferienblock_id = $1 AND (${whereClauseB}))
              )
            LIMIT 1
          `, abglParams);

          const preis = parseFloat(block.preis_pro_tag);
          const blockKosten = bResult.rows.length * preis;

          blocks.push({
            ferienblock_id: block.id,
            block_name: block.name,
            startdatum: block.startdatum,
            enddatum: block.enddatum,
            preis_pro_tag: preis,
            anmeldungen: aResult.rows,
            buchungen: bResult.rows,
            klasse: aResult.rows[0]?.klasse || bResult.rows[0]?.klasse || kind.klasse || '',
            kosten: Math.round(blockKosten * 100) / 100,
            match_status: abglResult.rows.length > 0 ? abglResult.rows[0].match_typ : null
          });

          totalAnmeldungen += aResult.rows.length;
          totalBuchungen += bResult.rows.length;
          totalKosten += blockKosten;
        }

        const aliases = aliasResult.rows.map(a => `${a.b_nachname} ${a.b_vorname}`);

        return respond(200, {
          kind: {
            id: kind.id,
            nachname: kind.nachname,
            vorname: kind.vorname,
            klasse: kind.klasse,
            notizen: kind.notizen,
            created_at: kind.created_at
          },
          aliases: [...new Set(aliases)],
          blocks,
          summary: {
            total_blocks: blocks.length,
            total_anmeldungen: totalAnmeldungen,
            total_buchungen: totalBuchungen,
            total_kosten: Math.round(totalKosten * 100) / 100
          }
        });
      }

      // ── Alle Kinder mit Statistiken ──
      // Optional: ferienblock_id Filter
      const fbParsed = params.ferienblock_id ? parseInt(params.ferienblock_id, 10) : null;
      const fbFilter = fbParsed && !isNaN(fbParsed) ? fbParsed : null;
      const fbCondA = fbFilter ? 'AND la.ferienblock_id = ' + fbFilter : '';
      const fbCondB = fbFilter ? 'AND lb.ferienblock_id = ' + fbFilter : '';

      const kinderResult = await client.query(`
        SELECT
          k.*,
          (SELECT COUNT(DISTINCT la.ferienblock_id)
           FROM liste_a la
           WHERE ((LOWER(la.nachname) = LOWER(k.nachname) AND LOWER(la.vorname) = LOWER(k.vorname))
              OR (LOWER(la.nachname) = LOWER(k.vorname) AND LOWER(la.vorname) = LOWER(k.nachname)))
              ${fbCondA}
          ) as block_count_a,
          (SELECT COUNT(*)
           FROM liste_a la
           WHERE ((LOWER(la.nachname) = LOWER(k.nachname) AND LOWER(la.vorname) = LOWER(k.vorname))
              OR (LOWER(la.nachname) = LOWER(k.vorname) AND LOWER(la.vorname) = LOWER(k.nachname)))
              ${fbCondA}
          ) as anmeldungen_count,
          (SELECT COUNT(*)
           FROM liste_b lb
           WHERE ((LOWER(lb.nachname) = LOWER(k.nachname) AND LOWER(lb.vorname) = LOWER(k.vorname))
              OR (LOWER(lb.nachname) = LOWER(k.vorname) AND LOWER(lb.vorname) = LOWER(k.nachname)))
              ${fbCondB}
          ) as buchungen_count
        FROM kinder k
        ORDER BY k.nachname, k.vorname
      `);

      return respond(200, kinderResult.rows);
    }

    // ═══════════════════════════════════════════════════════════
    // POST — Kinder verwalten
    // ═══════════════════════════════════════════════════════════
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // ── Import: Excel-Daten einfügen (schnell mit Batch) ──
      if (body.action === 'import') {
        const { eintraege } = body;
        if (!Array.isArray(eintraege)) return respond(400, { error: 'eintraege Array erforderlich' });

        // Alle existierenden Kinder laden (1 Query statt N)
        const existingResult = await client.query('SELECT id, LOWER(nachname) as n, LOWER(vorname) as v, klasse FROM kinder');
        const existingSet = new Set();
        const existingMap = new Map();
        const buildKey = (n, v) => (String(n||'') + ' ' + String(v||'')).toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,' ').split(/\s+/).filter(Boolean).sort().join('|');
        for (const row of existingResult.rows) {
          const key = buildKey(row.n, row.v);
          existingSet.add(key);
          existingMap.set(key, row);
        }

        const toInsert = [];
        let skipped = 0;
        const skippedNames = [];
        const klasseUpdates = [];

        for (const e of eintraege) {
          if (!e.nachname || !e.vorname) { skipped++; continue; }
          const key = buildKey(e.nachname, e.vorname);
          if (existingSet.has(key)) {
            skipped++;
            const ex = existingMap.get(key);
            if (ex) skippedNames.push(`${e.nachname} ${e.vorname}`);
            if (e.klasse && ex && !ex.klasse) klasseUpdates.push({ id: ex.id, klasse: e.klasse.trim() });
            continue;
          }
          // Als "schon gesehen" markieren damit keine Duplikate im Batch
          existingSet.add(key);
          toInsert.push({ nachname: e.nachname.trim(), vorname: e.vorname.trim(), klasse: e.klasse?.trim() || null });
        }

        // Klassen in einem Batch updaten
        for (const u of klasseUpdates) {
          await client.query('UPDATE kinder SET klasse = $1 WHERE id = $2', [u.klasse, u.id]);
        }

        // Batch-INSERT: max 200 pro Query
        const BATCH = 200;
        let inserted = 0;
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH);
          const values = [];
          const params = [];
          let idx = 1;
          for (const e of batch) {
            values.push(`($${idx},$${idx+1},$${idx+2})`);
            params.push(e.nachname, e.vorname, e.klasse);
            idx += 3;
          }
          try {
            await client.query(`INSERT INTO kinder (nachname, vorname, klasse) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`, params);
            inserted += batch.length;
          } catch (insertErr) {
            // Einzeln einfügen als Fallback bei Fehlern
            for (const e of batch) {
              try {
                await client.query('INSERT INTO kinder (nachname, vorname, klasse) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [e.nachname, e.vorname, e.klasse]);
                inserted++;
              } catch (_) { skipped++; }
            }
          }
        }

        return respond(200, {
          success: true,
          inserted,
          skipped,
          skipped_names: skippedNames.slice(0, 10),
          message: `${inserted} Kinder importiert, ${skipped} übersprungen (existieren bereits)`
        });
      }

      // ── Sync: Aus bestehenden Listen A automatisch übernehmen (schnell) ──
      if (body.action === 'sync') {
        // Alle eindeutigen Kinder aus liste_a holen (1 Query)
        const listeAKinder = await client.query(`
          SELECT nachname, vorname, MAX(klasse) as klasse
          FROM liste_a
          GROUP BY LOWER(nachname), LOWER(vorname), nachname, vorname
        `);

        // Alle existierenden Kinder laden (1 Query)
        const existingResult = await client.query('SELECT id, LOWER(nachname) as n, LOWER(vorname) as v, klasse FROM kinder');
        const existingSet = new Set();
        const existingMap = new Map();
        const buildKey = (n, v) => (String(n||'') + ' ' + String(v||'')).toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,' ').split(/\s+/).filter(Boolean).sort().join('|');
        for (const row of existingResult.rows) {
          const key = buildKey(row.n, row.v);
          existingSet.add(key);
          existingMap.set(key, row);
        }

        const toInsert = [];
        let skipped = 0;
        const klasseUpdates = [];

        for (const e of listeAKinder.rows) {
          const key = buildKey(e.nachname, e.vorname);
          if (existingSet.has(key)) {
            skipped++;
            const ex = existingMap.get(key);
            if (e.klasse && ex && !ex.klasse) klasseUpdates.push({ id: ex.id, klasse: e.klasse.trim() });
            continue;
          }
          existingSet.add(key);
          toInsert.push({ nachname: e.nachname.trim(), vorname: e.vorname.trim(), klasse: e.klasse?.trim() || null });
        }

        // Klassen updaten
        for (const u of klasseUpdates) {
          await client.query('UPDATE kinder SET klasse = $1 WHERE id = $2', [u.klasse, u.id]);
        }

        // Batch-INSERT
        const BATCH = 200;
        let inserted = 0;
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH);
          const values = [];
          const params = [];
          let idx = 1;
          for (const e of batch) {
            values.push(`($${idx},$${idx+1},$${idx+2})`);
            params.push(e.nachname, e.vorname, e.klasse);
            idx += 3;
          }
          try {
            await client.query(`INSERT INTO kinder (nachname, vorname, klasse) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`, params);
            inserted += batch.length;
          } catch (_) {
            for (const e of batch) {
              try { await client.query('INSERT INTO kinder (nachname, vorname, klasse) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [e.nachname, e.vorname, e.klasse]); inserted++; }
              catch (__) { skipped++; }
            }
          }
        }

        return respond(200, {
          success: true,
          inserted,
          skipped,
          message: `${inserted} Kinder aus Listen übernommen, ${skipped} existierten bereits`
        });
      }

      // ── Edit: Kind bearbeiten ──
      if (body.action === 'edit') {
        const { id, nachname, vorname, klasse, notizen } = body;
        if (!id) return respond(400, { error: 'id erforderlich' });
        const editId = parseInt(id, 10);
        if (isNaN(editId)) return respond(400, { error: 'Ungültige ID' });
        const result = await client.query(
          'UPDATE kinder SET nachname = COALESCE($1, nachname), vorname = COALESCE($2, vorname), klasse = $3, notizen = $4 WHERE id = $5 RETURNING *',
          [nachname, vorname, klasse || null, notizen || null, editId]
        );
        if (result.rows.length === 0) return respond(404, { error: 'Kind nicht gefunden' });
        return respond(200, { success: true, kind: result.rows[0] });
      }

      // ── Delete: Kind aus Stamm entfernen ──
      if (body.action === 'delete') {
        const { id } = body;
        if (!id) return respond(400, { error: 'id erforderlich' });
        const delId = parseInt(id, 10);
        if (isNaN(delId)) return respond(400, { error: 'Ungültige ID' });
        await client.query('DELETE FROM kinder WHERE id = $1', [delId]);
        return respond(200, { success: true });
      }

      // ── Delete All: Alle Kinder aus Stamm entfernen ──
      if (body.action === 'delete_all') {
        const result = await client.query('DELETE FROM kinder');
        return respond(200, { success: true, deleted: result.rowCount });
      }

      return respond(400, { error: 'Unbekannte action' });
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Kinder Fehler:', err);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
