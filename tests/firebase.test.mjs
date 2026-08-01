// Tests für die Aufbereitung der Liste-A-Daten aus Firebase.
//
// Der Datensatz wird hier mit demselben Verfahren verschlüsselt, das die
// Offline-App verwendet, und anschließend durch das Modul geschickt. Damit ist
// abgedeckt, dass Entschlüsselung, Namenszerlegung und Zeitraumfilter
// zusammenpassen — die Stellen, an denen ein Fehler still falsche Listen
// erzeugen würde.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CryptoJS = require('crypto-js');
const { entschluesseleDaten, baueEintraege, holeListeA } = require('../netlify/functions/utils/firebase.js');

const PASSWORT = 'geheim123';
const verschluessele = (obj) => CryptoJS.AES.encrypt(JSON.stringify(obj), PASSWORT).toString();

const klassen = {
  class3a: {
    people: [
      { id: 'p1', name: 'Hans Müller' },
      { id: 'p2', name: 'Anna Lena Schmidt' },
      { id: 'p3', name: 'Alexandru, Dita' },
      { id: 'p4', name: 'Ohnenachname' },
    ],
    attendance: {
      'p1_2026-08-03': true,
      'p1_2026-08-04': true,
      'p2_2026-08-03': true,
      'p3_2026-08-03': true,
      'p4_2026-08-03': true,
      'p1_2026-08-10': true,   // außerhalb des Zeitraums
      'p2_2026-08-04': false,  // abgemeldet
    },
  },
};

const rohdaten = {
  specialDays: verschluessele([
    { id: 's1', name: 'Sommerferien', startDate: '2026-08-03', endDate: '2026-08-07' },
  ]),
  klassen: { class3a: verschluessele(klassen.class3a) },
};

describe('entschluesseleDaten', () => {
  test('entschlüsselt Zeiträume und Klassen', () => {
    const d = entschluesseleDaten(rohdaten, PASSWORT);
    assert.equal(d.specialDays.length, 1);
    assert.equal(d.specialDays[0].name, 'Sommerferien');
    assert.equal(d.klassen.class3a.people.length, 4);
  });

  test('falsches Passwort schlägt fehl statt Unsinn zu liefern', () => {
    assert.throws(() => entschluesseleDaten(rohdaten, 'falsch'));
  });

  test('unbekanntes Format wird abgelehnt', () => {
    assert.throws(() => entschluesseleDaten(null, PASSWORT), /Unbekanntes Datenformat/);
  });
});

describe('baueEintraege', () => {
  const eintraege = baueEintraege(klassen, '2026-08-03', '2026-08-07');

  test('nur Tage im Zeitraum werden übernommen', () => {
    assert.ok(eintraege.every(e => e.datum >= '2026-08-03' && e.datum <= '2026-08-07'));
    assert.equal(eintraege.filter(e => e.datum === '2026-08-10').length, 0);
  });

  test('abgemeldete Tage fallen weg', () => {
    const anna = eintraege.filter(e => e.vorname === 'Anna Lena');
    assert.equal(anna.length, 1, 'nur der 03.08. ist gebucht');
  });

  test('letztes Wort ist der Nachname', () => {
    const hans = eintraege.find(e => e.nachname === 'Müller');
    assert.equal(hans.vorname, 'Hans');
  });

  test('mehrteilige Vornamen bleiben erhalten', () => {
    const anna = eintraege.find(e => e.nachname === 'Schmidt');
    assert.equal(anna.vorname, 'Anna Lena');
  });

  test('Kommas im Namen werden entfernt', () => {
    const dita = eintraege.find(e => e.nachname === 'Dita');
    assert.ok(dita, 'Eintrag mit Komma im Namen muss ankommen');
    assert.equal(dita.vorname, 'Alexandru');
  });

  test('Einträge ohne Nachnamen werden übersprungen', () => {
    assert.equal(eintraege.filter(e => e.vorname === 'Ohnenachname').length, 0);
  });

  test('Klasse wird aus dem Schlüssel abgeleitet', () => {
    assert.ok(eintraege.every(e => e.klasse === '3a'));
  });

  test('ein Kind mit zwei Tagen ergibt zwei Einträge', () => {
    const hans = eintraege.filter(e => e.nachname === 'Müller');
    assert.equal(hans.length, 2);
    assert.deepEqual(hans.map(e => e.datum).sort(), ['2026-08-03', '2026-08-04']);
  });

  test('leere Klassen ergeben eine leere Liste', () => {
    assert.deepEqual(baueEintraege({}, '2026-08-03', '2026-08-07'), []);
    assert.deepEqual(baueEintraege(null, '2026-08-03', '2026-08-07'), []);
  });
});

// Im Modal wählt ein Mensch den Ferienzeitraum. Automatisch wird er aus der
// Überlappung mit dem Prüfer-Block bestimmt — diese Tests halten fest, dass
// dabei richtig zugeschnitten wird.
describe('holeListeA — Zeitraumwahl ohne Rückfrage', () => {
  const mitDaten = (specialDays, klassenDaten = klassen.class3a) => {
    const roh = {
      specialDays: verschluessele(specialDays),
      klassen: { class3a: verschluessele(klassenDaten) },
    };
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => roh });
    return () => { globalThis.fetch = original; };
  };

  test('schneidet auf die Schnittmenge von Block und Ferienzeitraum zu', async () => {
    // Firebase kennt nur den 03.-04.08., der Prüfer-Block geht bis zum 07.08.
    // Der 10.08. darf trotz Anwesenheit nicht auftauchen.
    const zurueck = mitDaten([{ id: 's1', name: 'Kurz', startDate: '2026-08-03', endDate: '2026-08-04' }]);
    process.env.FIREBASE_PASSWORD = PASSWORT;
    try {
      const r = await holeListeA({ startdatum: '2026-08-03', enddatum: '2026-08-07' });
      assert.ok(r.eintraege.every(e => e.datum <= '2026-08-04'), 'nichts nach dem Firebase-Ende');
      assert.deepEqual(r.zeitraeume, ['Kurz']);
    } finally { zurueck(); }
  });

  test('nimmt mehrere überlappende Zeiträume ohne Doppelte', async () => {
    const zurueck = mitDaten([
      { id: 's1', name: 'Teil 1', startDate: '2026-08-03', endDate: '2026-08-05' },
      { id: 's2', name: 'Teil 2', startDate: '2026-08-04', endDate: '2026-08-07' },
    ]);
    process.env.FIREBASE_PASSWORD = PASSWORT;
    try {
      const r = await holeListeA({ startdatum: '2026-08-03', enddatum: '2026-08-07' });
      const schluessel = r.eintraege.map(e => `${e.nachname}|${e.vorname}|${e.datum}`);
      assert.equal(new Set(schluessel).size, schluessel.length, 'keine doppelten Einträge');
      assert.equal(r.zeitraeume.length, 2);
    } finally { zurueck(); }
  });

  test('meldet sich, wenn kein Zeitraum den Block überlappt', async () => {
    const zurueck = mitDaten([{ id: 's1', name: 'Ostern', startDate: '2026-04-01', endDate: '2026-04-10' }]);
    process.env.FIREBASE_PASSWORD = PASSWORT;
    try {
      await assert.rejects(
        () => holeListeA({ startdatum: '2026-08-03', enddatum: '2026-08-07' }),
        /überlappt den Block/
      );
    } finally { zurueck(); }
  });

  test('fehlendes Passwort wird als solches gemeldet', async () => {
    const zurueck = mitDaten([{ id: 's1', name: 'X', startDate: '2026-08-03', endDate: '2026-08-07' }]);
    const alt = process.env.FIREBASE_PASSWORD;
    delete process.env.FIREBASE_PASSWORD;
    try {
      await assert.rejects(
        () => holeListeA({ startdatum: '2026-08-03', enddatum: '2026-08-07' }),
        /FIREBASE_PASSWORD/
      );
    } finally { process.env.FIREBASE_PASSWORD = alt; zurueck(); }
  });
});
