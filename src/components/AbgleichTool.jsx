import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';
import { fmtDate, normalizeDate, scoreClass } from '../utils/helpers';
import { calcScore, tokenizeName, analyzeMatch } from '../utils/matching';
import Spinner from './Spinner';
import MiniExcel from './MiniExcel';
import FirebaseImportModal from './FirebaseImportModal';

const AbgleichTool = ({ blocks, initialBlockId, onReload }) => {
  const [blockId, setBlockId] = useState(initialBlockId || (blocks[0]?.id || ''));
  const [step, setStep] = useState(1);
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [rawA, setRawA] = useState(null);
  const [rawB, setRawB] = useState(null);
  const [colMapA, setColMapA] = useState({ nachname: '', vorname: '', date: '', klasse: '' });
  const [colMapB, setColMapB] = useState({ nachname: '', vorname: '', date: '', klasse: '' });
  const [potentialMatches, setPotentialMatches] = useState([]);
  const [reviewed, setReviewed] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listADb, setListADb] = useState([]);
  const [listBDb, setListBDb] = useState([]);
  const [comparisonSummary, setComparisonSummary] = useState(null); // { exact, fuzzy, onlyA, onlyB }
  const [usedDbForA, setUsedDbForA] = useState(false);
  const [usedDbForB, setUsedDbForB] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(null); // 'A', 'B' oder null
  const [showFirebaseModal, setShowFirebaseModal] = useState(false);
  const [firebaseImportInfo, setFirebaseImportInfo] = useState(null); // { count, blockName, eintraege }

  // Listen aus DB laden wenn Block gewählt
  useEffect(() => {
    if (!blockId) return;
    setListA([]); setListB([]); setRawA(null); setRawB(null);
    setStep(1); setPotentialMatches([]); setReviewed({});
    setComparisonSummary(null); setUsedDbForA(false); setUsedDbForB(false);
    API.get('listen', { ferienblock_id: blockId, liste: 'A' }).then(d => {
      setListADb(Array.isArray(d) ? d : []);
    });
    API.get('listen', { ferienblock_id: blockId, liste: 'B' }).then(d => {
      setListBDb(Array.isArray(d) ? d : []);
    });
  }, [blockId]);

  const processImportArray = (json, which) => {
    // Prüfen ob erste Zeile ein echter Header ist (Texte) oder schon Daten (Zahlen/bekannte Namen)
    const firstRow = json[0] || [];
    const hasTextHeader = firstRow.every(cell =>
      typeof cell === 'string' && !/^\d+$/.test(String(cell).trim()) && isNaN(cell)
    );

    let headers, dataRows;
    if (hasTextHeader) {
      headers = firstRow.map(h => String(h).trim());
      dataRows = json.slice(1);
    } else {
      headers = firstRow.map((_, i) => `Spalte ${String.fromCharCode(65 + i)}`);
      dataRows = json;
    }

    const raw = { headers, data: dataRows, hasTextHeader };
    const autoKlasse = hasTextHeader ? headers.find(h => /klasse/i.test(h)) || '' : '';
    if (which === 'A') { setRawA(raw); setColMapA({ nachname: '', vorname: '', date: '', klasse: autoKlasse }); }
    else { setRawB(raw); setColMapB({ nachname: '', vorname: '', date: '', klasse: autoKlasse }); }
    setIsLoading(false);
  };

  const handleExcelUpload = (file, which) => {
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      if (!json || json.length === 0) { setIsLoading(false); return; }
      processImportArray(json, which);
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePasteData = (e, which) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    setIsLoading(true);
    const rawRows = text.trim().split('\n');
    if (rawRows.length < 2) { toast.error('Mindestens 2 Zeilen (Kopfzeile + Daten) benötigt.'); setIsLoading(false); return; }

    // Tabulator-getrennte Tabelle parsen
    const json = rawRows.map(row => row.split('\t').map(c => c.trim()));
    processImportArray(json, which);
  };

  const handleFirebaseImport = async (eintraege, blockName) => {
    setShowFirebaseModal(false);
    setIsLoading(true);
    try {
      const res = await API.post('listen', { ferienblock_id: blockId, liste: 'A', eintraege });
      if (res.error) { toast.error('Import fehlgeschlagen: ' + res.error); setIsLoading(false); return; }
      toast.success(`${eintraege.length} Einträge aus Firebase importiert`);
      const freshA = await API.get('listen', { ferienblock_id: blockId, liste: 'A' });
      setListADb(Array.isArray(freshA) ? freshA : []);
      setFirebaseImportInfo({ count: eintraege.length, blockName, eintraege });
      try {
        const sync = await API.post('kinder', { action: 'sync' });
        if (sync.inserted > 0) toast.success(`${sync.inserted} neue Kinder ins Verzeichnis übernommen`);
      } catch (_) {}
    } catch (err) {
      toast.error('Fehler beim Firebase-Import');
    }
    setIsLoading(false);
  };

  const processAndUpload = async () => {
    setIsLoading(true);
    // Immer frisch starten — keine alten Entscheidungen behalten
    setPotentialMatches([]);
    setReviewed({});
    setComparisonSummary(null);
    // Merken welche Listen neu hochgeladen und welche aus DB kommen
    setUsedDbForA(!rawA || !colMapA.nachname);
    setUsedDbForB(!rawB || !colMapB.nachname);

    // Hilfsfunktion: Zeile -> { nachname, vorname, datum, ... }
    const buildEntry = (row, headers, cm, extraCols = {}) => {
      const ni = cm.nachname ? headers.indexOf(cm.nachname) : -1;
      const vi = cm.vorname ? headers.indexOf(cm.vorname) : -1;
      const di = cm.date ? headers.indexOf(cm.date) : -1;
      const nachname = ni >= 0 ? String(row[ni] || '').trim() : '';
      const vorname = vi >= 0 ? String(row[vi] || '').trim() : '';
      const datum = di >= 0 ? normalizeDate(row[di]) : null;
      if (!nachname && !vorname) return null;
      if (!datum) return null;
      const entry = { nachname, vorname, datum };
      for (const [key, idx] of Object.entries(extraCols)) {
        entry[key] = idx >= 0 ? row[idx] : null;
      }
      return entry;
    };

    // Block-Zeitraum für Validierung
    const block = blocks.find(b => String(b.id) === String(blockId));
    const blockStart = block ? String(block.startdatum).split('T')[0] : null;
    const blockEnd = block ? String(block.enddatum).split('T')[0] : null;
    const warnings = [];

    // Validierung: Einträge prüfen
    const validateEntries = (entries, label) => {
      let emptyNames = 0, outsideDates = 0, invalidDates = 0;
      entries.forEach(e => {
        if (!e.nachname || !e.vorname) emptyNames++;
        if (!e.datum || e.datum === 'Invalid Date' || e.datum === 'NaN-NaN-NaN') invalidDates++;
        else if (blockStart && blockEnd && (e.datum < blockStart || e.datum > blockEnd)) outsideDates++;
      });
      if (emptyNames > 0) warnings.push(`${label}: ${emptyNames} Zeilen ohne Name übersprungen`);
      if (invalidDates > 0) warnings.push(`${label}: ${invalidDates} Zeilen mit ungültigem Datum übersprungen`);
      if (outsideDates > 0) warnings.push(`${label}: ${outsideDates} Einträge liegen außerhalb des Block-Zeitraums (${fmtDate(blockStart)} – ${fmtDate(blockEnd)})`);
    };

    // Liste A verarbeiten (mit optionaler Klasse)
    let newA = [];
    if (rawA && colMapA.nachname) {
      const hA = rawA.headers;
      const extraColsA = {
        klasse: colMapA.klasse ? hA.indexOf(colMapA.klasse) : hA.findIndex(x => /klasse/i.test(x)),
      };
      newA = rawA.data.map(row => buildEntry(row, hA, colMapA, extraColsA)).filter(Boolean);
      validateEntries(newA, 'Liste A');
      await API.post('listen', { ferienblock_id: blockId, liste: 'A', eintraege: newA });
    }

    // Liste B verarbeiten (mit extra Spalten: Klasse, Menü, Kontostand)
    let newB = [];
    if (rawB && colMapB.nachname) {
      const h = rawB.headers;
      const extraCols = {
        klasse: colMapB.klasse ? h.indexOf(colMapB.klasse) : h.findIndex(x => /klasse/i.test(x)),
        menu: h.findIndex(x => /men[uü]/i.test(x)),
        kontostand: h.findIndex(x => /konto/i.test(x)),
      };
      newB = rawB.data.map(row => buildEntry(row, h, colMapB, extraCols)).filter(Boolean);
      validateEntries(newB, 'Liste B');
      await API.post('listen', { ferienblock_id: blockId, liste: 'B', eintraege: newB });
    }

    // Warnungen anzeigen
    if (warnings.length > 0) {
      warnings.forEach(w => toast.warn(w));
    }

    // Interne Listen für Abgleich aufbauen
    const toMatchList = (entries) => entries.map((e, i) => ({
      id: `${i}`, name: `${e.vorname} ${e.nachname}`.trim(), date: e.datum, dbId: e.id
    }));

    // DB neu laden
    const [freshA, freshB] = await Promise.all([
      API.get('listen', { ferienblock_id: blockId, liste: 'A' }),
      API.get('listen', { ferienblock_id: blockId, liste: 'B' })
    ]);
    setListADb(Array.isArray(freshA) ? freshA : []);
    setListBDb(Array.isArray(freshB) ? freshB : []);

    const buildName = (e) => [e.vorname, e.nachname].filter(Boolean).join(' ').trim();
    const mA = (Array.isArray(freshA) ? freshA : []).map((e) => ({ id: `a${e.id}`, dbId: e.id, name: buildName(e), date: String(e.datum).split('T')[0] }));
    const mB = (Array.isArray(freshB) ? freshB : []).map((e) => ({ id: `b${e.id}`, dbId: e.id, name: buildName(e), date: String(e.datum).split('T')[0] }));
    setListA(mA); setListB(mB);

    // Automatisch neue Kinder aus Liste A ins Kinder-Verzeichnis synchronisieren
    try {
      const syncRes = await API.post('kinder', { action: 'sync' });
      if (syncRes.inserted > 0) {
        toast.success(`${syncRes.inserted} neue Kinder ins Verzeichnis übernommen`);
      }
    } catch (e) { /* Sync-Fehler ignorieren — Listen-Import war erfolgreich */ }

    setIsLoading(false);
    setStep(3);
    runComparison(mA, mB);
  };

  const runComparison = (lA, lB) => {
    setIsLoading(true);
    requestAnimationFrame(() => {
      const mapB = new Map((lB).map(i => [`${i.name}|${i.date}`, i]));
      const exactA = (lA).filter(e => mapB.has(`${e.name}|${e.date}`));
      const nonA = (lA).filter(e => !mapB.has(`${e.name}|${e.date}`));
      const mapA = new Map((lA).map(i => [`${i.name}|${i.date}`, i]));
      const nonB = (lB).filter(e => !mapA.has(`${e.name}|${e.date}`));
      const byDate = nonB.reduce((acc, i) => { (acc[i.date] = acc[i.date] || []).push(i); return acc; }, {});
      const groups = {};
      for (const eA of nonA) {
        for (const eB of (byDate[eA.date] || [])) {
          const { score, reason } = calcScore(eA.name, eB.name);
          // Auch vertauschten B-Namen testen (falls Vor-/Nachname in Liste B vertauscht importiert)
          const tB = tokenizeName(eB.name);
          const eBswapped = tB.length >= 2 ? tB.slice().reverse().join(' ') : eB.name;
          const { score: scoreSwapped, reason: reasonSwapped } = calcScore(eA.name, eBswapped);
          const bestScore = Math.max(score, scoreSwapped);
          const bestReason = bestScore === scoreSwapped && scoreSwapped > score ? reasonSwapped : reason;
          if (bestScore >= 75) {
            // Key enthält beide Original-Namen um Kollisionen zu vermeiden
            const key = `${eA.name.toLowerCase()}|||${eB.name.toLowerCase()}`;
            if (!groups[key]) groups[key] = { nameA: eA.name, nameB: eB.name, score: bestScore, reason: bestReason, entries: [] };
            groups[key].entries.push({ entryA: eA, entryB: eB });
          }
        }
      }
      const fuzzyGroups = Object.values(groups).sort((a, b) => b.score - a.score);
      setPotentialMatches(fuzzyGroups);

      // Zusammenfassung: eindeutige A- und B-Einträge in Fuzzy-Gruppen zählen
      const fuzzyAIds = new Set();
      const fuzzyBIds = new Set();
      fuzzyGroups.forEach(g => g.entries.forEach(p => { fuzzyAIds.add(p.entryA.id); fuzzyBIds.add(p.entryB.id); }));
      setComparisonSummary({
        totalA: lA.length,
        totalB: lB.length,
        exact: exactA.length,
        exactKinder: new Set(exactA.map(e => e.name.toLowerCase())).size,
        fuzzyGroups: fuzzyGroups.length,
        fuzzyEntries: fuzzyAIds.size,
        onlyA: Math.max(0, nonA.length - fuzzyAIds.size),
        onlyB: Math.max(0, nonB.length - fuzzyBIds.size),
      });

      setIsLoading(false);
    });
  };

  const startComparisonFromDb = () => {
    const buildName = (e) => [e.vorname, e.nachname].filter(Boolean).join(' ').trim();
    const mA = listADb.map(e => ({ id: `a${e.id}`, dbId: e.id, name: buildName(e), date: String(e.datum).split('T')[0] }));
    const mB = listBDb.map(e => ({ id: `b${e.id}`, dbId: e.id, name: buildName(e), date: String(e.datum).split('T')[0] }));
    setListA(mA); setListB(mB);
    setPotentialMatches([]); setReviewed({}); setComparisonSummary(null);
    setUsedDbForA(true); setUsedDbForB(true);
    runComparison(mA, mB);
    setStep(3);
  };

  const handleGroupAction = (group, action) => {
    const nr = { ...reviewed };
    group.entries.forEach(p => { nr[`${p.entryA.id}-${p.entryB.id}`] = action; });
    setReviewed(nr);
  };

  const bulkAction = (action, threshold = 0) => {
    const nr = { ...reviewed };
    potentialMatches.filter(g => g.entries.some(e => !reviewed[`${e.entryA.id}-${e.entryB.id}`])).forEach(g => {
      if (action === 'accept' && g.score < threshold) return;
      g.entries.forEach(p => { nr[`${p.entryA.id}-${p.entryB.id}`] = action; });
    });
    setReviewed(nr);
  };

  const finalResults = useMemo(() => {
    if (!listA.length || !listB.length) return { matches: [], onlyInA: [], onlyInB: [] };
    const mapB = new Map(listB.map(i => [`${i.name}|${i.date}`, i.id]));
    const exactAIds = new Set();
    const exactBIds = new Set();
    listA.forEach(i => {
      const bId = mapB.get(`${i.name}|${i.date}`);
      if (bId !== undefined) { exactAIds.add(i.id); exactBIds.add(bId); }
    });
    const accA = new Set(), accB = new Set();
    potentialMatches.forEach(g => g.entries.forEach(p => {
      if (reviewed[`${p.entryA.id}-${p.entryB.id}`] === 'accept') { accA.add(p.entryA.id); accB.add(p.entryB.id); }
    }));
    return {
      matches: listA.filter(i => exactAIds.has(i.id) || accA.has(i.id)),
      onlyInA: listA.filter(i => !exactAIds.has(i.id) && !accA.has(i.id)),
      onlyInB: listB.filter(i => !exactBIds.has(i.id) && !accB.has(i.id))
    };
  }, [listA, listB, potentialMatches, reviewed]);

  const saveAbgleich = async () => {
    setSaving(true);
    const matchRows = [];

    // Exact matches
    const mapB = new Map(listB.map(i => [`${i.name}|${i.date}`, i]));
    listA.forEach(eA => {
      const eB = mapB.get(`${eA.name}|${eA.date}`);
      if (eB) matchRows.push({ liste_a_id: eA.dbId, liste_b_id: eB.dbId, match_typ: 'exact', score: 100, grund: 'Exakte Übereinstimmung' });
    });

    // Fuzzy matches
    potentialMatches.forEach(g => g.entries.forEach(p => {
      const st = reviewed[`${p.entryA.id}-${p.entryB.id}`];
      if (st === 'accept') matchRows.push({ liste_a_id: p.entryA.dbId, liste_b_id: p.entryB.dbId, match_typ: 'fuzzy_accepted', score: g.score, grund: g.reason });
      if (st === 'reject') matchRows.push({ liste_a_id: p.entryA.dbId, liste_b_id: p.entryB.dbId, match_typ: 'fuzzy_rejected', score: g.score, grund: g.reason });
    }));

    // Nur in A
    finalResults.onlyInA.forEach(e => matchRows.push({ liste_a_id: e.dbId, liste_b_id: null, match_typ: 'nur_in_a', score: null, grund: 'Keine Entsprechung in Liste B gefunden' }));

    // Nur in B
    finalResults.onlyInB.forEach(e => matchRows.push({ liste_a_id: null, liste_b_id: e.dbId, match_typ: 'nur_in_b', score: null, grund: 'Nicht in Liste A vorhanden' }));

    const res = await API.post('abgleich', { ferienblock_id: blockId, matches: matchRows });
    setSaving(false);
    if (res.success) {
      toast.success(res.patched ? 'Abgleich aktualisiert (Tage gepatcht)' : 'Abgleich gespeichert');
      setStep(4);
      if (onReload) onReload(); // Dashboard-Daten aktualisieren
    } else {
      toast.error('Fehler beim Speichern: ' + res.error);
    }
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const fmt = (d) => fmtDate(d);
    // Nur-in-A Sheet
    if (finalResults.onlyInA.length > 0) {
      const data = finalResults.onlyInA.map(i => {
        const parts = i.name.split(/\s+/);
        return { Vorname: parts.slice(0, -1).join(' '), Nachname: parts.pop() || '', Datum: fmt(i.date) };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Fehlt in Liste B');
    }
    // Nur-in-B Sheet
    if (finalResults.onlyInB.length > 0) {
      const data = finalResults.onlyInB.map(i => {
        const parts = i.name.split(/\s+/);
        return { Vorname: parts.slice(0, -1).join(' '), Nachname: parts.pop() || '', Datum: fmt(i.date) };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Keine Ferienanmeldung');
    }
    // Matches
    const matchData = finalResults.matches.map(i => {
      const parts = i.name.split(/\s+/);
      return { Vorname: parts.slice(0, -1).join(' '), Nachname: parts.pop() || '', Datum: fmt(i.date), Status: 'Bestätigt' };
    });
    if (matchData.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchData), 'Übereinstimmungen');

    if (wb.SheetNames.length) XLSX.writeFile(wb, 'Abgleich_Ergebnis.xlsx');
    else alert('Keine Daten zum Exportieren');
  };

  const openGroups = potentialMatches.filter(g => g.entries.some(e => !reviewed[`${e.entryA.id}-${e.entryB.id}`]));

  const ColMapper = ({ raw, colMap, onChange, label }) => {
    if (!raw) return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">folder_open</span>
        <p className="text-sm text-on-surface-variant">Noch keine Datei für Liste {label}</p>
      </div>
    );

    const previewCell = (val, colName) => {
      if (val === null || val === undefined || val === '') return '–';
      if (colName === colMap.date && typeof val === 'number' && val > 40000 && val < 60000) {
        return fmtDate(normalizeDate(val)) + ' ✓';
      }
      return String(val);
    };

    return (
      <div>
        <p className="text-sm text-on-surface-variant mb-3"><strong>{raw.data.length}</strong> Zeilen gefunden</p>
        {!raw.hasTextHeader && (
          <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-3 mb-3 text-sm text-error">
            <span className="material-symbols-outlined text-sm mr-1">warning</span>
            <strong>Keine Headerzeile erkannt!</strong> Die Spalten wurden automatisch benannt.
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Nachname *</label>
            <select className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={colMap.nachname}
              onChange={e => onChange({ ...colMap, nachname: e.target.value })}>
              <option value="">– wählen –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Vorname</label>
            <select className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={colMap.vorname}
              onChange={e => onChange({ ...colMap, vorname: e.target.value })}>
              <option value="">– optional –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Datum *</label>
            <select className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={colMap.date}
              onChange={e => onChange({ ...colMap, date: e.target.value })}>
              <option value="">– wählen –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Klasse</label>
            <select className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={colMap.klasse}
              onChange={e => onChange({ ...colMap, klasse: e.target.value })}>
              <option value="">– optional –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </div>

        <p className="text-xs text-on-surface-variant mb-2">Vorschau (erste 3 Zeilen):</p>
        <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
          <table className="w-full text-sm">
            <thead><tr className="bg-surface-container-low">
              {raw.headers.map(h => (
                <th key={h} className={`text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider ${(h === colMap.nachname || h === colMap.vorname) ? 'text-emerald-500' : h === colMap.date ? 'text-primary' : h === colMap.klasse ? 'text-tertiary' : 'text-outline'}`}>
                  {h}
                  {h === colMap.nachname && ' 👤'}
                  {h === colMap.vorname && ' 👤'}
                  {h === colMap.date && ' 📅'}
                  {h === colMap.klasse && ' 🏫'}
                </th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-outline-variant/5">
              {raw.data.slice(0, 3).map((row, i) => (
                <tr key={i}>{raw.headers.map((h, j) => (
                  <td key={j} className={`px-3 py-2 ${(h === colMap.nachname || h === colMap.vorname || h === colMap.date || h === colMap.klasse) ? 'font-bold' : ''} ${(h === colMap.nachname || h === colMap.vorname) ? 'text-emerald-500' : h === colMap.date ? 'text-primary' : h === colMap.klasse ? 'text-tertiary' : ''}`}>
                    {previewCell(row[j], h)}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Daten-Vergleich</span>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Abgleich-Tool</h2>
          <p className="text-sm text-on-surface-variant mt-1">Vergleiche Anmeldungen (A) mit Essensbuchungen (B)</p>
        </div>
      </div>

      {/* Ferienblock Auswahl */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10 mb-4">
        <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Ferienblock</label>
        <select className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
          value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
        </select>
      </div>

      {blockId && (
        <>
          {/* Wizard */}
          <div className="flex items-center gap-2 bg-surface-container-lowest rounded-2xl p-3 shadow-sm border border-outline-variant/10">
            {['Daten laden', 'Spalten zuordnen', 'Prüfen', 'Ergebnis'].map((n, i) => (
              <div key={i} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${step === i + 1 ? 'bg-primary text-on-primary shadow-sm' : step > i + 1 ? 'bg-emerald-500/10 text-emerald-500' : 'text-on-surface-variant'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${step === i + 1 ? 'bg-white/20' : step > i + 1 ? 'bg-emerald-500/20' : 'bg-surface-container-high'}`}>{step > i + 1 ? '✓' : i + 1}</span>{n}
              </div>
            ))}
          </div>

          {isLoading && <Spinner />}

          {/* SCHRITT 1: Daten laden */}
          {!isLoading && step === 1 && (
            <div>
              {(listADb.length > 0 || listBDb.length > 0) && (() => {
                const uniqueA = new Set(listADb.map(e => (e.nachname + '|' + e.vorname).toLowerCase())).size;
                const uniqueB = new Set(listBDb.map(e => (e.nachname + '|' + e.vorname).toLowerCase())).size;
                return <div className="flex items-center gap-3 flex-wrap bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 mb-4 text-sm text-on-surface">
                  <span className="material-symbols-outlined text-primary text-base">database</span>
                  <span>In der Datenbank vorhanden:
                    {listADb.length > 0 && <> <strong>{uniqueA} Kinder</strong> · {listADb.length} Tage (A)</>}
                    {listADb.length > 0 && listBDb.length > 0 && ', '}
                    {listBDb.length > 0 && <> <strong>{uniqueB} Kinder</strong> · {listBDb.length} Tage (B)</>}
                  </span>
                  {listADb.length > 0 && listBDb.length > 0 && (
                    <button className="px-3 py-1 text-xs font-semibold rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors" onClick={startComparisonFromDb}>Direkt vergleichen</button>
                  )}
                  <button className="px-3 py-1 text-xs font-medium rounded-lg text-error hover:bg-error/10 transition-colors flex items-center gap-1" onClick={async () => {
                    const ok = await confirmDialog('Alle Daten löschen', `Alle Listen (${listADb.length} A + ${listBDb.length} B) und gespeicherte Abgleiche löschen?`, 'Alles löschen');
                    if (!ok) return;
                    await Promise.all([
                      API.post('listen', { action: 'delete', ferienblock_id: blockId, liste: 'A' }),
                      API.post('listen', { action: 'delete', ferienblock_id: blockId, liste: 'B' }),
                      API.post('abgleich', { action: 'delete_all', ferienblock_id: blockId })
                    ]);
                    toast.success('Listen und Abgleiche gelöscht');
                    setListADb([]); setListBDb([]);
                    setListA([]); setListB([]);
                    setRawA(null); setRawB(null);
                    setPotentialMatches([]); setReviewed({});
                    setStep(1);
                  }}><span className="material-symbols-outlined text-sm">delete</span>Listen löschen</button>
                </div>;
              })()}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-primary">assignment</span>
                      Liste A – Anmeldungen
                    </span>
                  </div>
                  {rawA ? (
                    <div className="text-center py-4">
                      <span className="material-symbols-outlined text-3xl text-emerald-500 mb-2 block">check_circle</span>
                      <p className="text-on-surface font-medium mb-2">{rawA.data.length} Zeilen geladen</p>
                      <button className="px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => { setRawA(null); setColMapA({ nachname: '', vorname: '', date: '', klasse: '' }); }}>Ändern / Löschen</button>
                    </div>
                  ) : firebaseImportInfo ? (
                    <div className="py-2">
                      <div className="text-center mb-3">
                        <span className="material-symbols-outlined text-3xl text-emerald-500 mb-1 block">cloud_done</span>
                        <p className="text-on-surface font-medium">{firebaseImportInfo.count} Einträge aus Firebase</p>
                        <p className="text-xs text-on-surface-variant">{firebaseImportInfo.blockName}</p>
                      </div>
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-outline-variant/20 mb-3">
                        <table className="w-full text-xs">
                          <thead className="bg-surface-container sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-on-surface-variant font-medium text-left">Name</th>
                              <th className="px-2 py-1 text-on-surface-variant font-medium text-left">Datum</th>
                              <th className="px-2 py-1 text-on-surface-variant font-medium text-left">Kl.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {firebaseImportInfo.eintraege.map((e, i) => (
                              <tr key={i} className="border-t border-outline-variant/10">
                                <td className="px-2 py-1">{e.vorname} {e.nachname}</td>
                                <td className="px-2 py-1">{fmtDate(e.datum)}</td>
                                <td className="px-2 py-1">{e.klasse}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mb-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between gap-2">
                        <span className="text-xs text-primary flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">sync</span>
                          Kinder-Sync im Verzeichnis empfohlen
                        </span>
                      </div>
                      <button className="w-full px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setFirebaseImportInfo(null)}>
                        Löschen / Neu laden
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl p-6 cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
                        <input type="file" accept=".xlsx" className="hidden" onChange={e => handleExcelUpload(e.target.files[0], 'A')} />
                        <span className="material-symbols-outlined text-3xl text-on-surface-variant mb-1">upload_file</span>
                        <p className="text-sm text-on-surface-variant">Excel hochladen (.xlsx)</p>
                      </label>
                      <button className="w-full py-2.5 rounded-xl border-2 border-primary/30 text-primary font-semibold text-sm hover:bg-primary/10 transition-colors" onClick={() => setShowPasteModal('A')}>
                        oder Tabelle einfügen (Strg+V)
                      </button>
                      <button className="w-full py-2.5 rounded-xl border-2 border-secondary/30 text-secondary font-semibold text-sm hover:bg-secondary/10 transition-colors flex items-center justify-center gap-1.5" onClick={() => setShowFirebaseModal(true)}>
                        <span className="material-symbols-outlined text-sm">cloud_download</span>
                        Von Firebase laden
                      </button>
                    </div>
                  )}
                </div>
                <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-primary">restaurant</span>
                      Liste B – Essensbuchungen
                    </span>
                  </div>
                  {rawB ? (
                    <div className="text-center py-4">
                      <span className="material-symbols-outlined text-3xl text-emerald-500 mb-2 block">check_circle</span>
                      <p className="text-on-surface font-medium mb-2">{rawB.data.length} Zeilen geladen</p>
                      <button className="px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => { setRawB(null); setColMapB({ nachname: '', vorname: '', date: '', klasse: '' }); }}>Ändern / Löschen</button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl p-6 cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
                        <input type="file" accept=".xlsx" className="hidden" onChange={e => handleExcelUpload(e.target.files[0], 'B')} />
                        <span className="material-symbols-outlined text-3xl text-on-surface-variant mb-1">upload_file</span>
                        <p className="text-sm text-on-surface-variant">Excel hochladen (.xlsx)</p>
                      </label>
                      <button className="w-full py-2.5 rounded-xl border-2 border-primary/30 text-primary font-semibold text-sm hover:bg-primary/10 transition-colors" onClick={() => setShowPasteModal('B')}>
                        oder Tabelle einfügen (Strg+V)
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {(rawA || rawB) && (
                <div className="flex justify-end mt-4">
                  <button className="px-5 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors" onClick={() => setStep(2)} disabled={!rawA && !rawB}>
                    Weiter: Spalten zuordnen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* SCHRITT 2: Spalten zuordnen */}
          {!isLoading && step === 2 && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10">
                  <div className="font-semibold text-on-surface mb-3 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-primary">view_column</span>
                    Liste A – Spalten
                  </div>
                  <ColMapper raw={rawA} colMap={colMapA} onChange={setColMapA} label="A" />
                </div>
                <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10">
                  <div className="font-semibold text-on-surface mb-3 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-primary">view_column</span>
                    Liste B – Spalten
                  </div>
                  <ColMapper raw={rawB} colMap={colMapB} onChange={setColMapB} label="B" />
                </div>
              </div>
              <div className="flex justify-between mt-4">
                <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setStep(1)}>Zurück</button>
                <button className="px-5 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50" onClick={processAndUpload}
                  disabled={!(rawA && colMapA.nachname && colMapA.date) && !(rawB && colMapB.nachname && colMapB.date)}>
                  Verarbeiten & Vergleichen
                </button>
              </div>
            </div>
          )}

          {/* SCHRITT 3: Prüfen */}
          {!isLoading && step === 3 && (
            <div>
              {/* Datenquelle-Warnung: DB statt Upload */}
              {(usedDbForA || usedDbForB) && (
                <div className="flex items-start gap-3 bg-secondary-container/20 border border-secondary-container/30 rounded-xl px-4 py-3 mb-4 text-sm text-on-secondary-container">
                  <span className="material-symbols-outlined text-secondary-container mt-0.5">warning</span>
                  <div>
                    <strong>Hinweis:</strong>{' '}
                    {usedDbForA && usedDbForB
                      ? 'Beide Listen stammen aus der Datenbank (kein neuer Upload).'
                      : usedDbForA
                        ? 'Liste A stammt aus der Datenbank — nur Liste B wurde neu hochgeladen.'
                        : 'Liste B stammt aus der Datenbank — nur Liste A wurde neu hochgeladen.'}
                    {' '}Für einen komplett frischen Vergleich beide Listen hochladen.
                  </div>
                </div>
              )}

              {/* Zusammenfassung: Was wurde automatisch zugeordnet */}
              {comparisonSummary && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                    <div className="text-xs text-on-surface-variant mb-1">Exakte Treffer</div>
                    <div className="text-2xl font-bold text-emerald-500">{comparisonSummary.exact}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5">{comparisonSummary.exactKinder} Kinder · automatisch</div>
                  </div>
                  <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                    <div className="text-xs text-on-surface-variant mb-1">Ähnliche Namen</div>
                    <div className="text-2xl font-bold text-tertiary">{potentialMatches.length}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5">Vorschläge zur Prüfung</div>
                  </div>
                  <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                    <div className="text-xs text-on-surface-variant mb-1">Gesamt geladen</div>
                    <div className="text-2xl font-bold text-primary">{comparisonSummary.totalA}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5">Einträge A · {comparisonSummary.totalB} Einträge B</div>
                  </div>
                </div>
              )}

              {/* SCHRITT 3: Prüfen: Header und Bulk Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-container-low p-4 rounded-xl mb-6">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                    Mögliche Übereinstimmungen
                    <span className="bg-surface-container-highest text-on-surface-variant text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">{openGroups.length} offen</span>
                  </h3>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="px-4 py-2 text-xs font-bold rounded-lg text-primary bg-surface-container-lowest border border-outline-variant/20 hover:bg-primary-container hover:text-on-primary-container transition-colors shadow-sm" onClick={() => bulkAction('accept', 90)}>Alle &gt;90% akzeptieren</button>
                  <button className="px-4 py-2 text-xs font-bold rounded-lg text-on-surface-variant bg-surface-container-lowest border border-outline-variant/20 hover:bg-error/10 hover:text-error hover:border-error/20 transition-colors shadow-sm" onClick={() => bulkAction('reject')}>Alle übrigen ablehnen</button>
                </div>
              </div>

              {/* Match Cards List */}
              <div className="space-y-4 mb-4">
                {openGroups.length === 0 && potentialMatches.length === 0 && (
                  <p className="text-on-surface-variant text-sm">Keine ähnlichen Namen gefunden — alle Einträge wurden exakt zugeordnet oder haben keine Entsprechung.</p>
                )}
                {openGroups.length === 0 && potentialMatches.length > 0 && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-emerald-500 mb-2">task_alt</span>
                    <p className="text-emerald-500 font-bold text-lg">Alle Vorschläge erfolgreich überprüft.</p>
                  </div>
                )}
                
                {openGroups.map(group => {
                  const analysis = analyzeMatch(group.nameA, group.nameB);
                  let bc = 'border-error'; let tc = 'text-error'; let bgc = 'bg-error-container'; let cc = 'text-on-error-container';
                  let scoreTxt = group.score + '%';
                  if (group.score >= 90) { bc = 'border-emerald-500'; tc = 'text-emerald-500'; bgc = 'bg-emerald-500/10'; cc = 'text-emerald-500'; }
                  else if (group.score >= 75) { bc = 'border-tertiary-container'; tc = 'text-tertiary'; bgc = 'bg-tertiary-container'; cc = 'text-on-tertiary-container'; }

                  return (
                    <div key={group.nameA + group.nameB} className={`bg-surface-container-lowest p-6 rounded-xl transition-all shadow-sm hover:shadow-md border-l-4 ${bc} flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative group`}>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] items-center gap-6 md:gap-12">
                        {/* Liste A */}
                        <div className="space-y-1 text-left">
                          <span className="text-[10px] font-bold text-primary/60 tracking-wider uppercase">Liste A (Bestehend)</span>
                          <h3 className="text-lg font-bold text-on-surface truncate" title={group.nameA}>
                            {analysis.tokensA.map((t, i) => <span key={i} className={t.matched ? '' : 'text-error line-through decoration-2 opacity-80'}>{t.token}{' '}</span>)}
                          </h3>
                          <div className="flex gap-3 text-xs text-outline font-medium">
                            <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">bookmark</span> {group.entries[0]?.entryA?.klasse || '–'}</span>
                            <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">calendar_today</span> Erste Buchung: {fmtDate(group.entries[0]?.entryA?.date)}</span>
                          </div>
                        </div>

                        {/* Center Connection */}
                        <div className="flex flex-col items-center">
                          <div className={`h-px w-24 bg-gradient-to-r from-transparent via-current to-transparent mb-2 ${tc}`}></div>
                          <div className={`${bgc} ${cc} font-bold text-sm px-4 py-1.5 rounded-full shadow-sm whitespace-nowrap`}>
                            {scoreTxt} Ähnlichkeit
                          </div>
                          <div className="text-[10px] text-outline mt-2 font-semibold">({group.entries.length} Buchungen)</div>
                        </div>

                        {/* Liste B */}
                        <div className="space-y-1 md:text-right">
                          <span className="text-[10px] font-bold text-primary/60 tracking-wider uppercase">Liste B (Neu)</span>
                          <h3 className="text-lg font-bold text-on-surface truncate" title={group.nameB}>
                            {analysis.tokensB.map((t, i) => <span key={i} className={t.matched ? '' : 'text-tertiary underline decoration-2'}>{t.token}{' '}</span>)}
                          </h3>
                          <div className="flex gap-3 text-xs text-outline font-medium md:justify-end">
                            <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">bookmark</span> {group.entries[0]?.entryB?.klasse || '–'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-3 shrink-0 lg:ml-12">
                        <button className="w-10 h-10 rounded-full flex items-center justify-center text-error border-2 border-error/20 hover:bg-error/10 hover:border-error transition-all" onClick={() => handleGroupAction(group, 'reject')} title="Ablehnen">
                          <span className="material-symbols-outlined">close</span>
                        </button>
                        <button className="bg-primary hover:bg-primary-container hover:text-on-primary-container text-white font-bold py-2.5 px-6 rounded-lg shadow-sm transition-all flex items-center gap-2" onClick={() => handleGroupAction(group, 'accept')}>
                          Akzeptieren
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-4">
                <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setStep(1)}>Zurück</button>
                <button className="px-5 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors" onClick={() => setStep(4)}>Ergebnisse anzeigen</button>
              </div>
            </div>
          )}

          {/* SCHRITT 4: Ergebnis */}
          {!isLoading && step === 4 && (() => {
            // Einträge nach Kind gruppieren
            const groupByKind = (entries) => {
              const map = {};
              entries.forEach(e => {
                if (!map[e.name]) map[e.name] = { name: e.name, dateSet: new Set() };
                map[e.name].dateSet.add(e.date);
              });
              return Object.values(map).map(k => ({ name: k.name, dates: [...k.dateSet] })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
            };
            const matchedKinder = groupByKind(finalResults.matches);
            const fehlendeKinder = groupByKind(finalResults.onlyInA);
            const nurInBKinder = groupByKind(finalResults.onlyInB);

            return (
              <div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                    <div className="text-xs text-on-surface-variant mb-1">Übereinstimmung</div>
                    <div className="text-2xl font-bold text-emerald-500">{matchedKinder.length}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5">{matchedKinder.length === 1 ? 'Kind' : 'Kinder'} · {finalResults.matches.length} Tage</div>
                  </div>
                  <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                    <div className="text-xs text-on-surface-variant mb-1">Fehlt in B</div>
                    <div className="text-2xl font-bold text-error">{fehlendeKinder.length}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5">{fehlendeKinder.length === 1 ? 'Kind' : 'Kinder'} · {finalResults.onlyInA.length} Tage</div>
                  </div>
                  <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                    <div className="text-xs text-on-surface-variant mb-1">Nur in B</div>
                    <div className="text-2xl font-bold text-tertiary">{nurInBKinder.length}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5">{nurInBKinder.length === 1 ? 'Kind' : 'Kinder'} · {finalResults.onlyInB.length} Tage</div>
                  </div>
                </div>

                {fehlendeKinder.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-3 overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10 flex-wrap">
                      <span className="material-symbols-outlined text-error text-base">warning</span>
                      <span className="font-semibold text-error">Kein Essen gebucht</span>
                      <span className="bg-error-container text-on-error-container text-xs font-bold px-2 py-0.5 rounded-full">{fehlendeKinder.length} Kinder · {finalResults.onlyInA.length} Tage</span>
                      <button className="ml-auto flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
                        onClick={() => {
                          const bName = blocks.find(bl => String(bl.id) === String(blockId))?.name || '';
                          const printData = fehlendeKinder.map(k => { const parts = k.name.split(' '); return { vorname: parts[0] || '', nachname: parts.slice(1).join(' ') || k.name, klasse: '', dates: k.dates }; });
                          printFehlendeKinder('Kein Essen gebucht', printData, bName);
                        }}><span className="material-symbols-outlined text-sm">print</span>Drucken</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-surface-container/50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Name</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Tage</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Daten</th>
                        </tr></thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {fehlendeKinder.map(k => (
                            <tr key={k.name} className="bg-error-container/5 hover:bg-error-container/10 transition-colors">
                              <td className="px-4 py-2 font-semibold text-on-surface">{k.name}</td>
                              <td className="px-4 py-2"><span className="bg-error-container text-on-error-container text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                              <td className="px-4 py-2 text-xs text-on-surface-variant">{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {matchedKinder.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-3 overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10">
                      <span className="material-symbols-outlined text-green-600 text-base">task_alt</span>
                      <span className="font-semibold text-green-700">Übereinstimmungen</span>
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{matchedKinder.length} Kinder · {finalResults.matches.length} Tage</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-surface-container/50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Name</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Tage</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Daten</th>
                        </tr></thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {matchedKinder.map(k => (
                            <tr key={k.name}>
                              <td className="px-4 py-2 font-semibold text-on-surface">{k.name}</td>
                              <td className="px-4 py-2"><span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                              <td className="px-4 py-2 text-xs text-on-surface-variant">{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {nurInBKinder.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-3 overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10">
                      <span className="material-symbols-outlined text-amber-600 text-base">info</span>
                      <span className="font-semibold text-amber-700">Essen gebucht — nicht angemeldet</span>
                      <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{nurInBKinder.length} Kinder · {finalResults.onlyInB.length} Tage</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-surface-container/50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Name</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Tage</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Daten</th>
                        </tr></thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {nurInBKinder.map(k => (
                            <tr key={k.name}>
                              <td className="px-4 py-2 font-semibold text-on-surface">{k.name}</td>
                              <td className="px-4 py-2"><span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                              <td className="px-4 py-2 text-xs text-on-surface-variant">{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-between mt-4">
                  <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setStep(3)}>Zurück</button>
                  <div className="flex gap-2">
                    <button className="flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={exportExcel}>
                      <span className="material-symbols-outlined text-base">download</span>Excel exportieren
                    </button>
                    <button className="flex items-center gap-1 px-5 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={saving} onClick={saveAbgleich}>
                      <span className="material-symbols-outlined text-base">save</span>
                      {saving ? 'Speichern...' : 'In Datenbank speichern'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {showPasteModal && (
        <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4" onClick={() => setShowPasteModal(null)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h2 className="text-lg font-bold text-on-surface">Daten für Liste {showPasteModal} einfügen</h2>
              <button className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setShowPasteModal(null)}>
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-on-surface-variant mb-4">Kopiere deine Daten aus Excel/Word und füge sie hier mit Strg+V ein.</p>
              <MiniExcel
                onImport={(json) => {
                  setIsLoading(true);
                  processImportArray(json, showPasteModal);
                  setShowPasteModal(null);
                }}
                label={showPasteModal}
              />
            </div>
          </div>
        </div>
      )}
      {showFirebaseModal && (
        <FirebaseImportModal
          onClose={() => setShowFirebaseModal(false)}
          onImport={handleFirebaseImport}
          ferienblock={blocks.find(b => String(b.id) === String(blockId))}
        />
      )}
    </div>
  );
};

export default AbgleichTool;
