// Entscheidungen über unsichere Namenspaare.
//
// Zwei Wege führen hierher:
//
// 1. Aus der täglichen Mail, per signiertem Token und ohne Anmeldung:
//    GET  ?t=<token>  → Bestätigungsseite
//    POST ?t=<token>  → schreibt die Entscheidung
//
//    Warum schreibt GET nicht direkt? Weil Mail-Scanner, Vorschaudienste und
//    Linkprüfer jeden Link im Hintergrund abrufen. Ein schreibendes GET würde
//    Entscheidungen auslösen, die niemand getroffen hat. Deshalb zeigt GET nur
//    an, was passieren soll, und erst der Knopf schickt das POST.
//
// 2. Aus den Einstellungen, mit Sitzungs-Token:
//    POST { action:'liste' }              → alle Entscheidungen
//    POST { action:'loeschen', id }       → eine Entscheidung zurücknehmen

const { Client } = require('pg');
const { pruefeToken } = require('./utils/zuordnungToken');
const {
  merkeZuordnung, listeZuordnungen, loescheZuordnung,
} = require('./utils/zuordnungen');

const getClient = () => new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  },
  body: JSON.stringify(body),
});

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Titel jeweils in Großschreibung, wie sie in der Mail steht.
const grossName = (n) => String(n || '')
  .split(' ').filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

const seite = (statusCode, { titel, text, knopf, token, appUrl }) => ({
  statusCode,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titel)} — Prüfer</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f5f5f7;
         color: #1c1b1f; margin: 0; padding: 2rem 1rem; }
  .karte { max-width: 480px; margin: 3rem auto; background: #fff; border-radius: 16px;
           padding: 2rem; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { line-height: 1.6; margin: 0 0 1rem; }
  .paar { background: #f5f5f7; border-radius: 10px; padding: 1rem; margin: 1rem 0;
          font-size: 1.05rem; text-align: center; }
  .paar b { display: block; }
  .paar span { color: #666; font-size: .85rem; }
  button { background: #5a598b; color: #fff; border: 0; border-radius: 10px;
           padding: .8rem 1.4rem; font-size: 1rem; cursor: pointer; width: 100%; }
  button:hover { background: #4a4977; }
  a { color: #5a598b; font-size: .875rem; }
  .fehler { color: #b3261e; }
</style>
</head>
<body>
  <div class="karte">
    <h1>${esc(titel)}</h1>
    ${text}
    ${knopf ? `
    <form method="POST" action="?t=${encodeURIComponent(token)}">
      <button type="submit">${esc(knopf)}</button>
    </form>` : ''}
    ${appUrl ? `<p style="margin-top:1.5rem"><a href="${esc(appUrl)}">Zurück zu Prüfer</a></p>` : ''}
  </div>
</body>
</html>`,
});

const validateSession = async (client, event) => {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const res = await client.query(
    'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
    [token]
  );
  return res.rows.length > 0 ? res.rows[0].user_id : null;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  const appUrl = process.env.URL || '';
  const linkToken = (event.queryStringParameters || {}).t;

  // ── Weg 1: Link aus der Mail ──
  if (linkToken) {
    const inhalt = pruefeToken(linkToken);
    if (!inhalt) {
      return seite(400, {
        titel: 'Link ungültig',
        text: '<p class="fehler">Dieser Link ist nicht lesbar oder wurde verändert. '
            + 'Bitte den Link aus der aktuellen Mail verwenden.</p>',
        appUrl,
      });
    }

    const { nameA, nameB, entscheidung } = inhalt;
    const paar = `
      <div class="paar">
        <b>${esc(grossName(nameA))}</b>
        <span>aus den Anmeldungen</span>
        <div style="margin:.6rem 0;color:#999">↕</div>
        <b>${esc(grossName(nameB))}</b>
        <span>aus den Essensbuchungen</span>
      </div>`;

    // GET: nur zeigen, nichts schreiben.
    if (event.httpMethod === 'GET') {
      return seite(200, {
        titel: entscheidung === 'gleich' ? 'Dasselbe Kind?' : 'Verschiedene Kinder?',
        text: paar + (entscheidung === 'gleich'
          ? '<p>Bestätige, dass diese beiden Einträge <b>dasselbe Kind</b> meinen. '
            + 'Sie werden ab sofort automatisch zugeordnet.</p>'
          : '<p>Bestätige, dass dies <b>zwei verschiedene Kinder</b> sind. '
            + 'Sie werden ab sofort nicht mehr zur Prüfung gemeldet.</p>')
          + '<p style="color:#666;font-size:.875rem">Die Entscheidung lässt sich in den '
          + 'Einstellungen jederzeit zurücknehmen.</p>',
        knopf: entscheidung === 'gleich' ? 'Ja, dasselbe Kind' : 'Ja, verschiedene Kinder',
        token: linkToken,
        appUrl,
      });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Methode nicht erlaubt' });

    const client = getClient();
    try {
      await client.connect();
      await merkeZuordnung(client, { nameA, nameB, entscheidung, von: 'mail' });
      return seite(200, {
        titel: 'Gespeichert',
        text: paar + (entscheidung === 'gleich'
          ? '<p>Die beiden Einträge gelten ab jetzt als <b>dasselbe Kind</b>.</p>'
          : '<p>Die beiden Einträge gelten ab jetzt als <b>verschiedene Kinder</b>.</p>')
          + '<p style="color:#666;font-size:.875rem">Ab dem nächsten Abgleich taucht dieses '
          + 'Paar nicht mehr unter "unsicher" auf.</p>',
        appUrl,
      });
    } catch (e) {
      console.error('Zuordnung speichern fehlgeschlagen:', e);
      return seite(500, {
        titel: 'Speichern fehlgeschlagen',
        text: `<p class="fehler">${esc(e.message)}</p>`,
        appUrl,
      });
    } finally {
      await client.end().catch(() => {});
    }
  }

  // ── Weg 2: Verwaltung aus den Einstellungen ──
  if (event.httpMethod !== 'POST') return json(405, { error: 'Methode nicht erlaubt' });

  const client = getClient();
  try {
    await client.connect();
    const userId = await validateSession(client, event);
    if (!userId) return json(401, { error: 'Nicht angemeldet' });

    const body = JSON.parse(event.body || '{}');

    if (body.action === 'liste') {
      return json(200, { zuordnungen: await listeZuordnungen(client) });
    }

    if (body.action === 'loeschen') {
      const weg = await loescheZuordnung(client, body.id);
      return json(weg ? 200 : 404, weg ? { success: true } : { error: 'Nicht gefunden' });
    }

    if (body.action === 'merken') {
      const r = await merkeZuordnung(client, {
        nameA: body.nameA, nameB: body.nameB,
        entscheidung: body.entscheidung, von: `benutzer:${userId}`,
      });
      return json(200, { success: true, ...r });
    }

    return json(400, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error('zuordnung:', e);
    return json(500, { error: e.message });
  } finally {
    await client.end().catch(() => {});
  }
};
