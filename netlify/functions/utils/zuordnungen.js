// Gemerkte Entscheidungen über unsichere Namenspaare.
//
// Der Abgleich findet Paare wie "Hans Müller" / "Hans Meier", die sich zu sehr
// ähneln, um sie zu ignorieren, und zu wenig, um sie automatisch zusammen-
// zulegen. Ohne Gedächtnis leitet jeder Lauf dieselben Paare neu her und meldet
// sie wochenlang erneut. Diese Tabelle hält die einmal getroffene Entscheidung
// fest, damit der Bestand offener Fälle sinkt statt konstant zu bleiben.
//
// Die Tabelle ist bewusst nicht an einen Ferienblock gebunden — ein Namenspaar
// bedeutet überall dasselbe.

const { zuordnungsSchluessel } = require('./vergleich');

const ENTSCHEIDUNGEN = ['gleich', 'verschieden'];

const normalisiere = (name) => String(name || '').trim().toLowerCase();

/**
 * Lädt alle Entscheidungen als Map für `vergleiche()`.
 *
 * Fehlt die Tabelle (Migration noch nicht gelaufen), wird eine leere Map
 * geliefert: der Abgleich soll deswegen nicht ausfallen, er verhält sich dann
 * lediglich wie vorher.
 */
const ladeZuordnungen = async (client) => {
  try {
    const res = await client.query('SELECT name_a, name_b, entscheidung FROM namens_zuordnung');
    return new Map(res.rows.map(r => [zuordnungsSchluessel(r.name_a, r.name_b), r.entscheidung]));
  } catch (e) {
    console.warn('namens_zuordnung nicht lesbar, Abgleich läuft ohne Gedächtnis:', e.message);
    return new Map();
  }
};

/**
 * Legt eine Entscheidung ab oder überschreibt eine bestehende.
 * @returns {{nameA:string, nameB:string, entscheidung:string}}
 */
const merkeZuordnung = async (client, { nameA, nameB, entscheidung, von }) => {
  if (!ENTSCHEIDUNGEN.includes(entscheidung)) {
    throw new Error(`Unbekannte Entscheidung: ${entscheidung}`);
  }
  const a = normalisiere(nameA);
  const b = normalisiere(nameB);
  if (!a || !b) throw new Error('Beide Namen werden benötigt');

  await client.query(`
    INSERT INTO namens_zuordnung (name_a, name_b, entscheidung, entschieden_von)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (name_a, name_b)
    DO UPDATE SET entscheidung = EXCLUDED.entscheidung,
                  entschieden_von = EXCLUDED.entschieden_von,
                  entschieden_am = NOW()
  `, [a, b, entscheidung, von || null]);

  return { nameA: a, nameB: b, entscheidung };
};

const listeZuordnungen = async (client) => {
  const res = await client.query(`
    SELECT id, name_a, name_b, entscheidung, entschieden_am, entschieden_von
    FROM namens_zuordnung
    ORDER BY entschieden_am DESC
  `);
  return res.rows;
};

const loescheZuordnung = async (client, id) => {
  const res = await client.query('DELETE FROM namens_zuordnung WHERE id = $1', [id]);
  return res.rowCount > 0;
};

module.exports = {
  ladeZuordnungen, merkeZuordnung, listeZuordnungen, loescheZuordnung,
  normalisiere, ENTSCHEIDUNGEN,
};
