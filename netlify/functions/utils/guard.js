// Zugriffsschutz für die Wartungs-Endpunkte (setup-db, migrate).
//
// Diese beiden liefen bisher ohne jede Prüfung: ein GET auf die URL genügte.
// Bei migrate ist das idempotentes DDL, bei setup-db wurde damit ein Nutzer
// "admin" angelegt — wer die URL kennt, konnte sich so Zugang verschaffen,
// sobald der echte Admin einmal gelöscht war.
//
// Zwei Wege sind erlaubt:
//   1. eine gültige Sitzung (Bearer-Token), wie bei allen anderen Functions
//   2. ein Setup-Secret aus der Umgebungsvariable SETUP_SECRET
// Weg 2 ist nötig, weil auf einer frischen Datenbank noch niemand existiert,
// der sich anmelden könnte.

const secretAusRequest = (event) => {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};
  return h['x-setup-secret'] || h['X-Setup-Secret'] || q.secret || null;
};

// Zeitkonstanter Vergleich, damit sich das Secret nicht zeichenweise erraten lässt.
const gleich = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// Prüft, ob der Aufruf eine Wartungsaktion auslösen darf.
// Gibt null zurück, wenn erlaubt — sonst eine fertige Fehlerantwort.
const pruefeWartungszugriff = async (event, client) => {
  const antwort = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const secret = process.env.SETUP_SECRET;
  const mitgeschickt = secretAusRequest(event);
  if (secret && mitgeschickt && gleich(secret, mitgeschickt)) return null;

  // Angemeldete Nutzer dürfen ebenfalls — setzt voraus, dass die Tabelle
  // sessions schon existiert. Auf einer frischen Datenbank schlägt das fehl,
  // dann bleibt nur das Secret.
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token && client) {
    try {
      const res = await client.query(
        'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
        [token]
      );
      if (res.rows.length > 0) return null;
    } catch {
      // Tabelle existiert noch nicht — kein Fehler, es zählt dann nur das Secret.
    }
  }

  if (!secret) {
    return antwort(403, {
      error: 'Zugriff verweigert. Setze die Umgebungsvariable SETUP_SECRET und rufe erneut auf mit ?secret=… bzw. Header X-Setup-Secret.'
    });
  }
  return antwort(403, { error: 'Zugriff verweigert' });
};

module.exports = { pruefeWartungszugriff };
