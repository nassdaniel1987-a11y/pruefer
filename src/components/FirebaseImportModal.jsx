import React, { useState } from 'react';
import CryptoJS from 'crypto-js';
import { fmtDate } from '../utils/helpers';

const FIREBASE_URL = 'https://schule-f388f-default-rtdb.europe-west1.firebasedatabase.app';

const decryptValue = (encryptedStr, password) => {
  const bytes = CryptoJS.AES.decrypt(encryptedStr, password);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) return null;
  return JSON.parse(decrypted);
};

const decryptFirebaseData = (rawData, password) => {
  if (!rawData || typeof rawData !== 'object') throw new Error('Unbekanntes Datenformat');

  const result = {};

  // specialDays: direkter verschlüsselter String
  if (typeof rawData.specialDays === 'string') {
    result.specialDays = decryptValue(rawData.specialDays, password);
  } else {
    result.specialDays = rawData.specialDays || [];
  }

  // klassen: Objekt mit verschlüsselten Strings pro Klasse
  if (rawData.klassen && typeof rawData.klassen === 'object') {
    result.klassen = {};
    for (const [key, val] of Object.entries(rawData.klassen)) {
      if (typeof val === 'string') {
        result.klassen[key] = decryptValue(val, password);
      } else {
        result.klassen[key] = val;
      }
    }
  } else {
    result.klassen = {};
  }

  return result;
};

const countEntries = (specialDay, klassen) => {
  const start = specialDay.startDate;
  const end = specialDay.endDate;
  let count = 0;
  for (const klassData of Object.values(klassen)) {
    if (!klassData) continue;
    const attendance = klassData.attendance || {};
    for (const [key, present] of Object.entries(attendance)) {
      if (!present) continue;
      const date = key.slice(-10);
      if (date >= start && date <= end) count++;
    }
  }
  return count;
};

const buildEintraege = (specialDay, klassen, ferienblock) => {
  const fbStart = ferienblock ? String(ferienblock.startdatum).split('T')[0] : specialDay.startDate;
  const fbEnd = ferienblock ? String(ferienblock.enddatum).split('T')[0] : specialDay.endDate;
  const filterStart = fbStart > specialDay.startDate ? fbStart : specialDay.startDate;
  const filterEnd = fbEnd < specialDay.endDate ? fbEnd : specialDay.endDate;

  const eintraege = [];

  for (const [klassKey, klassData] of Object.entries(klassen)) {
    if (!klassData) continue;
    const klasse = klassKey.replace('class', '');
    const people = klassData.people || [];
    const peopleMap = {};
    for (const person of people) {
      peopleMap[person.id] = person.name;
    }
    const attendance = klassData.attendance || {};
    for (const [key, present] of Object.entries(attendance)) {
      if (!present) continue;
      const date = key.slice(-10);
      if (date < filterStart || date > filterEnd) continue;
      const personId = key.slice(0, -11);
      const fullName = peopleMap[personId];
      if (!fullName) continue;
      const spaceIdx = fullName.lastIndexOf(' ');
      const vorname = spaceIdx > 0 ? fullName.slice(0, spaceIdx).trim() : fullName;
      const nachname = spaceIdx > 0 ? fullName.slice(spaceIdx + 1).trim() : '';
      if (!nachname) continue;
      eintraege.push({ nachname, vorname, datum: date, klasse });
    }
  }

  return eintraege;
};

const FirebaseImportModal = ({ onClose, onImport, ferienblock }) => {
  const [password, setPassword] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [specialDays, setSpecialDays] = useState([]);
  const [klassen, setKlassen] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [previewCount, setPreviewCount] = useState(0);

  const handleFetch = async () => {
    if (!password) { setError('Bitte Passwort eingeben'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${FIREBASE_URL}/.json`);
      if (!res.ok) throw new Error(`Firebase: HTTP ${res.status}`);
      const rawData = await res.json();
      if (!rawData) throw new Error('Keine Daten in Firebase gefunden');
      let decrypted;
      try {
        decrypted = decryptFirebaseData(rawData, password);
      } catch {
        setError('Entschlüsselung fehlgeschlagen — falsches Passwort?');
        setLoading(false);
        return;
      }
      if (!decrypted.specialDays || !Array.isArray(decrypted.specialDays) || decrypted.specialDays.length === 0) {
        setError('Keine Ferienzeiträume in Firebase gefunden');
        setLoading(false);
        return;
      }
      setSpecialDays(decrypted.specialDays);
      setKlassen(decrypted.klassen || {});
      setStep(2);
    } catch (err) {
      setError(`Verbindungsfehler: ${err.message}`);
    }
    setLoading(false);
  };

  const handleSelectDay = (id) => {
    setSelectedId(id);
    const sd = specialDays.find(d => d.id === id);
    if (sd) setPreviewCount(countEntries(sd, klassen));
    else setPreviewCount(0);
  };

  const handleImport = () => {
    const sd = specialDays.find(d => d.id === selectedId);
    if (!sd) return;
    const eintraege = buildEintraege(sd, klassen, ferienblock);
    onImport(eintraege, sd.name);
  };

  const selectedDay = specialDays.find(d => d.id === selectedId);
  const noOverlap = selectedDay && ferienblock
    ? String(ferienblock.enddatum).split('T')[0] < selectedDay.startDate
      || String(ferienblock.startdatum).split('T')[0] > selectedDay.endDate
    : false;

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">cloud_download</span>
            Von Firebase laden
          </h2>
          <button className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={onClose}>
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Passwort */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-on-surface-variant">
                Gib das Passwort der Offline-App ein, um die Daten zu entschlüsseln.
              </p>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Passwort</label>
                <input
                  type="password"
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant bg-surface-container text-on-surface text-sm focus:outline-none focus:border-primary"
                  placeholder="Entschlüsselungspasswort"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFetch()}
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-error">{error}</p>}
              <button
                className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                onClick={handleFetch}
                disabled={loading}
              >
                {loading
                  ? <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span> Laden...</>
                  : <><span className="material-symbols-outlined text-sm">lock_open</span> Entschlüsseln & Laden</>
                }
              </button>
            </div>
          )}

          {/* Step 2: Ferienzeitraum wählen */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-on-surface-variant">Welchen Ferienzeitraum möchtest du importieren?</p>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Ferienzeitraum</label>
                <select
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant bg-surface-container text-on-surface text-sm focus:outline-none focus:border-primary"
                  value={selectedId}
                  onChange={e => handleSelectDay(e.target.value)}
                >
                  <option value="">– Zeitraum wählen –</option>
                  {specialDays.map(sd => (
                    <option key={sd.id} value={sd.id}>
                      {sd.name} ({fmtDate(sd.startDate)} – {fmtDate(sd.endDate)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedId && (
                <div className="rounded-xl bg-surface-container p-3 text-sm">
                  <p className="text-on-surface font-medium">{previewCount} Einträge gefunden</p>
                  {ferienblock && (
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      Prüfer-Block: {ferienblock.name} ({fmtDate(ferienblock.startdatum)} – {fmtDate(ferienblock.enddatum)})
                    </p>
                  )}
                  {noOverlap && (
                    <p className="text-xs text-warning mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">warning</span>
                      Zeiträume überlappen sich nicht — es werden 0 Einträge importiert.
                    </p>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-error">{error}</p>}

              <div className="flex gap-2">
                <button
                  className="flex-1 py-2.5 rounded-xl border-2 border-outline-variant/30 text-on-surface-variant font-semibold text-sm hover:bg-surface-container transition-colors"
                  onClick={() => setStep(1)}
                >
                  Zurück
                </button>
                <button
                  className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                  onClick={handleImport}
                  disabled={!selectedId || noOverlap}
                >
                  Importieren
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FirebaseImportModal;
