// Listen A und B verwalten
// GET  ?ferienblock_id=X&liste=A          -> Einträge laden
// POST { liste, ferienblock_id, eintraege } -> Bulk-Import
// POST { action:'delete', ferienblock_id, liste } -> Leeren

const { Client } = require('pg');
const { toYmd } = require('./utils/datum');
const { importiereListe } = require('./utils/import');

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
      // GET ?import_log=1&ferienblock_id=X → Import-Protokolle laden
      if (params.import_log && params.ferienblock_id) {
        const fbId = parseInt(params.ferienblock_id, 10);
        if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        const result = await client.query(
          `SELECT id, liste, erstellt_am, eintraege_neu, eintraege_weg, eintraege_gesamt, details
           FROM import_log WHERE ferienblock_id = $1 ORDER BY erstellt_am DESC LIMIT 50`,
          [fbId]
        );
        return respond(200, result.rows);
      }

      const { ferienblock_id, liste } = params;
      if (!ferienblock_id || !liste) {
        return respond(400, { error: 'ferienblock_id und liste erforderlich' });
      }
      const fbId = parseInt(ferienblock_id, 10);
      if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
      const table = liste === 'A' ? 'liste_a' : 'liste_b';
      const extraCols = liste === 'B' ? ', menu, kontostand, kitafino_id' : '';
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

      // action=rebuild_import_log → Diff aus letztem Abgleich vs. aktuelle Liste B berechnen
      if (body.action === 'rebuild_import_log') {
        const { ferienblock_id, liste } = body;
        if (!ferienblock_id || !liste) return respond(400, { error: 'ferienblock_id und liste erforderlich' });
        const fbId = parseInt(ferienblock_id, 10);
        if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });
        const table = liste === 'A' ? 'liste_a' : 'liste_b';
        const prefix = liste === 'A' ? 'a' : 'b';

        // Alle Abgleiche für diesen Block holen (neuester zuerst)
        const alleAbgleiche = await client.query(
          `SELECT id, erstellt_am FROM abgleich WHERE ferienblock_id = $1 ORDER BY erstellt_am DESC`,
          [fbId]
        );

        // Wir brauchen den ältesten Abgleich als "alt" — der hat noch die ursprünglichen Daten
        const altesterAbgleich = alleAbgleiche.rows[alleAbgleiche.rows.length - 1];
        const neusterAbgleich = alleAbgleiche.rows[0];

        if (!altesterAbgleich) return respond(400, { error: 'Kein Abgleich vorhanden' });

        // Alte Personen aus ältestem Abgleich
        const abgleichRows = await client.query(`
          SELECT am.${prefix}_nachname as nachname, am.${prefix}_vorname as vorname, am.${prefix}_datum as datum
          FROM abgleich_matches am
          WHERE am.abgleich_id = $1
            AND am.${prefix}_nachname IS NOT NULL
        `, [altesterAbgleich.id]);

        const oldPersonen = new Map();
        abgleichRows.rows.forEach(r => {
          const personKey = (r.nachname + '|' + r.vorname).toLowerCase();
          if (!oldPersonen.has(personKey)) oldPersonen.set(personKey, { nachname: r.nachname, vorname: r.vorname, tage: new Set() });
          if (r.datum) oldPersonen.get(personKey).tage.add(toYmd(r.datum));
        });

        // Aktuelle Personen aus neuestem Abgleich (falls verschieden vom ältesten)
        const currentQuery = altesterAbgleich.id !== neusterAbgleich.id
          ? await client.query(`
              SELECT am.${prefix}_nachname as nachname, am.${prefix}_vorname as vorname, am.${prefix}_datum as datum
              FROM abgleich_matches am
              WHERE am.abgleich_id = $1 AND am.${prefix}_nachname IS NOT NULL
            `, [neusterAbgleich.id])
          : await client.query(
              `SELECT nachname, vorname, datum FROM ${table} WHERE ferienblock_id = $1`, [fbId]
            );
        const newPersonen = new Map();
        currentQuery.rows.forEach(r => {
          const personKey = (r.nachname + '|' + r.vorname).toLowerCase();
          if (!newPersonen.has(personKey)) newPersonen.set(personKey, { nachname: r.nachname, vorname: r.vorname, tage: new Set() });
          if (r.datum) newPersonen.get(personKey).tage.add(toYmd(r.datum));
        });

        const details = [];

        // Personen komplett neu
        for (const [key, p] of newPersonen) {
          if (!oldPersonen.has(key)) details.push({ aktion: 'neu', nachname: p.nachname, vorname: p.vorname, tage: [...p.tage].sort() });
        }
        // Personen komplett weggefallen
        for (const [key, p] of oldPersonen) {
          if (!newPersonen.has(key)) details.push({ aktion: 'weg', nachname: p.nachname, vorname: p.vorname, tage: [...p.tage].sort() });
        }
        // Einzelne Tage weggefallen oder neu (Person noch vorhanden)
        for (const [key, oldP] of oldPersonen) {
          if (!newPersonen.has(key)) continue; // schon als 'weg' erfasst
          const newP = newPersonen.get(key);
          const tageWeg = [...oldP.tage].filter(t => !newP.tage.has(t)).sort();
          const tageNeu = [...newP.tage].filter(t => !oldP.tage.has(t)).sort();
          if (tageWeg.length > 0) details.push({ aktion: 'tag_weg', nachname: oldP.nachname, vorname: oldP.vorname, tage: tageWeg });
          if (tageNeu.length > 0) details.push({ aktion: 'tag_neu', nachname: oldP.nachname, vorname: oldP.vorname, tage: tageNeu });
        }

        await client.query(
          `INSERT INTO import_log (ferienblock_id, liste, eintraege_neu, eintraege_weg, eintraege_gesamt, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [fbId, liste, details.filter(d => d.aktion === 'neu').length, details.filter(d => d.aktion === 'weg').length, newPersonen.size, JSON.stringify(details)]
        );

        return respond(200, {
          success: true,
          neu: details.filter(d => d.aktion === 'neu').length,
          weg: details.filter(d => d.aktion === 'weg').length,
          tag_neu: details.filter(d => d.aktion === 'tag_neu').length,
          tag_weg: details.filter(d => d.aktion === 'tag_weg').length,
        });
      }

      // action=delete_import_log → einzelnen Import-Log-Eintrag löschen
      if (body.action === 'delete_import_log') {
        const { id } = body;
        if (!id) return respond(400, { error: 'id erforderlich' });
        await client.query('DELETE FROM import_log WHERE id = $1', [parseInt(id, 10)]);
        return respond(200, { success: true });
      }

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
        // Abgleich als veraltet markieren
        await client.query(`UPDATE abgleich SET veraltet = TRUE WHERE ferienblock_id = $1`, [fbId]);
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
        // Abgleich als veraltet markieren
        await client.query(`UPDATE abgleich SET veraltet = TRUE WHERE ferienblock_id = $1`, [fbId]);
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

      // Bulk-Import — die eigentliche Arbeit macht utils/import.js, damit der
      // tägliche Automatiklauf exakt denselben Weg nimmt.
      const { ferienblock_id, liste, eintraege } = body;
      if (!ferienblock_id || !liste || !Array.isArray(eintraege)) {
        return respond(400, { error: 'ferienblock_id, liste und eintraege erforderlich' });
      }
      const fbIdImport = parseInt(ferienblock_id, 10);
      if (isNaN(fbIdImport)) return respond(400, { error: 'Ungültige ferienblock_id' });

      const ergebnis = await importiereListe(client, {
        ferienblockId: fbIdImport,
        liste,
        eintraege,
        mergeVon: body.merge_von || null,
        mergeBis: body.merge_bis || null,
      });

      return respond(201, { success: true, count: ergebnis.count });
    }

    return respond(405, { error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Listen Fehler:', err.message);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};
