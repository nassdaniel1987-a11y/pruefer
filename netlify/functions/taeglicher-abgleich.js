// Täglicher automatischer Abgleich um 09:01 deutscher Zeit.
//
// Der Ablauf selbst steht in utils/abgleichLauf.js — hier geht es nur um die
// Zeitsteuerung, das Protokoll und den Fehlerbericht.
//
// Zeitzone: Netlify plant ausschließlich in UTC, 09:01 deutscher Zeit wandert
// also mit der Sommerzeit. Deshalb laufen wir zu beiden Kandidaten (07:01 und
// 08:01 UTC) an und brechen ab, wenn es in Europe/Berlin gerade nicht 9 Uhr ist.
//
// Derselbe Ablauf lässt sich über automatik-jetzt.js von Hand auslösen — dafür
// ist ein gültiges Sitzungs-Token nötig.

const { schedule } = require('@netlify/functions');
const { Client } = require('pg');

const { fuehreAbgleichAus } = require('./utils/abgleichLauf');
const { sendeMail } = require('./utils/mail');
const { leseEinstellungen } = require('./einstellungen');

const getClient = () => new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const respond = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});

// Aktuelles Datum und Stunde in deutscher Zeit — unabhängig davon, in welcher
// Zone die Function gerade läuft.
const berlinJetzt = () => {
  const teile = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((acc, t) => { acc[t.type] = t.value; return acc; }, {});
  return {
    datum: `${teile.year}-${teile.month}-${teile.day}`,
    stunde: parseInt(teile.hour, 10),
  };
};

const protokolliere = async (client, { ferienblockId, erfolg, meldung, kennzahlen }) => {
  try {
    await client.query(
      `INSERT INTO automatik_log (ferienblock_id, erfolg, meldung, kennzahlen)
       VALUES ($1, $2, $3, $4)`,
      [ferienblockId || null, erfolg, meldung || null, kennzahlen ? JSON.stringify(kennzahlen) : null]
    );
  } catch (e) {
    console.error('automatik_log nicht schreibbar:', e.message);
  }
};

// Der Lauf selbst liegt in utils/abgleichLauf.js, weil ihn auch der
// Ein-Klick-Abgleich in der Oberfläche braucht. Der Name bleibt, damit
// automatik-jetzt.js unverändert weiterläuft.
const fuehreAus = fuehreAbgleichAus;

// Scheitert der Lauf, muss das auffallen. Nur ins Protokoll zu schreiben
// reicht nicht — dort schaut niemand nach, solange er nichts vermisst.
const meldeFehler = async (client, fehler) => {
  try {
    const einstellungen = await leseEinstellungen(client);
    const empfaenger = (einstellungen.automatik_empfaenger || []).length > 0
      ? einstellungen.automatik_empfaenger
      : (process.env.MAIL_EMPFAENGER ? [process.env.MAIL_EMPFAENGER] : []);
    if (empfaenger.length === 0) return;

    const appUrl = process.env.URL || 'https://pruefer.netlify.app';
    await sendeMail({
      an: empfaenger,
      betreff: 'Prüfer: automatischer Abgleich fehlgeschlagen',
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px">
        <h2 style="margin:0 0 8px">Der automatische Abgleich ist heute nicht durchgelaufen</h2>
        <p style="background:#fdecea;border-left:4px solid #d32f2f;padding:10px 14px;margin:16px 0">
          ${String(fehler.message).replace(/</g, '&lt;')}
        </p>
        <p style="font-size:14px;color:#555">
          Die Listen wurden möglicherweise nicht aktualisiert. Du kannst den Abgleich
          jederzeit von Hand im Abgleich-Tool durchführen.
        </p>
        <p><a href="${appUrl}/einstellungen">Einstellungen öffnen</a></p>
      </div>`,
      text: `Der automatische Abgleich ist heute nicht durchgelaufen.\n\n${fehler.message}\n\n${appUrl}/einstellungen`,
    });
  } catch (e) {
    // Auch der Fehlerbericht kann scheitern (kein Schlüssel, kein Empfänger).
    // Dann bleibt das Protokoll als letzte Spur.
    console.error('Fehlerbericht konnte nicht verschickt werden:', e.message);
  }
};

// ─── Geplanter Aufruf ──────────────────────────────────────
const geplanterLauf = async () => {
  const { datum, stunde } = berlinJetzt();
  if (stunde !== 9) {
    // Der zweite Cron-Kandidat für die jeweils andere Jahreszeit.
    return { statusCode: 200, body: `Uebersprungen: in Berlin ist es ${stunde} Uhr, nicht 9` };
  }

  const client = getClient();
  try {
    await client.connect();
    const r = await fuehreAus(client, { heute: datum });
    if (r.uebersprungen) {
      await protokolliere(client, { erfolg: true, meldung: r.meldung });
      return { statusCode: 200, body: r.meldung };
    }
    await protokolliere(client, {
      ferienblockId: r.block.id,
      erfolg: r.mailOk,
      meldung: r.meldung,
      kennzahlen: r.kennzahlen,
    });
    return { statusCode: 200, body: JSON.stringify(r.kennzahlen) };
  } catch (err) {
    console.error('Automatiklauf fehlgeschlagen:', err);
    try { await protokolliere(client, { erfolg: false, meldung: err.message }); } catch { /* egal */ }
    await meldeFehler(client, err);
    return { statusCode: 500, body: err.message };
  } finally {
    try { await client.end(); } catch { /* egal */ }
  }
};

exports.handler = schedule('1 7,8 * * *', geplanterLauf);

// Für den "Jetzt testen"-Knopf in den Einstellungen.
exports.fuehreAus = fuehreAus;
exports.protokolliere = protokolliere;
exports.berlinJetzt = berlinJetzt;
