// Einmalig aufrufen: https://deine-seite.netlify.app/.netlify/functions/setup-db
// Legt alle Tabellen in der Neon-Datenbank an

const { Client } = require('pg');

exports.handler = async (event) => {
  // Nur GET erlauben
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    await client.query(`
      -- Benutzer (Admin-Accounts)
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Sessions (Login-Token)
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(128) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Ferienblöcke (z.B. "Winterferien 2026")
      CREATE TABLE IF NOT EXISTS ferienblock (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        startdatum DATE NOT NULL,
        enddatum DATE NOT NULL,
        preis_pro_tag NUMERIC(10,2) NOT NULL DEFAULT 3.50,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Liste A: Anmeldungen (wer hat sich bei uns angemeldet)
      CREATE TABLE IF NOT EXISTS liste_a (
        id SERIAL PRIMARY KEY,
        ferienblock_id INTEGER REFERENCES ferienblock(id) ON DELETE CASCADE,
        nachname VARCHAR(200) NOT NULL,
        vorname VARCHAR(200) NOT NULL,
        klasse VARCHAR(20),
        datum DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Liste B: Essensbuchungen (wer hat beim Caterer gebucht)
      CREATE TABLE IF NOT EXISTS liste_b (
        id SERIAL PRIMARY KEY,
        ferienblock_id INTEGER REFERENCES ferienblock(id) ON DELETE CASCADE,
        nachname VARCHAR(200) NOT NULL,
        vorname VARCHAR(200) NOT NULL,
        klasse VARCHAR(20),
        datum DATE NOT NULL,
        menu VARCHAR(200),
        kontostand NUMERIC(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Abgleich-Ergebnisse
      CREATE TABLE IF NOT EXISTS abgleich (
        id SERIAL PRIMARY KEY,
        ferienblock_id INTEGER REFERENCES ferienblock(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'offen',
        -- 'offen', 'abgeschlossen'
        erstellt_am TIMESTAMPTZ DEFAULT NOW(),
        abgeschlossen_am TIMESTAMPTZ
      );

      -- Einzelne Match-Entscheidungen
      CREATE TABLE IF NOT EXISTS abgleich_matches (
        id SERIAL PRIMARY KEY,
        abgleich_id INTEGER REFERENCES abgleich(id) ON DELETE CASCADE,
        liste_a_id INTEGER REFERENCES liste_a(id),
        liste_b_id INTEGER REFERENCES liste_b(id),
        match_typ VARCHAR(50) NOT NULL,
        -- 'exact', 'fuzzy_accepted', 'fuzzy_rejected', 'nur_in_a', 'nur_in_b'
        score INTEGER,
        grund TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Index für Performance
      CREATE INDEX IF NOT EXISTS idx_liste_a_ferienblock ON liste_a(ferienblock_id);
      CREATE INDEX IF NOT EXISTS idx_liste_b_ferienblock ON liste_b(ferienblock_id);
      CREATE INDEX IF NOT EXISTS idx_abgleich_ferienblock ON abgleich(ferienblock_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    // Standard-Admin anlegen falls noch keiner existiert
    // Passwort: "admin123" (gehashed) - beim ersten Login ändern!
    const bcrypt = require('bcryptjs');
    const defaultHash = await bcrypt.hash('admin123', 12);

    await client.query(`
      INSERT INTO users (username, password_hash)
      VALUES ('admin', $1)
      ON CONFLICT (username) DO NOTHING
    `, [defaultHash]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Datenbank erfolgreich eingerichtet. Standard-Login: admin / admin123 — Bitte sofort ändern!'
      })
    };

  } catch (err) {
    console.error('DB Setup Fehler:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  } finally {
    await client.end();
  }
};
