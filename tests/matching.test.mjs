// Tests für das Namens-Matching — den Kern, an dem die Abrechnung hängt.
//
// Zwei Aufgaben:
//   1. das Verhalten festhalten (was soll matchen, was nicht)
//   2. sicherstellen, dass die CommonJS-Spiegelung in den Netlify Functions
//      exakt dieselben Ergebnisse liefert wie die Frontend-Fassung
//
// Ausführen: npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import * as esm from '../src/utils/matching.js';

const require = createRequire(import.meta.url);
const cjs = require('../netlify/functions/utils/nameMatch.js');

// Namenspaare, wie sie zwischen Anmeldeliste und Caterer-Liste vorkommen.
const paare = [
  ['Hans Müller', 'Hans Müller'],
  ['Hans Müller', 'Müller Hans'],
  ['Hans Müller', 'Johannes Müller'],
  ['Alexander Schmidt', 'Alex Schmidt'],
  ['Maximilian Weber', 'Max Weber'],
  ['Anna-Lena Meier', 'Anna Lena Meier'],
  ['Sophie Schneider', 'Sofie Schneider'],
  ['Müller-Lüdenscheidt, Klara', 'Klara Müller-Lüdenscheidt'],
  ['Hans Müller', 'Hans Meier'],
  ['Hans Müller', 'Peter Schmidt'],
  ['Lukas Braun', 'Lucas Braun'],
  ['Jörg Krause', 'Georg Krause'],
  ['Katharina von Hohenberg', 'Katharina Hohenberg'],
  ['Tim Schulz', 'Tom Schulz'],
  ['', 'Hans Müller'],
  ['Hans Müller', ''],
];

describe('calcScore — Verhalten', () => {
  test('identische Namen erreichen die volle Punktzahl', () => {
    assert.equal(esm.calcScore('Hans Müller', 'Hans Müller').score, 100);
  });

  test('vertauschte Reihenfolge wird erkannt', () => {
    const { score } = esm.calcScore('Hans Müller', 'Müller Hans');
    assert.ok(score >= 75, `erwartet >= 75, war ${score}`);
  });

  test('Spitzname wird aufgelöst', () => {
    const { score } = esm.calcScore('Alexander Schmidt', 'Alex Schmidt');
    assert.ok(score >= 75, `erwartet >= 75, war ${score}`);
  });

  test('Schreibvariante wird über Phonetik erkannt', () => {
    const { score } = esm.calcScore('Sophie Schneider', 'Sofie Schneider');
    assert.ok(score >= 75, `erwartet >= 75, war ${score}`);
  });

  test('gleicher Vorname, anderer Nachname wird nie automatisch zugeordnet', () => {
    // Wichtig für die Abrechnung: solche Paare dürfen die Schwelle für einen
    // sicheren Treffer (75) nicht erreichen. Sie landen bewusst im Bereich
    // der manuellen Prüfung — das Nachnamen-Gate greift hier nicht, weil es
    // beliebige Token-Paare akzeptiert und schon der gleiche Vorname es erfüllt.
    const { score } = esm.calcScore('Hans Müller', 'Hans Schmidt');
    assert.ok(score < 75, `darf nicht automatisch matchen, war ${score}`);
  });

  test('völlig verschiedener Nachname wird durch das Gate gedeckelt', () => {
    // Ohne jede Token-Übereinstimmung greift die Deckelung auf 40.
    const { score } = esm.calcScore('Hans Müller', 'Peter Schmidt');
    assert.ok(score <= 40, `erwartet <= 40, war ${score}`);
  });

  test('völlig verschiedene Namen matchen nicht', () => {
    const { score } = esm.calcScore('Hans Müller', 'Peter Schmidt');
    assert.ok(score < 60, `erwartet < 60, war ${score}`);
  });

  test('leerer Name ergibt 0', () => {
    assert.equal(esm.calcScore('', 'Hans Müller').score, 0);
    assert.equal(esm.calcScore('Hans Müller', '').score, 0);
  });

  test('nicht-String-Eingaben stürzen nicht ab', () => {
    assert.equal(esm.calcScore(null, 'Hans Müller').score, 0);
    assert.equal(esm.calcScore(undefined, undefined).score, 0);
  });
});

describe('tokenizeName', () => {
  test('Umlaute werden umschrieben', () => {
    assert.deepEqual(esm.tokenizeName('Müller Öz Ärger'), ['mueller', 'oez', 'aerger']);
  });

  test('Namenszusätze fallen weg', () => {
    assert.deepEqual(esm.tokenizeName('Katharina von Hohenberg'), ['katharina', 'hohenberg']);
  });

  test('Bindestrichnamen werden getrennt', () => {
    assert.deepEqual(esm.tokenizeName('Anna-Lena'), ['anna', 'lena']);
  });

  test('Spitznamen werden ersetzt', () => {
    assert.deepEqual(esm.tokenizeName('Max'), ['maximilian']);
  });
});

describe('koelnerPhonetik', () => {
  test('gleich klingende Schreibweisen ergeben denselben Code', () => {
    assert.equal(esm.koelnerPhonetik('Meier'), esm.koelnerPhonetik('Mayer'));
    assert.equal(esm.koelnerPhonetik('Schmidt'), esm.koelnerPhonetik('Schmitt'));
  });

  test('verschiedene Namen ergeben verschiedene Codes', () => {
    assert.notEqual(esm.koelnerPhonetik('Müller'), esm.koelnerPhonetik('Schmidt'));
  });

  test('leere Eingabe ergibt leeren Code', () => {
    assert.equal(esm.koelnerPhonetik(''), '');
  });
});

describe('jaroWinkler', () => {
  test('identische Zeichenketten ergeben 1', () => {
    assert.equal(esm.jaroWinkler('mueller', 'mueller'), 1);
  });

  test('Wert liegt immer zwischen 0 und 1', () => {
    for (const [a, b] of paare) {
      const v = esm.jaroWinkler(a.toLowerCase(), b.toLowerCase());
      assert.ok(v >= 0 && v <= 1, `${a} / ${b} ergab ${v}`);
    }
  });
});

describe('Frontend und Backend liefern dasselbe', () => {
  test('calcScore stimmt über alle Namenspaare überein', () => {
    for (const [a, b] of paare) {
      assert.deepEqual(
        cjs.calcScore(a, b),
        esm.calcScore(a, b),
        `Abweichung bei "${a}" / "${b}" — die beiden Fassungen sind auseinandergelaufen`
      );
    }
  });

  test('tokenizeName stimmt überein', () => {
    for (const [a] of paare) {
      assert.deepEqual(cjs.tokenizeName(a), esm.tokenizeName(a), `Abweichung bei "${a}"`);
    }
  });

  test('koelnerPhonetik stimmt überein', () => {
    for (const [a] of paare) {
      assert.equal(cjs.koelnerPhonetik(a), esm.koelnerPhonetik(a), `Abweichung bei "${a}"`);
    }
  });

  test('analyzeMatch stimmt überein', () => {
    for (const [a, b] of paare) {
      if (!a || !b) continue;
      assert.deepEqual(cjs.analyzeMatch(a, b), esm.analyzeMatch(a, b), `Abweichung bei "${a}" / "${b}"`);
    }
  });
});
