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

    // ── Migration 3: Namen direkt in abgleich_matches speichern ──
    // Damit Vergleiche auch nach Neuimport der Listen funktionieren
    // (ON DELETE SET NULL setzt liste_a_id/liste_b_id auf NULL)
    try {
      await client.query(`
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS a_nachname VARCHAR(200);
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS a_vorname VARCHAR(200);
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS a_datum DATE;
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS a_klasse VARCHAR(20);
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS b_nachname VARCHAR(200);
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS b_vorname VARCHAR(200);
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS b_datum DATE;
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS b_klasse VARCHAR(20);
        ALTER TABLE abgleich_matches ADD COLUMN IF NOT EXISTS b_menu VARCHAR(200);
      `);

      // Bestehende Matches mit Namen füllen (einmalig, für alte Daten)
      await client.query(`
        UPDATE abgleich_matches am SET
          a_nachname = la.nachname,
          a_vorname  = la.vorname,
          a_datum    = la.datum,
          a_klasse   = la.klasse
        FROM liste_a la
        WHERE am.liste_a_id = la.id AND am.a_nachname IS NULL;
      `);
      await client.query(`
        UPDATE abgleich_matches am SET
          b_nachname = lb.nachname,
          b_vorname  = lb.vorname,
          b_datum    = lb.datum,
          b_klasse   = lb.klasse,
          b_menu     = lb.menu
        FROM liste_b lb
        WHERE am.liste_b_id = lb.id AND am.b_nachname IS NULL;
      `);

      results.push('✓ Namen-Spalten in abgleich_matches hinzugefügt + befüllt');
    } catch (e) {
      results.push('⚠ Namen-Spalten: ' + e.message);
    }

    // ── Migration 4: Angebote Tabellen ──
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS angebote (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          ferienblock_id INTEGER REFERENCES ferienblock(id) ON DELETE CASCADE,
          beschreibung TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS angebot_kinder (
          id SERIAL PRIMARY KEY,
          angebot_id INTEGER REFERENCES angebote(id) ON DELETE CASCADE,
          kind_id INTEGER REFERENCES kinder(id) ON DELETE CASCADE,
          UNIQUE(angebot_id, kind_id)
        );

        CREATE INDEX IF NOT EXISTS idx_angebot_kinder_angebot ON angebot_kinder(angebot_id);
        CREATE INDEX IF NOT EXISTS idx_angebot_kinder_kind ON angebot_kinder(kind_id);
      `);
      results.push('✓ Tabellen "angebote" und "angebot_kinder" erstellt');
    } catch (e) {
      results.push('⚠ Angebote-Tabellen: ' + e.message);
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
