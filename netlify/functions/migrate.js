// Einmalig aufrufen: https://pruefer.netlify.app/.netlify/functions/migrate
// Führt alle DB-Migrationen aus (idempotent — kann mehrfach aufgerufen werden)

const { Client } = require('pg');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const results = [];

  try {
    await client.connect();

    // ── Migration 1: Foreign Key Constraints fixen ──
    try {
      await client.query(`
        ALTER TABLE abgleich_matches
          DROP CONSTRAINT IF EXISTS abgleich_matches_liste_a_id_fkey;
        ALTER TABLE abgleich_matches
          DROP CONSTRAINT IF EXISTS abgleich_matches_liste_b_id_fkey;
        ALTER TABLE abgleich_matches
          ADD CONSTRAINT abgleich_matches_liste_a_id_fkey
          FOREIGN KEY (liste_a_id) REFERENCES liste_a(id) ON DELETE SET NULL;
        ALTER TABLE abgleich_matches
          ADD CONSTRAINT abgleich_matches_liste_b_id_fkey
          FOREIGN KEY (liste_b_id) REFERENCES liste_b(id) ON DELETE SET NULL;
      `);
      results.push('✓ FK Constraints auf abgleich_matches gefixt');
    } catch (e) {
      results.push('⚠ FK Constraints: ' + e.message);
    }

    // ── Migration 2: Kinder-Stammdaten Tabelle ──
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS kinder (
          id SERIAL PRIMARY KEY,
          nachname VARCHAR(200) NOT NULL,
          vorname VARCHAR(200) NOT NULL,
          klasse VARCHAR(20),
          notizen TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Unique Index auf lowercase nachname+vorname (verhindert Duplikate)
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kinder_name_unique
          ON kinder (LOWER(nachname), LOWER(vorname));

        -- Index für Suche
        CREATE INDEX IF NOT EXISTS idx_kinder_nachname ON kinder (LOWER(nachname));
        CREATE INDEX IF NOT EXISTS idx_kinder_vorname ON kinder (LOWER(vorname));
      `);
      results.push('✓ Tabelle "kinder" erstellt (mit Unique-Index)');
    } catch (e) {
      results.push('⚠ Kinder-Tabelle: ' + e.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Alle Migrationen durchgeführt',
        details: results
      })
    };

  } catch (err) {
    console.error('Migration Fehler:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message, details: results })
    };
  } finally {
    await client.end();
  }
};
