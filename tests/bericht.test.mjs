// Tests für den täglichen Bericht.
//
// Der Abgleich umfasst immer den ganzen Ferienblock, die Mail zeigt aber nur
// den heutigen Tag. Ohne diese Einschränkung stünden dieselben Einträge
// wochenlang jeden Morgen im Bericht.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { baueBericht } = require('../netlify/functions/utils/bericht.js');
const { vergleiche } = require('../netlify/functions/utils/vergleich.js');

let id = 0;
const zeile = (nachname, vorname, datum, klasse = '3a') => ({
  id: ++id, nachname, vorname, klasse, datum,
});

const block = { name: 'Sommerferien', startdatum: '2026-08-03', enddatum: '2026-08-07' };

const baue = (zeilenA, zeilenB, heute) => {
  const ergebnis = vergleiche(zeilenA, zeilenB);
  return baueBericht({
    block,
    ergebnis: { ...ergebnis, von: '2026-08-03', bis: '2026-08-07', heute },
    appUrl: 'https://example.test',
  });
};

describe('baueBericht — Tagesfokus', () => {
  test('zeigt nur Abweichungen des heutigen Tages', () => {
    const b = baue(
      [zeile('Müller', 'Hans', '2026-08-03'), zeile('Bauer', 'Ben', '2026-08-06')],
      [],
      '2026-08-03'
    );
    assert.match(b.html, /Hans Müller/, 'heutiger Fall muss drin sein');
    assert.doesNotMatch(b.html, /Ben Bauer/, 'späterer Tag darf nicht auftauchen');
    assert.match(b.text, /Hans Müller/);
    assert.doesNotMatch(b.text, /Ben Bauer/);
  });

  test('Betreff nennt Datum und die Zahlen des Tages', () => {
    const b = baue([zeile('Müller', 'Hans', '2026-08-03')], [], '2026-08-03');
    assert.match(b.betreff, /03\.08\.2026/);
    assert.match(b.betreff, /1 ohne Essen/);
  });

  test('Gesamtstand des Blocks bleibt als Einordnung sichtbar', () => {
    // Zwei offene Fälle im Block, davon einer heute.
    const b = baue(
      [zeile('Müller', 'Hans', '2026-08-03'), zeile('Bauer', 'Ben', '2026-08-06')],
      [],
      '2026-08-03'
    );
    assert.match(b.html, /Ganzer Block/);
    assert.match(b.html, /2 offene Fälle ohne Essen/);
  });

  test('ohne Abweichungen am heutigen Tag geht trotzdem eine Mail raus', () => {
    // Wichtig: sonst lässt sich "heute alles in Ordnung" nicht von
    // "die Automatik läuft nicht mehr" unterscheiden.
    const b = baue([zeile('Bauer', 'Ben', '2026-08-06')], [], '2026-08-03');
    assert.match(b.betreff, /keine Abweichungen/);
    assert.match(b.html, /keine Abweichungen/);
  });

  test('nicht angemeldete Kinder werden ebenfalls tagesgenau gefiltert', () => {
    const b = baue(
      [],
      [zeile('Klein', 'Klara', '2026-08-03'), zeile('Gross', 'Gerd', '2026-08-05')],
      '2026-08-03'
    );
    assert.match(b.html, /Klara Klein/);
    assert.doesNotMatch(b.html, /Gerd Gross/);
  });

  test('unsichere Paare erscheinen nur, wenn sie den heutigen Tag betreffen', () => {
    const heute = baue(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Meier', 'Hans', '2026-08-03')],
      '2026-08-03'
    );
    assert.match(heute.html, /Unsicher/);

    const anderertag = baue(
      [zeile('Müller', 'Hans', '2026-08-03')],
      [zeile('Meier', 'Hans', '2026-08-03')],
      '2026-08-05'
    );
    assert.doesNotMatch(anderertag.html, /Unsicher/);
  });

  test('mehrere Kinder am selben Tag werden alle gelistet', () => {
    const b = baue(
      [zeile('Müller', 'Hans', '2026-08-03'), zeile('Klein', 'Klara', '2026-08-03')],
      [],
      '2026-08-03'
    );
    assert.match(b.html, /Hans Müller/);
    assert.match(b.html, /Klara Klein/);
    assert.match(b.betreff, /2 ohne Essen/);
  });

  test('Namen werden für HTML maskiert', () => {
    const b = baue([zeile('<script>', 'Böse', '2026-08-03')], [], '2026-08-03');
    assert.doesNotMatch(b.html, /<script>/);
    assert.match(b.html, /&lt;script&gt;/);
  });
});
