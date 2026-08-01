// Liste A aus der Firebase-Realtime-Datenbank holen.
//
// Portiert aus src/components/FirebaseImportModal.jsx, damit der Automatiklauf
// dieselbe Aufbereitung nutzt wie der Import von Hand.
//
// Die Datenbank ist ohne Anmeldung lesbar — der Schutz liegt allein darin, dass
// die Inhalte mit dem Passwort der Offline-App AES-verschlüsselt sind.

const CryptoJS = require('crypto-js');
const { toYmd } = require('./datum');

const FIREBASE_URL = 'https://schule-f388f-default-rtdb.europe-west1.firebasedatabase.app';

const entschluessele = (verschluesselt, passwort) => {
  const bytes = CryptoJS.AES.decrypt(verschluesselt, passwort);
  const klartext = bytes.toString(CryptoJS.enc.Utf8);
  if (!klartext) return null;
  return JSON.parse(klartext);
};

// specialDays ist ein verschlüsselter String, klassen ein Objekt aus
// verschlüsselten Strings je Klasse.
const entschluesseleDaten = (roh, passwort) => {
  if (!roh || typeof roh !== 'object') throw new Error('Unbekanntes Datenformat aus Firebase');

  const ergebnis = { specialDays: [], klassen: {} };

  ergebnis.specialDays = typeof roh.specialDays === 'string'
    ? entschluessele(roh.specialDays, passwort)
    : (roh.specialDays || []);

  if (roh.klassen && typeof roh.klassen === 'object') {
    for (const [key, val] of Object.entries(roh.klassen)) {
      ergebnis.klassen[key] = typeof val === 'string' ? entschluessele(val, passwort) : val;
    }
  }

  return ergebnis;
};

/**
 * Wandelt die Anwesenheitsdaten in Liste-A-Einträge um, begrenzt auf den
 * Zeitraum des Ferienblocks.
 *
 * Der Schlüssel in `attendance` ist "<personId>_<YYYY-MM-DD>", der Name steht
 * als "Vorname Nachname" in `people` — letztes Wort ist der Nachname.
 */
const baueEintraege = (klassen, vonYmd, bisYmd) => {
  const eintraege = [];

  for (const [klassKey, klassData] of Object.entries(klassen || {})) {
    if (!klassData) continue;
    const klasse = klassKey.replace('class', '');

    const namen = {};
    for (const person of (klassData.people || [])) namen[person.id] = person.name;

    for (const [key, anwesend] of Object.entries(klassData.attendance || {})) {
      if (!anwesend) continue;
      const datum = key.slice(-10);
      if (datum < vonYmd || datum > bisYmd) continue;

      const personId = key.slice(0, -11);
      const vollerName = namen[personId];
      if (!vollerName) continue;

      // Kommas entfernen ("Alexandru, Dita" -> "Alexandru Dita")
      const sauber = vollerName.replace(/,/g, '').replace(/\s+/g, ' ').trim();
      const idx = sauber.lastIndexOf(' ');
      const vorname = idx > 0 ? sauber.slice(0, idx).trim() : sauber;
      const nachname = idx > 0 ? sauber.slice(idx + 1).trim() : '';
      if (!nachname) continue;

      eintraege.push({ nachname, vorname, datum, klasse });
    }
  }

  return eintraege;
};

/**
 * Holt Liste A für einen Ferienblock.
 * @param {{startdatum:any, enddatum:any}} block — Zeilen aus der Tabelle ferienblock
 */
const holeListeA = async (block) => {
  const passwort = process.env.FIREBASE_PASSWORD;
  if (!passwort) {
    const err = new Error('FIREBASE_PASSWORD ist nicht gesetzt');
    err.code = 'NO_CREDENTIALS';
    throw err;
  }

  const res = await fetch(`${FIREBASE_URL}/.json`);
  if (!res.ok) throw new Error(`Firebase antwortete mit HTTP ${res.status}`);
  const roh = await res.json();
  if (!roh) throw new Error('Keine Daten in Firebase gefunden');

  let daten;
  try {
    daten = entschluesseleDaten(roh, passwort);
  } catch {
    const err = new Error('Entschlüsselung fehlgeschlagen — stimmt FIREBASE_PASSWORD?');
    err.code = 'DECRYPT_FAILED';
    throw err;
  }
  if (!daten.specialDays || !Array.isArray(daten.specialDays)) {
    throw new Error('Keine Ferienzeiträume in Firebase gefunden');
  }

  const von = toYmd(block.startdatum);
  const bis = toYmd(block.enddatum);

  // Im Modal wählt ein Mensch den Firebase-Ferienzeitraum aus. Automatisch
  // nehmen wir alle, die den Prüfer-Block überlappen — und schneiden auf die
  // Schnittmenge zu.
  //
  // Das Zuschneiden ist nicht nur Kosmetik: `attendance` enthält auch
  // Anwesenheiten außerhalb der Ferien. Wäre der Prüfer-Block breiter als der
  // Firebase-Zeitraum, kämen sonst normale Schultage in Liste A.
  const passend = daten.specialDays.filter(sd => sd.startDate <= bis && sd.endDate >= von);

  if (passend.length === 0) {
    const err = new Error(`Kein Firebase-Ferienzeitraum überlappt den Block ${von} – ${bis}`);
    err.code = 'NO_PERIOD';
    throw err;
  }

  const gesehen = new Set();
  const eintraege = [];
  for (const sd of passend) {
    const abschnittVon = sd.startDate > von ? sd.startDate : von;
    const abschnittBis = sd.endDate < bis ? sd.endDate : bis;
    for (const e of baueEintraege(daten.klassen, abschnittVon, abschnittBis)) {
      // Überlappende Zeiträume dürfen kein Kind doppelt eintragen.
      const key = `${e.nachname}|${e.vorname}|${e.datum}`.toLowerCase();
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      eintraege.push(e);
    }
  }

  return { eintraege, von, bis, zeitraeume: passend.map(sd => sd.name) };
};

module.exports = { holeListeA, entschluesseleDaten, baueEintraege, FIREBASE_URL };
