// Signierte Token für die Entscheidungslinks in der täglichen Mail.
//
// Der Empfänger soll ein unsicheres Namenspaar mit einem Klick entscheiden
// können, ohne sich anzumelden. Damit sich niemand solche Links selbst basteln
// kann, trägt jeder Link eine HMAC-Signatur über den Inhalt.
//
// Bewusst zustandslos: kein Token-Eintrag in der Datenbank, kein Ablaufdatum.
// Die Entscheidung ist idempotent (dasselbe Paar, dasselbe Ergebnis) und lässt
// sich in den Einstellungen jederzeit widerrufen — ein Ablauf brächte hier
// nichts außer Links, die nach ein paar Tagen kommentarlos nicht mehr gehen.

const crypto = require('crypto');

// Ohne Geheimnis lässt sich nicht signieren. Dann werden gar keine Links
// erzeugt (siehe bericht.js), statt ungeschützte auszuliefern.
const geheimnis = () => process.env.SETUP_SECRET || '';

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64uZurueck = (s) => Buffer.from(
  String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'
).toString('utf8');

const signiere = (nutzlast) =>
  b64u(crypto.createHmac('sha256', geheimnis()).update(nutzlast).digest());

const kannSignieren = () => geheimnis().length > 0;

/**
 * @param {{nameA:string, nameB:string, entscheidung:'gleich'|'verschieden'}} d
 * @returns {string|null} Token, oder null wenn kein SETUP_SECRET gesetzt ist.
 */
const baueToken = ({ nameA, nameB, entscheidung }) => {
  if (!kannSignieren()) return null;
  const nutzlast = b64u(JSON.stringify({
    a: String(nameA || '').trim().toLowerCase(),
    b: String(nameB || '').trim().toLowerCase(),
    e: entscheidung,
  }));
  return `${nutzlast}.${signiere(nutzlast)}`;
};

/**
 * Prüft ein Token und gibt seinen Inhalt zurück.
 * @returns {{nameA:string, nameB:string, entscheidung:string}|null}
 */
const pruefeToken = (token) => {
  if (!kannSignieren() || !token) return null;
  const teile = String(token).split('.');
  if (teile.length !== 2) return null;
  const [nutzlast, signatur] = teile;

  const erwartet = signiere(nutzlast);
  // Zeitkonstanter Vergleich; bei ungleicher Länge wirft timingSafeEqual.
  const a = Buffer.from(signatur);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const d = JSON.parse(b64uZurueck(nutzlast));
    if (!d.a || !d.b || !['gleich', 'verschieden'].includes(d.e)) return null;
    return { nameA: d.a, nameB: d.b, entscheidung: d.e };
  } catch {
    return null;
  }
};

module.exports = { baueToken, pruefeToken, kannSignieren };
