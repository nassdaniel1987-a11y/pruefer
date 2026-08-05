// kitafino-Anbindung: Buchungen (Liste B) und Stammliste aus dem
// Einrichtungs-Portal holen.
//
// POST { action:'test' }                              -> Login prüfen
// POST { action:'fetch', ferienblock_id, von?, bis? } -> Buchungen abrufen
// POST { action:'stamm_laden' }                       -> Stammliste holen und
//                                                        Eindeutiges verknüpfen
// POST { action:'stamm_liste' }                       -> gespeicherte Stammliste
// POST { action:'stamm_vorschlaege' }                 -> offene Verknüpfungen
// POST { action:'verknuepfen', kind_id, kitafino_id } -> Vorschlag bestätigen
// POST { action:'loesen', kind_id }                   -> Verknüpfung lösen
//
// Die eigentliche Portal-Logik steckt in utils/kitafinoClient.js, damit der
// tägliche Automatiklauf denselben Weg nimmt.

const { Client } = require('pg');
const { toYmd } = require('./utils/datum');
const { login, fetchRoster, holeBuchungen } = require('./utils/kitafinoClient');
const {
  speichereRoster, verknuepfeEindeutige, verknuepfe, loese, listeStamm,
} = require('./utils/kitafinoStamm');

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

    let body;
    try { body = JSON.parse(event.body); }
    catch { return respond(400, { error: 'Ungültiges JSON' }); }

    const projektId = process.env.KITAFINO_PROJEKT_ID;
    if (!projektId) return respond(400, { error: 'KITAFINO_PROJEKT_ID ist nicht gesetzt' });

    // ── Verbindungstest ──
    if (body.action === 'test') {
      const spur = [];
      try {
        const jar = await login(spur);
        const roster = await fetchRoster(jar, projektId);
        return respond(200, {
          success: true,
          projekt_id: projektId,
          benutzer_gesamt: roster.length,
          spur
        });
      } catch (e) {
        // Beim Test die Diagnose mitgeben — sonst ist ein Fehlschlag von
        // aussen nicht unterscheidbar (falsche Daten? Portal? Weiterleitung?).
        return respond(e.code === 'NO_CREDENTIALS' ? 400 : 502, {
          error: e.message,
          spur: e.spur || spur
        });
      }
    }

    // ── Stammliste holen und ablegen ──
    // Holt alle Benutzer der Einrichtung mit ihrer stabilen Benutzer-ID und
    // verknüpft anschließend, was zweifelsfrei ist. Alles Uneindeutige kommt
    // als Vorschlag zurück.
    if (body.action === 'stamm_laden') {
      try {
        const jar = await login();
        const roster = await fetchRoster(jar, projektId);
        const gespeichert = await speichereRoster(client, roster);
        const verknuepfung = await verknuepfeEindeutige(client);
        return respond(200, { success: true, ...gespeichert, ...verknuepfung });
      } catch (e) {
        return respond(e.code === 'NO_CREDENTIALS' ? 400 : 502, { error: e.message });
      }
    }

    // ── Gespeicherte Stammliste mit Verknüpfungsstatus ──
    if (body.action === 'stamm_liste') {
      try {
        return respond(200, { benutzer: await listeStamm(client) });
      } catch (e) {
        return respond(500, { error: e.message });
      }
    }

    // ── Offene Verknüpfungen, ohne das Portal zu behelligen ──
    if (body.action === 'stamm_vorschlaege') {
      try {
        return respond(200, await verknuepfeEindeutige(client));
      } catch (e) {
        return respond(500, { error: e.message });
      }
    }

    // ── Vorschlag bestätigen ──
    if (body.action === 'verknuepfen') {
      try {
        const ok = await verknuepfe(client, {
          kindId: parseInt(body.kind_id, 10),
          kitafinoId: String(body.kitafino_id || '').trim(),
        });
        return respond(ok ? 200 : 404, ok ? { success: true } : { error: 'Kind nicht gefunden' });
      } catch (e) {
        return respond(400, { error: e.message });
      }
    }

    // ── Verknüpfung lösen ──
    if (body.action === 'loesen') {
      const ok = await loese(client, parseInt(body.kind_id, 10));
      return respond(ok ? 200 : 404, ok ? { success: true } : { error: 'Kind nicht gefunden' });
    }

    // ── Buchungen abrufen ──
    if (body.action === 'fetch') {
      const fbId = parseInt(body.ferienblock_id, 10);
      if (isNaN(fbId)) return respond(400, { error: 'Ungültige ferienblock_id' });

      const blockRes = await client.query(
        'SELECT startdatum, enddatum FROM ferienblock WHERE id = $1',
        [fbId]
      );
      if (blockRes.rows.length === 0) return respond(404, { error: 'Ferienblock nicht gefunden' });

      const blockVon = toYmd(blockRes.rows[0].startdatum);
      const blockBis = toYmd(blockRes.rows[0].enddatum);
      if (!blockVon || !blockBis) {
        return respond(500, { error: 'Ferienblock hat kein gültiges Start-/Enddatum' });
      }

      // von/bis dürfen einengen, aber nie über den Block hinausgehen —
      // sonst würde der Merge-Modus Tage anfassen, die nicht zum Block gehören.
      const von = body.von && body.von > blockVon ? body.von : blockVon;
      const bis = body.bis && body.bis < blockBis ? body.bis : blockBis;

      const r = await holeBuchungen({ von, bis, projektId });

      return respond(200, {
        success: true,
        eintraege: r.eintraege,
        von: r.von,
        bis: r.bis,
        block_von: blockVon,
        block_bis: blockBis,
        ist_teilzeitraum: von > blockVon || bis < blockBis,
        tage_abgefragt: r.tageAbgefragt,
        tage_ohne_essen: r.tageOhneEssen,
        kinder_gesamt: r.kinderGesamt,
        eintraege_mit_id: r.eintraegeMitId
      });
    }

    return respond(400, { error: 'Unbekannte action' });

  } catch (err) {
    console.error('kitafino Fehler:', err.message);
    if (err.code === 'NO_CREDENTIALS') {
      return respond(400, { error: 'kitafino-Zugangsdaten sind nicht hinterlegt (KITAFINO_USER / KITAFINO_PASSWORD)' });
    }
    if (err.code === 'BAD_RANGE') return respond(400, { error: err.message });
    if (err.code === 'LOGIN_FAILED' || err.code === 'NO_DATA' || err.code === 'PORTAL_CHANGED') {
      return respond(502, { error: err.message });
    }
    return respond(502, { error: 'kitafino nicht erreichbar: ' + err.message });
  } finally {
    await client.end();
  }
};
