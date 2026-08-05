// Tests für den serverseitigen Abgleich.
//
// Der automatische Lauf trifft Entscheidungen, die sonst ein Mensch trifft.
// Die wichtigste Zusicherung: nur sichere Treffer (ab 75 Punkten) werden
// automatisch zugeordnet — alles darunter landet als "unsicher" im Bericht
// und wird nicht stillschweigend zusammengelegt.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { vergleiche, proKind } = require('../netlify/functions/utils/vergleich.js');

// Baut Listenzeilen so, wie sie aus der Datenbank kommen.
let idZaehler = 0;
const zeile = (nachname, vorname, datum, klasse = '3a') => ({
  id: ++idZaehler, nachname, vorname, klasse, datum,
});

describe('vergleiche — Exakttreffer', () => {
  test('gleicher Name am gleichen Tag wird zugeordnet', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Müller', 'Hans', '2026-08-03')]
    );
    assert.equal(r.kennzahlen.exakt, 1);
    assert.equal(r.nurInA.length, 0);
    assert.equal(r.nurInB.length, 0);
    assert.equal(r.matchRows.filter(m => m.match_typ === 'exact').length, 1);
  });

  test('gleicher Name an verschiedenen Tagen zählt nicht als Treffer', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Müller', 'Hans', '2026-08-04')]
    );
    assert.equal(r.kennzahlen.exakt, 0);
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.nurInB.length, 1);
  });

  test('jeder Tag wird einzeln bewertet', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03'), zeile('Müller', 'Hans', '2026-08-04')],
      [zeile('Müller', 'Hans', '2026-08-03')]
    );
    assert.equal(r.kennzahlen.exakt, 1);
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.nurInA[0].date, '2026-08-04');
  });
});

describe('vergleiche — automatische Zuordnung', () => {
  test('Schreibvariante wird automatisch zugeordnet', () => {
    const r = vergleiche(
      [zeile('Schneider', 'Sophie', '2026-08-03')],
      [zeile('Schneider', 'Sofie', '2026-08-03')]
    );
    assert.equal(r.kennzahlen.automatisch, 1, 'Sophie/Sofie sollte sicher genug sein');
    assert.equal(r.nurInA.length, 0);
    assert.equal(r.nurInB.length, 0);
  });

  test('vertauschter Vor- und Nachname in Liste B wird erkannt', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Hans', 'Müller', '2026-08-03')]
    );
    assert.equal(r.nurInA.length, 0, 'vertauschte Namen dürfen nicht als fehlend gelten');
  });

  test('Zuordnung passiert nur tagesgleich', () => {
    const r = vergleiche(
      [zeile('Schneider', 'Sophie', '2026-08-03')],
      [zeile('Schneider', 'Sofie', '2026-08-05')]
    );
    assert.equal(r.kennzahlen.automatisch, 0);
    assert.equal(r.nurInA.length, 1);
  });
});

describe('vergleiche — unsichere Paare', () => {
  test('gleicher Vorname, anderer Nachname wird nicht zugeordnet', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Meier', 'Hans', '2026-08-03')]
    );
    assert.equal(r.kennzahlen.automatisch, 0, 'darf nicht automatisch zusammengelegt werden');
    assert.equal(r.unsicher.length, 1, 'muss als unsicher im Bericht auftauchen');
    assert.ok(r.unsicher[0].score < 75);
  });

  test('unsichere Paare erscheinen zusätzlich in beiden Fehllisten', () => {
    // Bewusst so: es gibt keinen Match-Typ für "unentschieden". Der Bericht
    // weist sie gesondert aus, damit die Doppelung erklärbar ist.
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Meier', 'Hans', '2026-08-03')]
    );
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.nurInB.length, 1);
  });

  test('unsichere Paare stehen nicht in den gespeicherten Zuordnungen', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Meier', 'Hans', '2026-08-03')]
    );
    const zugeordnet = r.matchRows.filter(m => m.liste_a_id && m.liste_b_id);
    assert.equal(zugeordnet.length, 0);
  });

  test('völlig verschiedene Namen gelten schlicht als fehlend', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Schmidt', 'Peter', '2026-08-03')]
    );
    assert.equal(r.unsicher.length, 0);
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.nurInB.length, 1);
  });
});

describe('vergleiche — Mehrfachzuordnung', () => {
  test('ein Eintrag wird höchstens einmal zugeordnet', () => {
    // Zwei ähnliche B-Einträge am selben Tag: nur einer darf den A-Eintrag bekommen.
    const r = vergleiche(
      [zeile('Schneider', 'Sophie', '2026-08-03')],
      [zeile('Schneider', 'Sofie', '2026-08-03'), zeile('Schneider', 'Sophia', '2026-08-03')]
    );
    const belegteA = r.matchRows.filter(m => m.liste_a_id && m.liste_b_id).map(m => m.liste_a_id);
    assert.equal(new Set(belegteA).size, belegteA.length, 'kein A-Eintrag darf doppelt zugeordnet sein');
    assert.ok(r.nurInB.length >= 1, 'der überzählige B-Eintrag muss übrig bleiben');
  });
});

describe('vergleiche — leere Listen', () => {
  test('beide leer ergibt ein leeres Ergebnis', () => {
    const r = vergleiche([], []);
    assert.equal(r.matchRows.length, 0);
    assert.equal(r.kennzahlen.eintraegeA, 0);
  });

  test('nur Liste A gefüllt: alle fehlen in B', () => {
    const r = vergleiche([zeile('Müller', 'Hans', '2026-08-03')], []);
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.matchRows.filter(m => m.match_typ === 'nur_in_a').length, 1);
  });

  test('nur Liste B gefüllt: alle sind nicht angemeldet', () => {
    const r = vergleiche([], [zeile('Müller', 'Hans', '2026-08-03')]);
    assert.equal(r.nurInB.length, 1);
    assert.equal(r.matchRows.filter(m => m.match_typ === 'nur_in_b').length, 1);
  });
});

describe('proKind', () => {
  test('fasst mehrere Tage eines Kindes zusammen', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-04'), zeile('Müller', 'Hans', '2026-08-03')],
      []
    );
    const kinder = proKind(r.nurInA);
    assert.equal(kinder.length, 1);
    assert.deepEqual(kinder[0].tage, ['2026-08-03', '2026-08-04'], 'Tage müssen sortiert sein');
    assert.equal(kinder[0].name, 'Hans Müller');
  });

  test('sortiert nach Name', () => {
    const r = vergleiche(
      [zeile('Zimmermann', 'Anna', '2026-08-03'), zeile('Bauer', 'Ben', '2026-08-03')],
      []
    );
    const kinder = proKind(r.nurInA);
    assert.equal(kinder[0].name, 'Anna Zimmermann');
    assert.equal(kinder[1].name, 'Ben Bauer');
  });
});

describe('vergleiche — gemerkte Namenszuordnungen', () => {
  // "Hans Müller" gegen "Hans Meier": gleicher Vorname, Nachname zu
  // unterschiedlich für eine automatische Zuordnung. Genau der Fall, den ein
  // Mensch einmal entscheiden soll — und der danach nie wieder auftauchen darf.
  const listen = () => [
    [zeile('Müller', 'Hans', '2026-08-03')],
    [zeile('Meier', 'Hans', '2026-08-03')],
  ];
  const schluessel = 'hans müller|||hans meier';

  test('ohne Entscheidung bleibt das Paar unsicher', () => {
    const [a, b] = listen();
    const r = vergleiche(a, b);
    assert.equal(r.unsicher.length, 1);
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.nurInB.length, 1);
  });

  test('"gleich" ordnet das Paar zu, trotz zu niedrigem Punktwert', () => {
    const [a, b] = listen();
    const r = vergleiche(a, b, new Map([[schluessel, 'gleich']]));
    assert.equal(r.unsicher.length, 0, 'darf nicht mehr zur Prüfung anstehen');
    assert.equal(r.nurInA.length, 0);
    assert.equal(r.nurInB.length, 0);
    const zugeordnet = r.matchRows.filter(m => m.liste_a_id && m.liste_b_id);
    assert.equal(zugeordnet.length, 1);
    assert.equal(zugeordnet[0].match_typ, 'fuzzy_accepted');
    assert.match(zugeordnet[0].grund, /manuell bestätigt/);
  });

  test('"verschieden" lässt beide Seiten offen, aber ohne Rückfrage', () => {
    const [a, b] = listen();
    const r = vergleiche(a, b, new Map([[schluessel, 'verschieden']]));
    assert.equal(r.unsicher.length, 0, 'darf nicht mehr zur Prüfung anstehen');
    assert.equal(r.nurInA.length, 1);
    assert.equal(r.nurInB.length, 1);
    const zugeordnet = r.matchRows.filter(m => m.liste_a_id && m.liste_b_id);
    assert.equal(zugeordnet.length, 0);
  });

  test('ein einfaches Objekt tut es auch', () => {
    const [a, b] = listen();
    const r = vergleiche(a, b, { [schluessel]: 'gleich' });
    assert.equal(r.unsicher.length, 0);
  });

  test('eine fremde Entscheidung ändert nichts', () => {
    const [a, b] = listen();
    const r = vergleiche(a, b, new Map([['ganz andere|||namen', 'gleich']]));
    assert.equal(r.unsicher.length, 1);
  });

  test('starke Treffer bleiben stark, auch ohne Eintrag', () => {
    // Absicherung, dass das Gedächtnis nur ergänzt und nichts wegnimmt.
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Mueller', 'Hans', '2026-08-03')],
      new Map()
    );
    assert.equal(r.nurInA.length, 0);
    assert.equal(r.nurInB.length, 0);
  });
});

describe('Kennzahlen', () => {
  test('zählen Kinder, nicht Zeilen', () => {
    const r = vergleiche(
      [zeile('Müller', 'Hans', '2026-08-03'), zeile('Müller', 'Hans', '2026-08-04')],
      [zeile('Müller', 'Hans', '2026-08-03')]
    );
    assert.equal(r.kennzahlen.eintraegeA, 2);
    assert.equal(r.kennzahlen.kinderA, 1);
  });
});
