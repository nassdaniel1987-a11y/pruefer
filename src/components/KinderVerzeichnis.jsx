import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';
import { fmtDate } from '../utils/helpers';
import { jaroWinkler, koelnerPhonetik, tokenizeName, calcScore } from '../utils/matching';
import Spinner from './Spinner';
import { TableSkeleton } from './Skeleton';
import { Avatar } from './Avatar';

const KinderVerzeichnis = ({ blocks, onNavigate, initialKindId }) => {
  const [kinder, setKinder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [filterBlock, setFilterBlock] = useState('');

  // Akte-Detail
  const [selectedKindId, setSelectedKindId] = useState(initialKindId || null);
  const [akte, setAkte] = useState(null);
  const [akteLoading, setAkteLoading] = useState(false);

  // Import
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  // Edit-Modal
  const [editKind, setEditKind] = useState(null);
  const [editForm, setEditForm] = useState({ nachname: '', vorname: '', klasse: '', notizen: '' });

  // Duplikat-Erkennung
  const [showDuplicates, setShowDuplicates] = useState(false);
  const duplicates = useMemo(() => {
    if (!showDuplicates || kinder.length < 2) return [];
    const groups = [];
    const checked = new Set();
    for (let i = 0; i < kinder.length; i++) {
      if (checked.has(i)) continue;
      const a = kinder[i];
      const aName = (a.nachname + ' ' + a.vorname).toLowerCase();
      const similar = [];
      for (let j = i + 1; j < kinder.length; j++) {
        if (checked.has(j)) continue;
        const b = kinder[j];
        // Exakter Treffer (case-insensitive)
        const exact = a.nachname.toLowerCase() === b.nachname.toLowerCase() && a.vorname.toLowerCase() === b.vorname.toLowerCase();
        // Vertauscht
        const swapped = a.nachname.toLowerCase() === b.vorname.toLowerCase() && a.vorname.toLowerCase() === b.nachname.toLowerCase();
        // Ähnlich (Levenshtein-artig: einfache Prüfung)
        const bName = (b.nachname + ' ' + b.vorname).toLowerCase();
        const { score } = calcScore(aName, bName);

        const nameClose = aName.replace(/\s+/g, '') === bName.replace(/\s+/g, '') || aName.replace(/[^a-zäöüß]/g, '') === bName.replace(/[^a-zäöüß]/g, '');

        let matchReason = null;
        if (exact) matchReason = 'Exakt gleich';
        else if (swapped) matchReason = 'Vor-/Nachname vertauscht';
        else if (nameClose) matchReason = 'Sehr ähnlich (Lücken/Zeichen)';
        else if (score >= 82) matchReason = `Tippfehler? (Score ${score}%)`;

        if (matchReason) {
          similar.push({ kind: b, reason: matchReason });
          checked.add(j);
        }
      }
      if (similar.length > 0) {
        checked.add(i);
        groups.push({ kind: a, matches: similar });
      }
    }
    return groups;
  }, [kinder, showDuplicates]);

  // Sortierung
  const [sortBy, setSortBy] = useState('nachname');
  const [sortDir, setSortDir] = useState('asc');
  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };
  const sortIndicator = (col) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const loadKinder = async (fbId) => {
    setLoading(true);
    const params = {};
    if (fbId) params.ferienblock_id = fbId;
    const data = await API.get('kinder', params);
    setKinder(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { loadKinder(filterBlock); }, [filterBlock]);

  // Akte laden wenn Kind ausgewählt
  useEffect(() => {
    if (!selectedKindId) { setAkte(null); return; }
    setAkteLoading(true);
    API.get('kinder', { id: selectedKindId }).then(data => {
      setAkte(data.kind ? data : null);
      setAkteLoading(false);
    });
  }, [selectedKindId]);

  // Aus Listen synchronisieren
  const syncFromLists = async () => {
    setSyncing(true);
    const res = await API.post('kinder', { action: 'sync' });
    setSyncing(false);
    toast.success(res.message || 'Synchronisiert');
    loadKinder(filterBlock);
  };

  // Excel importieren
  // Import: Spalten-Zuordnung
  const [importCols, setImportCols] = useState({ name: '', nachname: '', vorname: '', klasse: '' });
  const [importHeaders, setImportHeaders] = useState([]);
  const [importPreview, setImportPreview] = useState([]);

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) { toast.error('Datei ist leer'); return; }

      // Header erkennen (erste Zeile Text = Header, sonst auto)
      const firstRow = rows[0];
      const isHeader = firstRow.every(c => typeof c === 'string' && c.trim().length > 0);
      let headers;
      let dataRows;
      if (isHeader) {
        headers = firstRow.map(h => String(h).trim());
        dataRows = rows.slice(1);
      } else {
        headers = firstRow.map((_, i) => `Spalte ${String.fromCharCode(65 + i)}`);
        dataRows = rows;
      }

      setImportHeaders(headers);
      setImportData(dataRows);
      setImportPreview(dataRows.slice(0, 5));
      setImportResult(null);

      // Auto-Zuordnung
      const hLow = headers.map(h => h.toLowerCase());
      const autoName = hLow.findIndex(h => h === 'name' || h === 'kind' || h === 'schüler');
      const autoNachname = hLow.findIndex(h => h.includes('nachname'));
      const autoVorname = hLow.findIndex(h => h.includes('vorname'));
      const autoKlasse = hLow.findIndex(h => h.includes('klasse') || h.includes('class'));

      if (autoNachname >= 0 && autoVorname >= 0) {
        // Separate Nachname + Vorname Spalten
        setImportCols({ name: '', nachname: String(autoNachname), vorname: String(autoVorname), klasse: autoKlasse >= 0 ? String(autoKlasse) : '' });
      } else if (autoName >= 0) {
        // Kombiniertes "Name" Feld
        setImportCols({ name: String(autoName), nachname: '', vorname: '', klasse: autoKlasse >= 0 ? String(autoKlasse) : '' });
      } else {
        setImportCols({ name: '', nachname: '', vorname: '', klasse: '' });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Name splitten: "Marie Müller" → { vorname: "Marie", nachname: "Müller" }
  // "Müller, Marie" → { nachname: "Müller", vorname: "Marie" }
  const splitName = (fullName) => {
    const s = fullName.trim();
    if (!s) return { vorname: '', nachname: '' };
    // Komma-Trennung: "Müller, Marie"
    if (s.includes(',')) {
      const parts = s.split(',').map(p => p.trim());
      return { nachname: parts[0], vorname: parts.slice(1).join(' ') };
    }
    // Leerzeichen-Trennung: "Marie Müller" → Vorname = alles bis auf letztes Wort
    const parts = s.split(/\s+/);
    if (parts.length === 1) return { vorname: parts[0], nachname: '' };
    const nachname = parts.pop();
    return { vorname: parts.join(' '), nachname };
  };

  const getImportPreviewEntries = () => {
    const rows = importPreview;
    return rows.map(row => {
      let vorname = '', nachname = '', klasse = '';
      if (importCols.name !== '') {
        const split = splitName(String(row[parseInt(importCols.name)] || ''));
        vorname = split.vorname;
        nachname = split.nachname;
      } else {
        nachname = importCols.nachname !== '' ? String(row[parseInt(importCols.nachname)] || '').trim() : '';
        vorname = importCols.vorname !== '' ? String(row[parseInt(importCols.vorname)] || '').trim() : '';
      }
      klasse = importCols.klasse !== '' ? String(row[parseInt(importCols.klasse)] || '').trim() : '';
      return { vorname, nachname, klasse };
    });
  };

  const executeImport = async () => {
    if (!importData || importData.length === 0) return;
    if (importCols.name === '' && importCols.nachname === '' && importCols.vorname === '') {
      toast.error('Bitte mindestens Name oder Nachname+Vorname zuordnen');
      return;
    }
    setImporting(true);

    const eintraege = [];
    for (const row of importData) {
      let vorname = '', nachname = '', klasse = '';
      if (importCols.name !== '') {
        const split = splitName(String(row[parseInt(importCols.name)] || ''));
        vorname = split.vorname;
        nachname = split.nachname;
      } else {
        nachname = importCols.nachname !== '' ? String(row[parseInt(importCols.nachname)] || '').trim() : '';
        vorname = importCols.vorname !== '' ? String(row[parseInt(importCols.vorname)] || '').trim() : '';
      }
      klasse = importCols.klasse !== '' ? String(row[parseInt(importCols.klasse)] || '').trim() : '';
      if (nachname && vorname) eintraege.push({ nachname, vorname, klasse });
    }

    const res = await API.post('kinder', { action: 'import', eintraege });
    setImportResult(res);
    setImporting(false);
    loadKinder(filterBlock);
  };

  // Kind bearbeiten
  const startEdit = (k) => {
    setEditKind(k);
    setEditForm({ nachname: k.nachname, vorname: k.vorname, klasse: k.klasse || '', notizen: k.notizen || '' });
  };
  const saveEdit = async () => {
    await API.post('kinder', { action: 'edit', id: editKind.id, ...editForm });
    setEditKind(null);
    loadKinder(filterBlock);
    if (selectedKindId === editKind.id) setSelectedKindId(editKind.id); // refresh akte
  };

  // Kind löschen
  const deleteKind = async (id) => {
    const ok = await confirmDialog('Kind löschen', 'Kind aus Stammverzeichnis löschen? Die Listen-Einträge bleiben erhalten.', 'Löschen');
    if (!ok) return;
    await API.post('kinder', { action: 'delete', id });
    toast.success('Kind gelöscht');
    loadKinder(filterBlock);
    if (selectedKindId === id) setSelectedKindId(null);
  };

  // Kind (Duplikat) zusammenführen
  const mergeKind = async (hauptId, typoId) => {
    const ok = await confirmDialog(
      'Mit Haupt-Eintrag zusammenführen', 
      'Möchtest du den Tippfehler unwiderruflich in den Haupt-Eintrag überführen? Alle bisherigen Anmeldungen und Buchungen des Tippfehlers werden auf den Haupt-Namen überschrieben, und das Duplikat verschwindet.', 
      'Ja, zusammenführen'
    );
    if (!ok) return;
    const res = await API.post('kinder', { action: 'merge', haupt_id: hauptId, typo_id: typoId });
    if (res.success) {
      toast.success('Kinder erfolgreich zusammengeführt!');
      loadKinder(filterBlock);
      if (selectedKindId === typoId) setSelectedKindId(hauptId);
    }
  };

  // Filter + Sortierung
  const filtered = kinder.filter(k =>
    (k.nachname + ' ' + k.vorname + ' ' + (k.klasse || ''))
      .toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => {
    let va, vb;
    switch (sortBy) {
      case 'nachname': va = (a.nachname || '').toLowerCase(); vb = (b.nachname || '').toLowerCase(); break;
      case 'vorname': va = (a.vorname || '').toLowerCase(); vb = (b.vorname || '').toLowerCase(); break;
      case 'klasse': va = (a.klasse || '').toLowerCase(); vb = (b.klasse || '').toLowerCase(); break;
      case 'bloecke': va = parseInt(a.block_count_a) || 0; vb = parseInt(b.block_count_a) || 0; break;
      case 'anmeldungen': va = parseInt(a.anmeldungen_count) || 0; vb = parseInt(b.anmeldungen_count) || 0; break;
      case 'buchungen': va = parseInt(a.buchungen_count) || 0; vb = parseInt(b.buchungen_count) || 0; break;
      default: va = (a.nachname || '').toLowerCase(); vb = (b.nachname || '').toLowerCase();
    }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  // ═══════════════════════════════════════
  // LISTENANSICHT (Design-Upgrade)
  // ═══════════════════════════════════════
  const mitBuchung = kinder.filter(k => parseInt(k.buchungen_count) > 0).length;
  const ohneBuchung = kinder.filter(k => parseInt(k.anmeldungen_count) > 0 && parseInt(k.buchungen_count) === 0).length;

  // Sortier-Buttons für Mobile + Desktop
  const sortOptions = [
    { key: 'nachname', label: 'Nachname' },
    { key: 'vorname', label: 'Vorname' },
    { key: 'klasse', label: 'Klasse' },
    { key: 'anmeldungen', label: 'Anmeldungen' },
    { key: 'buchungen', label: 'Buchungen' },
  ];

return (
    <div className="pb-20 space-y-8">
      <div>
        <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface tracking-tight font-headline">Kinder-Verzeichnis</h2>
        <p className="text-on-surface-variant/70 text-sm mt-1">Verwaltung der aktiven Datensätze und Buchungsstatus.</p>
      </div>

      {blocks.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-outline text-sm">filter_list</span>
          <select className="bg-surface-container-lowest text-sm border-none rounded-xl focus:ring-2 focus:ring-primary outline-none px-4 py-2 font-bold text-on-surface shadow-sm max-w-sm" value={filterBlock} onChange={e => setFilterBlock(e.target.value)}>
            <option value="">Alle Ferienblöcke (Gesamt-Statistik)</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10 flex justify-between items-start">
          <div>
            <p className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">{filterBlock ? 'Angemeldet (A)' : 'Kinder gesamt'}</p>
            <h3 className="text-3xl font-extrabold text-primary">{loading ? '…' : filterBlock ? kinder.filter(k => parseInt(k.anmeldungen_count) > 0).length : kinder.length}</h3>
          </div>
          <span className="material-symbols-outlined text-primary-container bg-primary-fixed/30 p-3 rounded-xl text-2xl">groups</span>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10 flex justify-between items-start">
          <div>
            <p className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">{filterBlock ? 'Mit Buchung (B)' : 'Mind. eine Buchung'}</p>
            <h3 className="text-3xl font-extrabold text-emerald-500">{loading ? '…' : mitBuchung}</h3>
          </div>
          <span className="material-symbols-outlined text-emerald-500 bg-emerald-500/10 p-3 rounded-xl text-2xl">check_circle</span>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10 flex justify-between items-start relative overflow-hidden">
          {ohneBuchung > 0 && <div className="absolute top-0 right-0 w-2 h-full bg-error"></div>}
          <div>
            <p className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Ohne Buchung</p>
            <h3 className={`text-3xl font-extrabold ${ohneBuchung > 0 ? 'text-error' : 'text-on-surface-variant/30'}`}>{loading ? '…' : ohneBuchung}</h3>
          </div>
          <span className={`material-symbols-outlined p-3 rounded-xl text-2xl ${ohneBuchung > 0 ? 'text-error bg-error/10' : 'text-on-surface-variant/20 bg-surface-container-high'}`}>warning</span>
        </div>
      </div>

        <div className="w-full space-y-4">
          <div className="flex items-center flex-wrap gap-2 mb-2 bg-surface-container-low p-2 rounded-2xl border border-outline-variant/20">
            <div className="flex-1 flex items-center bg-surface-container-lowest rounded-xl pl-3 pr-2 py-1.5 focus-within:ring-2 ring-primary/30 min-w-[200px]">
              <span className="material-symbols-outlined text-outline text-sm mr-2">search</span>
              <input className="w-full bg-transparent border-none focus:ring-0 px-0 outline-none text-sm placeholder:text-outline" placeholder="Suchen..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            
            <div className="flex items-center gap-1">
              <button className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-xl hover:bg-surface-container-high transition-colors" title="Import" onClick={() => setShowImport(!showImport)}>
                <span className="material-symbols-outlined text-[16px]">{showImport ? 'close' : 'upload_file'}</span> <span className="hidden sm:inline">{showImport ? 'Schließen' : 'Import'}</span>
              </button>
              <button className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-xl hover:bg-surface-container-high transition-colors disabled:opacity-50" title="Sync" disabled={syncing} onClick={syncFromLists}>
                <span className="material-symbols-outlined text-[16px]">{syncing ? 'hourglass_empty' : 'sync'}</span> <span className="hidden sm:inline">Sync</span>
              </button>
              {kinder.length > 1 && (
                <button className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border border-outline-variant/30 ${showDuplicates ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container-high'} transition-colors`} onClick={() => setShowDuplicates(!showDuplicates)}>
                  <span className="material-symbols-outlined text-[16px]">content_copy</span> <span className="hidden sm:inline">Duplikate</span>
                </button>
              )}
            </div>
          </div>

          {showImport && (
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border-l-4 border-l-primary mb-4">
              <div className="text-sm font-bold text-on-surface flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-base text-primary">upload_file</span>
                Kinder-Stammliste importieren
              </div>
              <p className="text-xs text-on-surface-variant mb-4">
                Excel-Datei hochladen und Spalten zuordnen. Duplikate werden automatisch übersprungen.
              </p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 transition-all mb-4" />
              
              {importHeaders.length > 0 && (
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/10">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                     <div>
                       <label className="text-[10px] font-bold uppercase text-primary/80 mb-1 block">Nachname *</label>
                       <select className="w-full text-xs rounded-lg border-none" value={importCols.nachname} onChange={e => setImportCols({ ...importCols, nachname: e.target.value })}><option value="">-</option>{importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}</select>
                     </div>
                     <div>
                       <label className="text-[10px] font-bold uppercase text-primary/80 mb-1 block">Vorname *</label>
                       <select className="w-full text-xs rounded-lg border-none" value={importCols.vorname} onChange={e => setImportCols({ ...importCols, vorname: e.target.value })}><option value="">-</option>{importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}</select>
                     </div>
                     <div>
                       <label className="text-[10px] font-bold uppercase text-primary/80 mb-1 block">Klasse (opt)</label>
                       <select className="w-full text-xs rounded-lg border-none" value={importCols.klasse} onChange={e => setImportCols({ ...importCols, klasse: e.target.value })}><option value="">-</option>{importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}</select>
                     </div>
                     <div>
                       <label className="text-[10px] font-bold uppercase text-primary/80 mb-1 block">Name kombiniert</label>
                       <select className="w-full text-xs rounded-lg border-none" value={importCols.name} onChange={e => setImportCols({ ...importCols, name: e.target.value, nachname:'', vorname:'' })}><option value="">-</option>{importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}</select>
                     </div>
                  </div>
                  <button className="px-5 py-2 text-sm font-bold bg-primary text-on-primary rounded-xl shadow-sm hover:opacity-90 disabled:opacity-50" disabled={importing} onClick={executeImport}>
                    {importing ? 'Importiere...' : `${importData.length} Kinder importieren`}
                  </button>
                </div>
              )}
            </div>
          )}

          {showDuplicates && duplicates.length > 0 && (
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border-2 border-amber-500/50 mb-4">
              <div className="text-sm font-bold text-amber-600 flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined">warning</span> {duplicates.length} mögliche Duplikate
              </div>
              <div className="space-y-4">
                {duplicates.map((g, i) => {
                  const allEntries = [{ kind: g.kind, reason: 'Haupt-Eintrag' }, ...g.matches.map(m => ({ kind: m.kind, reason: m.reason }))];
                  return (
                    <div key={i} className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/10">
                      <div className="text-[10px] font-black uppercase text-on-surface-variant mb-2">Gruppe {i + 1}</div>
                      {allEntries.map((e, j) => (
                        <div key={j} className="flex items-center gap-3 py-2 flex-wrap border-b border-dashed border-outline-variant/10 last:border-0">
                          <strong className="text-sm w-48 truncate">{e.kind.vorname} {e.kind.nachname}</strong>
                          <span className="text-xs bg-surface-container-high px-2 py-0.5 rounded">A: {parseInt(e.kind.anmeldungen_count)||0} | B: {parseInt(e.kind.buchungen_count)||0}</span>
                          <span className="bg-tertiary-container text-on-tertiary-container text-[10px] font-bold px-2 py-0.5 rounded-full">{e.reason}</span>
                          <div className="ml-auto flex gap-1">
                            {j>0 && <button className="px-2 py-1 bg-primary text-white text-[10px] font-bold rounded-lg" onClick={() => mergeKind(Math.min(g.kind.id, e.kind.id), Math.max(g.kind.id, e.kind.id))}>Merge</button>}
                            <button className="px-2 py-1 bg-error text-white text-[10px] font-bold rounded-lg" onClick={() => deleteKind(e.kind.id)}>Löschen</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden text-sm">
            {loading ? (
              <TableSkeleton rows={10} cols={4} />
            ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-surface-container-high/50 border-b border-outline-variant/30">
                    <th className="px-5 py-4 text-[11px] font-bold text-outline uppercase tracking-widest cursor-pointer select-none" onClick={() => toggleSort('nachname')}>Name {sortIndicator('nachname')}</th>
                    <th className="px-4 py-4 text-[11px] font-bold text-outline uppercase tracking-widest cursor-pointer select-none" onClick={() => toggleSort('klasse')}>Klasse {sortIndicator('klasse')}</th>
                    <th className="px-4 py-4 text-[11px] font-bold text-outline uppercase tracking-widest text-center cursor-pointer select-none" onClick={() => toggleSort('bloecke')}>Ferienblöcke {sortIndicator('bloecke')}</th>
                    <th className="px-4 py-4 text-[11px] font-bold text-outline uppercase tracking-widest text-center">Buchungen</th>
                    <th className="px-4 py-4 text-[11px] font-bold text-outline uppercase tracking-widest text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/25">
                  {filtered.map(k => {
                    const isSelected = String(selectedKindId) === String(k.id);
                    return (
                    <tr key={k.id} className={`hover:bg-surface-container-low transition-colors group cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`} onClick={() => setSelectedKindId(k.id)}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                           <Avatar vorname={k.vorname} nachname={k.nachname} size="sm" />
                           <span className={`font-bold ${isSelected ? 'text-primary' : 'text-on-surface'}`}>{k.nachname}, {k.vorname}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 font-medium text-on-surface-variant">{k.klasse || '—'}</td>
                      <td className="px-4 py-4 text-center">
                        <span className="bg-secondary-container text-on-secondary-container px-2 py-1 rounded-md text-xs font-bold">{parseInt(k.block_count_a) || 0}</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold">
                           <span className="bg-primary-fixed text-on-primary-fixed-variant px-1.5 py-0.5 rounded">A:{parseInt(k.anmeldungen_count)||0}</span>
                           <span className="bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded">B:{parseInt(k.buchungen_count)||0}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="material-symbols-outlined p-1.5 text-outline hover:text-primary hover:bg-surface-container-high rounded-lg text-lg" onClick={(e) => { e.stopPropagation(); startEdit(k); }}>edit</button>
                          <button className="material-symbols-outlined p-1.5 text-outline hover:text-error hover:bg-error-container rounded-lg text-lg" onClick={(e) => { e.stopPropagation(); deleteKind(k.id); }}>delete</button>
                        </div>
                      </td>
                    </tr>
                  )})}
                  {filtered.length === 0 && (
                    <tr><td colSpan="5" className="p-8 text-center text-on-surface-variant font-medium">Keine Kinder gefunden.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
            <div className="px-6 py-4 bg-surface-container-low/30 border-t border-outline-variant/10 text-xs text-on-surface-variant font-medium text-center">
               Zeige {filtered.length} Ergebnisse
            </div>
          </div>
        </div>

      {selectedKindId && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedKindId(null)}>
          <div className="bg-surface-container-lowest rounded-3xl w-full max-w-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {akteLoading ? (
              <div className="p-8 space-y-4">
                <div className="h-28 rounded-2xl skeleton mb-10" />
                <div className="space-y-3 pt-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="skeleton h-4 w-24 rounded" />
                      <div className="skeleton h-4 flex-1 rounded" />
                    </div>
                  ))}
                </div>
                <div className="skeleton h-32 rounded-xl mt-4" />
              </div>
            ) : akte ? (
              <>
                <div className="relative h-28 bg-gradient-to-br from-primary-container to-primary shrink-0">
                  <div className="absolute -bottom-8 left-6">
                    <div className="border-4 border-surface-container-lowest rounded-2xl shadow-lg bg-surface-container-lowest">
                      <Avatar vorname={akte.kind.vorname} nachname={akte.kind.nachname} size="lg" />
                    </div>
                  </div>
                  <div className="absolute top-4 right-4 flex gap-2">
                    <button className="bg-surface-container-high/60 hover:bg-surface-container-high p-1.5 rounded-full text-white transition-all backdrop-blur-md border border-white/10" onClick={() => startEdit(akte.kind)}>
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button className="bg-surface-container-high/60 hover:bg-surface-container-high p-1.5 rounded-full text-white transition-all backdrop-blur-md border border-white/10" onClick={() => setSelectedKindId(null)}>
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                </div>

                <div className="pt-12 px-6 pb-8 flex-1 overflow-y-auto space-y-8">
                  <div>
                    <h3 className="text-2xl font-extrabold text-on-surface tracking-tight">{akte.kind.vorname} {akte.kind.nachname}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      {akte.kind.klasse && <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">Klasse {akte.kind.klasse}</span>}
                      <span className="w-1 h-1 rounded-full bg-outline-variant"></span>
                      <span className="text-xs text-on-surface-variant font-medium">ID: #{akte.kind.id}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-surface-container-low rounded-xl p-3 text-center border border-outline-variant/5">
                      <div className="text-xl font-bold text-primary">{akte.summary?.total_anmeldungen || 0}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">Anmeldungen</div>
                    </div>
                    <div className="bg-surface-container-low rounded-xl p-3 text-center border border-outline-variant/5">
                      <div className="text-xl font-bold text-emerald-600">{akte.summary?.total_buchungen || 0}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">Buchungen</div>
                    </div>
                  </div>

                  {akte.kind.notizen && (
                    <div className="bg-tertiary-container/20 border-l-4 border-l-tertiary p-3 rounded-r-xl">
                      <p className="text-[10px] font-bold text-tertiary uppercase tracking-wider mb-1">Notizen</p>
                      <p className="text-sm text-on-surface-variant">{akte.kind.notizen}</p>
                    </div>
                  )}

                  <div className="space-y-4 pb-4">
                    <h4 className="text-[11px] font-bold text-outline uppercase tracking-widest border-b border-outline-variant/10 pb-2">Verlauf / Enrollment</h4>
                    {!akte.blocks || akte.blocks.length === 0 ? (
                      <p className="text-xs text-on-surface-variant">Keine Einträge in den Listen vorhanden.</p>
                    ) : (
                      <div className="space-y-4">
                        {akte.blocks.map(b => {
                          const aDates = new Set(b.anmeldungen.map(a => String(a.datum).split('T')[0]));
                          const bDates = new Set(b.buchungen.map(x => String(x.datum).split('T')[0]));
                          const allDates = [...new Set([...aDates, ...bDates])].sort();
                          
                          const weekday = (d) => {
                            try { return new Date(d).toLocaleDateString('de-DE', { weekday: 'short' }); } catch { return ''; }
                          };

                          return (
                            <div key={b.ferienblock_id} className="p-4 bg-surface-container-low/50 rounded-2xl border border-outline-variant/10">
                              <div className="flex items-start justify-between gap-3 mb-4">
                                <div className="flex items-start gap-2.5">
                                  <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.match_status==='exact'||b.match_status==='fuzzy_accepted' ? 'bg-emerald-500' : 'bg-primary-container'}`}></div>
                                  <div>
                                    <p className="text-sm font-bold text-on-surface leading-tight">{b.block_name}</p>
                                    <p className="text-[10px] text-on-surface-variant mt-0.5 font-medium">{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</p>
                                  </div>
                                </div>
                                {b.klasse && <span className="text-[10px] bg-surface-container-low dark:bg-surface-container-high px-2 py-0.5 rounded-lg border border-outline-variant/30 font-bold text-on-surface">Kl. {b.klasse}</span>}
                              </div>

                              <div className="space-y-4">
                                <div>
                                  <p className="text-[9px] font-black uppercase text-on-surface-variant tracking-wider mb-2 flex items-center gap-1.5">
                                    <span className="w-1 h-1 rounded-full bg-primary/40"></span>
                                    Anmeldungen (A) <span className="text-primary ml-1">{b.anmeldungen.length} Tage</span>
                                  </p>
                                  <div className="flex flex-wrap gap-1.5 pl-2.5">
                                    {[...aDates].sort().map(d => {
                                      const inB = bDates.has(d);
                                      return (
                                        <div key={'a' + d} className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors flex items-center gap-1 ${inB ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-error-container/20 text-error border-error-container/30'}`}>
                                           <span className="material-symbols-outlined text-[10px]">{inB ? 'check' : 'close'}</span>
                                           <span>{weekday(d)} {fmtDate(d)}</span>
                                        </div>
                                      );
                                    })}
                                    {b.anmeldungen.length === 0 && <span className="text-[10px] text-on-surface-variant italic">Keine Anmeldungen</span>}
                                  </div>
                                </div>

                                <div>
                                  <p className="text-[9px] font-black uppercase text-on-surface-variant tracking-wider mb-2 flex items-center gap-1.5">
                                    <span className="w-1 h-1 rounded-full bg-emerald-500/40"></span>
                                    Buchungen (B) <span className="text-emerald-600 ml-1">{b.buchungen.length} Tage</span>
                                  </p>
                                  <div className="flex flex-wrap gap-1.5 pl-2.5">
                                    {[...bDates].sort().map(d => {
                                      const inA = aDates.has(d);
                                      const buchung = b.buchungen.find(x => String(x.datum).split('T')[0] === d);
                                      return (
                                        <div key={'b' + d} className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors flex items-center gap-1 ${inA ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-tertiary-container/20 text-tertiary border-tertiary-container/30'}`} title={buchung?.menu || ''}>
                                           <span className="material-symbols-outlined text-[10px]">{inA ? 'check' : 'warning'}</span>
                                           <span>{weekday(d)} {fmtDate(d)}</span>
                                        </div>
                                      );
                                    })}
                                    {b.buchungen.length === 0 && <span className="text-[10px] text-on-surface-variant italic">Keine Buchungen</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="p-20 text-center text-error font-bold">Akte konnte nicht geladen werden.</div>
            )}
          </div>
        </div>
      )}

      {editKind && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setEditKind(null)}>
          <div className="bg-surface-container-lowest rounded-3xl p-8 w-full max-w-lg shadow-2xl border border-outline-variant/20" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-on-surface mb-6 flex items-center gap-2"><span className="material-symbols-outlined text-primary">edit</span> Kind bearbeiten</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-black uppercase text-on-surface-variant tracking-wider">Vorname</label>
                  <input className="w-full bg-surface-container-low border-0 border-b border-outline-variant/30 focus:border-primary focus:ring-0 px-3 py-2 rounded-t-lg transition-all text-sm" value={editForm.vorname} onChange={e => setEditForm({ ...editForm, vorname: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-black uppercase text-on-surface-variant tracking-wider">Nachname</label>
                  <input className="w-full bg-surface-container-low border-0 border-b border-outline-variant/30 focus:border-primary focus:ring-0 px-3 py-2 rounded-t-lg transition-all text-sm" value={editForm.nachname} onChange={e => setEditForm({ ...editForm, nachname: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-black uppercase text-on-surface-variant tracking-wider">Klasse (optional)</label>
                <input className="w-full bg-surface-container-low border-0 border-b border-outline-variant/30 focus:border-primary focus:ring-0 px-3 py-2 rounded-t-lg transition-all text-sm" value={editForm.klasse} onChange={e => setEditForm({ ...editForm, klasse: e.target.value })} placeholder="Klasse eintragen" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-black uppercase text-on-surface-variant tracking-wider">System-Notizen</label>
                <textarea className="w-full bg-surface-container-low border-0 border-b border-outline-variant/30 focus:border-primary focus:ring-0 px-3 py-2 rounded-t-lg transition-all text-sm min-h-[80px]" value={editForm.notizen} onChange={e => setEditForm({ ...editForm, notizen: e.target.value })} placeholder="Zusätzliche Infos, Allergien etc." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button className="px-5 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded-xl transition-colors" onClick={() => setEditKind(null)}>Abbrechen</button>
              <button className="px-6 py-2.5 text-sm font-bold bg-primary text-on-primary border border-primary-container/20 rounded-xl shadow-sm hover:opacity-90 hover:scale-[1.02] transition-all" onClick={saveEdit}>Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KinderVerzeichnis;
