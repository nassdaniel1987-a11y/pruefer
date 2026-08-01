// kitafino-Anbindung: Buchungen (Liste B) direkt aus dem Einrichtungs-Portal holen
// POST { action:'test' }                                     -> Login prüfen
// POST { action:'fetch', ferienblock_id, von?, bis? }        -> Buchungen abrufen
//
// Hintergrund: kitafino bietet keine dokumentierte Schnittstelle. Wir sprechen
// dieselben Endpunkte an, die das Einrichtungs-Portal selbst benutzt:
//   Login      POST auth.kitafino.de/sys_k2/index.php?action=do_login
//   Stammliste GET  facility.kitafino.de/sys_k2/caterer/index.php?action=listen&pid=X
//   Tag        POST facility.kitafino.de/sys_k2/caterer/index.php?action=lib_orders_content
// Das Session-Cookie gilt laut Portal für die ganze Domain '.kitafino.de'.

const { Client } = require('pg');
const { toYmd } = require('./utils/datum');

const AUTH_BASE = 'https://auth.kitafino.de/sys_k2';
const FACILITY_BASE = 'https://facility.kitafino.de/sys_k2/caterer';

// Wieviele Tagesabrufe gleichzeitig. Ein Tag dauert ~300ms; bei 5 parallel
// bleibt auch ein sechswöchiger Block deutlich unter dem 10s-Limit von Netlify.
const PARALLEL_DAYS = 5;
const MAX_DAYS = 70;

// Das Portal antwortet auf Requests ohne erkennbaren Browser teils anders.
const UA = 'Mozilla/5.0 (compatible; Pruefer/1.0; +Ferienversorgung)';

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

// ─── HTML-Helfer ───────────────────────────────────────────
// Bewusst regex-basiert: die Functions haben nur pg + bcryptjs als
// Dependencies, und die Fragmente sind serverseitig gerendertes PHP ohne
// verschachtelte Tabellen.

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü',
  '&Auml;': 'Ä', '&Ouml;': 'Ö', '&Uuml;': 'Ü', '&szlig;': 'ß', '&euro;': '€'
};

const decodeEntities = (s) => s
  .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] !== undefined ? ENTITIES[m] : m);

// Zelleninhalt -> reiner Text. <br> wird zu \n, damit "Speise<br>(Dessert: X)"
// trennbar bleibt. Achtung: kitafino liefert das <br> in der Speisen-Spalte
// HTML-escaped (&lt;br /&gt;) — nach dem Entity-Decoding muss deshalb noch
// einmal ersetzt werden, sonst steht "<br />" wörtlich im Menütext.
const cellText = (html) => decodeEntities(
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
).replace(/<br\s*\/?>/gi, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();

// Liefert die Zeilen einer Tabelle als { isHeader, cells[] }
const parseRows = (tableHtml) => {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tableHtml)) !== null) {
    const inner = m[1];
    const cells = [];
    const tdRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    let isHeader = false;
    while ((c = tdRe.exec(inner)) !== null) {
      if (c[1].toLowerCase() === 'th') isHeader = true;
      cells.push(cellText(c[2]));
    }
    if (cells.length) rows.push({ isHeader, cells });
  }
  return rows;
};

// Schneidet die erste <table> heraus, deren Start-Tag zum Muster passt.
const extractTable = (html, tagPattern) => {
  const re = /<table\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!tagPattern.test(m[0])) continue;
    const end = html.indexOf('</table>', m.index);
    if (end === -1) continue;
    return html.slice(m.index, end);
  }
  return null;
};

// Dasselbe, aber ausgewählt über den Inhalt der Tabelle statt über das Tag.
const extractTableByContent = (html, contentPattern) => {
  const re = /<table\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const end = html.indexOf('</table>', m.index);
    if (end === -1) continue;
    const chunk = html.slice(m.index, end);
    if (contentPattern.test(chunk)) return chunk;
  }
  return null;
};

// ─── Namens-Normalisierung ─────────────────────────────────
// Muss zur Logik in kinder.js passen (LOWER/TRIM, Reihenfolge egal).
const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
const nameKey = (nachname, vorname) => {
  const a = norm(nachname), b = norm(vorname);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

// ─── HTTP mit Cookie-Jar ───────────────────────────────────
// Node-fetch hat keinen Cookie-Jar, also selbst mitführen — und zwar
// domain-bewusst: auth.kitafino.de und facility.kitafino.de vergeben je eine
// eigene PHPSESSID. Ein Speicher nur nach Namen würde die eine mit der anderen
// überschreiben und facility die fremde Sitzung vorsetzen, worauf das Portal
// zurück auf die Loginmaske leitet.
const newJar = () => [];

const hostOf = (url) => new URL(url).hostname;

const cookieHeaderFor = (jar, url) => {
  const host = hostOf(url);
  return jar
    .filter(c => c.hostOnly ? c.domain === host : (host === c.domain || host.endsWith('.' + c.domain)))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
};

const collectCookies = (res, jar, url) => {
  // getSetCookie() gibt alle Set-Cookie-Header einzeln (Node 18.14+),
  // sonst auf den zusammengefassten Header zurückfallen.
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  const reqHost = hostOf(url);

  for (const line of raw) {
    const parts = line.split(';');
    const pair = parts[0];
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();

    const domAttr = parts.slice(1)
      .map(p => p.trim())
      .find(p => /^domain=/i.test(p));
    const domain = domAttr ? domAttr.split('=')[1].trim().replace(/^\./, '') : reqHost;
    const hostOnly = !domAttr;

    const vorhanden = jar.find(c => c.name === name && c.domain === domain);
    if (vorhanden) vorhanden.value = value;
    else jar.push({ name, value, domain, hostOnly });
  }
};

const jarBeschreibung = (jar) =>
  jar.length ? jar.map(c => `${c.name}@${c.domain}`).join(', ') : 'keine';

// spur (optional) sammelt Diagnosedaten: Statuscodes, Weiterleitungsziele und
// Cookie-*Namen*. Bewusst ohne Zugangsdaten, Cookie-Werte und Seiteninhalte —
// die Antwortseiten enthalten Kindernamen.
const login = async (spur = null) => {
  const user = process.env.KITAFINO_USER;
  const pass = process.env.KITAFINO_PASSWORD;
  if (!user || !pass) {
    const err = new Error('KITAFINO_USER und KITAFINO_PASSWORD sind nicht gesetzt');
    err.code = 'NO_CREDENTIALS';
    throw err;
  }
  if (spur) spur.push(`Benutzername: ${user.length} Zeichen, Passwort: ${pass.length} Zeichen`);

  const jar = newJar();

  // Zuerst facility ansteuern, damit dort eine eigene Sitzung entsteht. Ein
  // Browser bringt die immer schon mit; ohne sie hat der Login bei auth
  // nachher keine facility-Sitzung, an die er sich hängen kann.
  const facilityUrl = `${FACILITY_BASE}/index.php?action=bestellungen`;
  const facilitySeed = await fetch(facilityUrl, {
    redirect: 'manual',
    headers: { 'User-Agent': UA }
  });
  collectCookies(facilitySeed, jar, facilityUrl);
  if (spur) spur.push(`facility-Sitzung: HTTP ${facilitySeed.status}, Cookies: ${jarBeschreibung(jar)}`);

  // Dann die Loginmaske. Die PHP-Anwendung vergibt die Session beim Aufruf
  // der Seite — ohne gültige PHPSESSID läuft der POST ins Leere.
  const loginUrl = `${AUTH_BASE}/index.php?action=login`;
  const loginPage = await fetch(loginUrl, {
    redirect: 'manual',
    headers: { 'User-Agent': UA, Cookie: cookieHeaderFor(jar, loginUrl) }
  });
  collectCookies(loginPage, jar, loginUrl);
  if (spur) spur.push(`Loginmaske: HTTP ${loginPage.status}, Cookies: ${jarBeschreibung(jar)}`);

  let url = `${AUTH_BASE}/index.php?action=do_login`;
  let res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Cookie: cookieHeaderFor(jar, url),
      Referer: loginUrl
    },
    body: new URLSearchParams({ benutzername: user, passwort: pass, rememberme: '0' }).toString()
  });
  collectCookies(res, jar, url);
  const loginZiel = res.headers.get('location') || '';
  if (spur) spur.push(`do_login: HTTP ${res.status} -> ${loginZiel || 'keine Weiterleitung'}`);

  // Redirect-Kette selbst verfolgen, damit die Cookies aller Zwischenschritte
  // im Jar landen (auth.kitafino.de -> facility.kitafino.de).
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && hops < 8) {
    const loc = res.headers.get('location');
    if (!loc) break;
    url = new URL(loc, url).toString();
    if (!/^https:\/\/[a-z0-9.-]*kitafino\.de\//i.test(url)) break;
    res = await fetch(url, {
      redirect: 'manual',
      headers: { Cookie: cookieHeaderFor(jar, url), 'User-Agent': UA }
    });
    collectCookies(res, jar, url);
    hops++;
    if (spur) spur.push(`Hop ${hops}: ${url.replace(/^https:\/\//, '')} -> HTTP ${res.status}`);
  }

  // Erfolg wird aktiv nachgewiesen, nicht aus dem Ausbleiben eines Fehlers
  // geschlossen: bei einem gescheiterten Login liefert das Portal weiterhin
  // HTTP 200 — nur eben die Loginmaske. Ohne diese Prüfung liefe der Abruf
  // durch und meldete stillschweigend "0 Buchungen".
  const probe = await fetch(facilityUrl, {
    headers: { Cookie: cookieHeaderFor(jar, facilityUrl), 'User-Agent': UA }
  });
  const probeHtml = await probe.text();
  const hatPasswortfeld = /name=["']passwort["']/i.test(probeHtml);
  const hatLogout = /action=log_out/i.test(probeHtml);
  if (spur) {
    const titel = (probeHtml.match(/<title[^>]*>([\s\S]{0,80}?)<\/title>/i) || [, ''])[1].trim();
    spur.push(`Portalprüfung: HTTP ${probe.status}, ${probeHtml.length} Zeichen, Titel "${titel}"`);
    spur.push(`Passwortfeld: ${hatPasswortfeld ? 'ja' : 'nein'}, Logout-Formular: ${hatLogout ? 'ja' : 'nein'}`);
    spur.push(`Cookies gesamt: ${jarBeschreibung(jar)}`);
  }
  if (hatPasswortfeld || !hatLogout) {
    // Der do_login-Redirect verrät, woran es lag: zeigt er auf das Portal,
    // waren die Zugangsdaten richtig und es hakt an der Sitzung.
    const zurueckAufLogin = /action=login/i.test(loginZiel);
    const err = new Error(zurueckAufLogin
      ? 'Login bei kitafino abgelehnt — Benutzername oder Passwort prüfen'
      : 'Anmeldung akzeptiert, aber die Sitzung gilt im Portal nicht — Cookie-Übergabe prüfen');
    err.code = 'LOGIN_FAILED';
    err.spur = spur;
    throw err;
  }
  return jar;
};

const portalGet = async (jar, path) => {
  const ziel = `${FACILITY_BASE}/${path}`;
  const res = await fetch(ziel, {
    headers: { Cookie: cookieHeaderFor(jar, ziel), 'User-Agent': UA }
  });
  if (!res.ok) throw new Error(`kitafino antwortete mit ${res.status}`);
  return res.text();
};

const portalPost = async (jar, path, params) => {
  const ziel = `${FACILITY_BASE}/${path}`;
  const res = await fetch(ziel, {
    method: 'POST',
    headers: {
      Cookie: cookieHeaderFor(jar, ziel),
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params).toString()
  });
  if (!res.ok) throw new Error(`kitafino antwortete mit ${res.status}`);
  return res.text();
};

// ─── Stammliste ────────────────────────────────────────────
// GET ?action=listen&pid=X -> alle Benutzer der Einrichtung mit Benutzer-ID.
// Spalten: # | Nachname | Vorname | Gruppe/Klasse | Benutzer-ID | Status | BuT
// Das ist die einzige Stelle, an der die kitafino-ID für *alle* Kinder steht —
// die Buchungszeilen der Tagesansicht führen sie nicht mit.
const fetchRoster = async (jar, projektId) => {
  const html = await portalGet(jar, `index.php?action=listen&pid=${encodeURIComponent(projektId)}`);
  // Die richtige Tabelle ist die mit der Spalte "Benutzer-ID".
  const table = extractTableByContent(html, /Benutzer-ID/i);
  if (!table) {
    const err = new Error('Stammliste nicht lesbar — Portal nicht erreichbar oder Aufbau geändert');
    err.code = 'PORTAL_CHANGED';
    throw err;
  }

  const roster = [];
  for (const row of parseRows(table)) {
    if (row.isHeader || row.cells.length < 5) continue;
    const [, nachname, vorname, klasse, benutzerId, status] = row.cells;
    if (!nachname || !vorname) continue;
    if (!/^\d+-\d+$/.test(benutzerId || '')) continue;
    roster.push({
      nachname: nachname.trim(),
      vorname: vorname.trim(),
      klasse: (klasse || '').trim(),
      kitafino_id: benutzerId.trim(),
      status: (status || '').trim()
    });
  }
  return roster;
};

// ─── Tagesansicht ──────────────────────────────────────────
// Eine flache Tabelle mit Abschnitts-Kopfzeilen. Kopfzeile mit "bestellte
// Speise" leitet die Buchungen ein (ein Block je Menü), Kopfzeile mit
// "letzte Bestellung" die Nicht-Besteller. Wir merken uns den zuletzt
// gesehenen Abschnitt.
const parseDay = (html) => {
  const table = extractTable(html, /user_order_list/);
  const bestellungen = [];
  // Ohne Tabelle ist die Antwort nicht die Tagesansicht — das ist ein Fehler
  // und darf nicht als "keine Buchungen" durchgehen.
  if (!table) return { bestellungen, hatTabelle: false };

  // Das Portal gibt jeden Abschnitt zweimal aus (einmal je Ansicht im
  // Tab-Aufbau) — mit identischem Inhalt. Ohne Entdopplung zaehlt jede
  // Buchung doppelt: 370 statt der 185, die die Monatsuebersicht nennt.
  const gesehen = new Set();

  let mode = null;
  for (const row of parseRows(table)) {
    const joined = row.cells.join(' | ');
    if (row.isHeader) {
      if (/bestellte Speise/i.test(joined)) mode = 'mit';
      else if (/letzte Bestellung/i.test(joined)) mode = 'ohne';
      continue;
    }
    if (mode !== 'mit') continue;
    if (row.cells.length < 4) continue;

    const [benutzer, , dritte, vierte] = row.cells;
    if (!benutzer || !benutzer.includes(',')) continue;

    // Ein Kind kann pro Tag nur ein Essen gebucht haben — der erste Treffer
    // gewinnt, jede weitere Zeile zum selben Kind ist die Dopplung.
    const schluessel = norm(benutzer);
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);

    bestellungen.push({
      benutzer,
      // "Pasta mit Grünkernbolognese\n(Dessert: Obst)" -> nur die erste Zeile
      menu: (dritte || '').split('\n')[0].trim().slice(0, 200),
      diaet: (vierte || '').trim()
    });
  }
  return { bestellungen, hatTabelle: true };
};

// "Nachname, Vorname [70563-27]" -> Bestandteile
const splitBenutzer = (raw) => {
  const withoutId = raw.replace(/\[\s*\d+-\d+\s*\]/, '').trim();
  const idMatch = raw.match(/\[\s*(\d+-\d+)\s*\]/);
  const comma = withoutId.indexOf(',');
  if (comma === -1) return { nachname: withoutId, vorname: '', kitafino_id: idMatch ? idMatch[1] : null };
  return {
    nachname: withoutId.slice(0, comma).trim(),
    vorname: withoutId.slice(comma + 1).trim(),
    kitafino_id: idMatch ? idMatch[1] : null
  };
};

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// toYmd kommt aus utils/datum.js — siehe dortigen Kommentar zur Fallstrick-
// Kombination aus DATE-Spalten, Date-Objekten und Zeitzonen.

// ─── Handler ───────────────────────────────────────────────
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
      if (von > bis) return respond(400, { error: 'Startdatum liegt nach dem Enddatum' });

      const tage = [];
      for (let d = new Date(von + 'T12:00:00'); ymd(d) <= bis; d.setDate(d.getDate() + 1)) {
        tage.push(ymd(d));
      }
      if (tage.length > MAX_DAYS) {
        return respond(400, { error: `Zeitraum zu groß (${tage.length} Tage, max. ${MAX_DAYS})` });
      }

      const jar = await login();
      const roster = await fetchRoster(jar, projektId);

      // Stammliste als Nachschlagewerk: liefert die kitafino-ID und trennt
      // Nachname/Vorname zuverlässiger als ein Komma-Split (Doppelnamen).
      const rosterByCombined = new Map();
      for (const r of roster) {
        rosterByCombined.set(norm(`${r.nachname}, ${r.vorname}`), r);
        rosterByCombined.set(nameKey(r.nachname, r.vorname), r);
      }

      const eintraege = [];
      const tageOhneEssen = [];
      let tageOhneTabelle = 0;

      for (let i = 0; i < tage.length; i += PARALLEL_DAYS) {
        const batch = tage.slice(i, i + PARALLEL_DAYS);
        const results = await Promise.all(batch.map(async (datum) => {
          const [y, m, d] = datum.split('-');
          const html = await portalPost(jar, 'index.php?action=lib_orders_content', {
            projekt_id: projektId,
            tag: String(parseInt(d, 10)),
            monat: String(parseInt(m, 10)),
            jahr: y
          });
          return { datum, ...parseDay(html) };
        }));

        for (const r of results) {
          if (!r.hatTabelle) tageOhneTabelle++;
          else if (r.bestellungen.length === 0) tageOhneEssen.push(r.datum);
          for (const b of r.bestellungen) {
            const parsed = splitBenutzer(b.benutzer);
            const hit = rosterByCombined.get(norm(b.benutzer.replace(/\[\s*\d+-\d+\s*\]/, '').trim()))
              || rosterByCombined.get(nameKey(parsed.nachname, parsed.vorname));
            eintraege.push({
              nachname: hit ? hit.nachname : parsed.nachname,
              vorname: hit ? hit.vorname : parsed.vorname,
              // Klasse kommt bewusst nicht von kitafino: die Spalte
              // "Gruppe/Klasse" enthält dort für alle Nutzer den
              // Einrichtungsnamen, keine Klasse. Liste A ist die Quelle dafür.
              klasse: '',
              datum: r.datum,
              menu: b.menu,
              kitafino_id: hit ? hit.kitafino_id : parsed.kitafino_id
            });
          }
        }
      }

      // Wenn kein einziger Tag eine Tagesansicht lieferte, stimmt etwas
      // grundsätzlich nicht — das darf nicht als "keine Buchungen" enden.
      if (tageOhneTabelle === tage.length) {
        return respond(502, {
          error: 'Keine Tagesansicht erhalten — Portal nicht erreichbar oder Sitzung ungültig'
        });
      }

      const kinder = new Set(eintraege.map(e => nameKey(e.nachname, e.vorname)));
      const mitId = eintraege.filter(e => e.kitafino_id).length;

      return respond(200, {
        success: true,
        eintraege,
        von,
        bis,
        block_von: blockVon,
        block_bis: blockBis,
        ist_teilzeitraum: von > blockVon || bis < blockBis,
        tage_abgefragt: tage.length,
        tage_ohne_essen: tageOhneEssen.length,
        kinder_gesamt: kinder.size,
        eintraege_mit_id: mitId
      });
    }

    return respond(400, { error: 'Unbekannte action' });

  } catch (err) {
    console.error('kitafino Fehler:', err.message);
    if (err.code === 'NO_CREDENTIALS') {
      return respond(400, { error: 'kitafino-Zugangsdaten sind nicht hinterlegt (KITAFINO_USER / KITAFINO_PASSWORD)' });
    }
    if (err.code === 'LOGIN_FAILED') {
      return respond(502, { error: err.message });
    }
    return respond(502, { error: 'kitafino nicht erreichbar: ' + err.message });
  } finally {
    await client.end();
  }
};
