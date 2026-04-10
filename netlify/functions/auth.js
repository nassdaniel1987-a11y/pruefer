// POST /.netlify/functions/auth
// Body: { action: 'login'|'logout'|'check', username?, password?, token? }

const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const getClient = () => new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const generateToken = () => crypto.randomBytes(48).toString('hex');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiges JSON' }) };
  }

  const { action } = body;
  const client = getClient();

  try {
    await client.connect();

    // --- LOGIN ---
    if (action === 'login') {
      const { username, password } = body;
      if (!username || !password) {
        return respond(400, { error: 'Benutzername und Passwort erforderlich' });
      }

      const result = await client.query(
        'SELECT id, username, password_hash FROM users WHERE username = $1',
        [username.toLowerCase().trim()]
      );

      if (result.rows.length === 0) {
        return respond(401, { error: 'Ungültige Anmeldedaten' });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return respond(401, { error: 'Ungültige Anmeldedaten' });
      }

      // Session erstellen (7 Tage)
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await client.query(
        'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
        [token, user.id, expiresAt]
      );

      return respond(200, {
        success: true,
        token,
        user: { id: user.id, username: user.username }
      });
    }

    // --- LOGOUT ---
    if (action === 'logout') {
      const { token } = body;
      if (token) {
        await client.query('DELETE FROM sessions WHERE id = $1', [token]);
      }
      return respond(200, { success: true });
    }

    // --- CHECK (Token validieren) ---
    if (action === 'check') {
      const { token } = body;
      if (!token) {
        return respond(401, { valid: false });
      }

      const result = await client.query(`
        SELECT s.id, s.expires_at, u.id as user_id, u.username
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = $1 AND s.expires_at > NOW()
      `, [token]);

      if (result.rows.length === 0) {
        return respond(401, { valid: false });
      }

      return respond(200, {
        valid: true,
        user: {
          id: result.rows[0].user_id,
          username: result.rows[0].username
        }
      });
    }

    // --- NUTZER ANLEGEN ---
    if (action === 'register') {
      const { token, username, password } = body;

      // Nur eingeloggte Nutzer dürfen neue Nutzer anlegen
      if (!token) return respond(401, { error: 'Nicht autorisiert' });
      const session = await client.query(
        'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
        [token]
      );
      if (session.rows.length === 0) return respond(401, { error: 'Nicht autorisiert' });

      if (!username || !password) return respond(400, { error: 'Benutzername und Passwort erforderlich' });
      if (username.trim().length < 3) return respond(400, { error: 'Benutzername muss mindestens 3 Zeichen haben' });
      if (password.length < 8) return respond(400, { error: 'Passwort muss mindestens 8 Zeichen haben' });

      // Duplikat prüfen
      const existing = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [username.toLowerCase().trim()]
      );
      if (existing.rows.length > 0) return respond(409, { error: 'Benutzername bereits vergeben' });

      const hash = await bcrypt.hash(password, 12);
      await client.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        [username.toLowerCase().trim(), hash]
      );

      return respond(201, { success: true });
    }

    // --- NUTZER LISTE ---
    if (action === 'list-users') {
      const { token } = body;
      if (!token) return respond(401, { error: 'Nicht autorisiert' });
      const session = await client.query(
        'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
        [token]
      );
      if (session.rows.length === 0) return respond(401, { error: 'Nicht autorisiert' });

      const result = await client.query(
        'SELECT id, username, created_at FROM users ORDER BY created_at ASC'
      );
      return respond(200, { success: true, users: result.rows });
    }

    // --- NUTZER LÖSCHEN ---
    if (action === 'delete-user') {
      const { token, userId } = body;
      if (!token) return respond(401, { error: 'Nicht autorisiert' });
      const session = await client.query(
        'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()',
        [token]
      );
      if (session.rows.length === 0) return respond(401, { error: 'Nicht autorisiert' });

      // Eigenen Account kann man nicht löschen
      if (session.rows[0].user_id === userId) {
        return respond(400, { error: 'Eigener Account kann nicht gelöscht werden' });
      }

      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      return respond(200, { success: true });
    }

    // --- PASSWORT ÄNDERN ---
    if (action === 'change-password') {
      const { token, newPassword } = body;
      if (!token || !newPassword) {
        return respond(400, { error: 'Token und neues Passwort erforderlich' });
      }

      const session = await client.query(`
        SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()
      `, [token]);

      if (session.rows.length === 0) {
        return respond(401, { error: 'Nicht autorisiert' });
      }

      if (newPassword.length < 8) {
        return respond(400, { error: 'Passwort muss mindestens 8 Zeichen haben' });
      }

      const hash = await bcrypt.hash(newPassword, 12);
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [hash, session.rows[0].user_id]
      );

      // Alle anderen Sessions löschen
      await client.query(
        'DELETE FROM sessions WHERE user_id = $1 AND id != $2',
        [session.rows[0].user_id, token]
      );

      return respond(200, { success: true });
    }

    return respond(400, { error: 'Unbekannte Aktion' });

  } catch (err) {
    console.error('Auth Fehler:', err);
    return respond(500, { error: 'Serverfehler' });
  } finally {
    await client.end();
  }
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  },
  body: JSON.stringify(body)
});
