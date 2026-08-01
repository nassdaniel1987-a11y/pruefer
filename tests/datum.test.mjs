// Tests für die Datumsbehandlung.
//
// Anlass: node-postgres liefert DATE-Spalten als JS-Date zu lokaler
// Mitternacht. Die beiden früher im Code verwendeten Varianten waren beide
// falsch — String(date).split('T')[0] ergibt "", toISOString() verschiebt in
// Zeitzonen östlich von UTC um einen Tag. Diese Tests halten das fest.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toYmd } = require('../netlify/functions/utils/datum.js');
const { normalizeDate } = await import('../src/utils/helpers.js');

describe('toYmd', () => {
  test('Date-Objekt wird nach lokaler Zeit gelesen, nicht nach UTC', () => {
    // Genau der Fall, den toISOString() um einen Tag verschoben hätte.
    const d = new Date(2026, 4, 26, 0, 0, 0);
    assert.equal(toYmd(d), '2026-05-26');
  });

  test('funktioniert auch zum Jahreswechsel', () => {
    assert.equal(toYmd(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01');
    assert.equal(toYmd(new Date(2025, 11, 31, 23, 59, 0)), '2025-12-31');
  });

  test('reines Datum als String bleibt unverändert', () => {
    assert.equal(toYmd('2026-08-03'), '2026-08-03');
  });

  test('ISO-Zeitstempel wird nicht in eine andere Zone verschoben', () => {
    assert.equal(toYmd('2026-08-03T00:00:00.000Z'), '2026-08-03');
  });

  test('leere und ungültige Werte ergeben null', () => {
    assert.equal(toYmd(null), null);
    assert.equal(toYmd(undefined), null);
    assert.equal(toYmd(''), null);
    assert.equal(toYmd('kein Datum'), null);
    assert.equal(toYmd(new Date('kaputt')), null);
  });

  test('einstellige Monate und Tage werden aufgefüllt', () => {
    assert.equal(toYmd(new Date(2026, 0, 5)), '2026-01-05');
  });
});

describe('normalizeDate (Import aus Excel)', () => {
  test('deutsches Format wird erkannt', () => {
    assert.equal(normalizeDate('03.08.2026'), '2026-08-03');
  });

  test('ISO-Format bleibt erhalten', () => {
    assert.equal(normalizeDate('2026-08-03'), '2026-08-03');
  });

  test('Excel-Seriennummer wird umgerechnet', () => {
    // 45000 entspricht dem 15.03.2023 in Excels Tageszählung.
    assert.equal(normalizeDate(45000), '2023-03-15');
  });

  test('zweistellige Jahreszahl wird ergänzt', () => {
    assert.equal(normalizeDate('03.08.26'), '2026-08-03');
  });
});
