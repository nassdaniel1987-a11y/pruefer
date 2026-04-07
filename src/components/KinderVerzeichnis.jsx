import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';
import { fmtDate } from '../utils/helpers';
import { jaroWinkler, koelnerPhonetik, tokenizeName } from '../utils/matching';
import Spinner from './Spinner';
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
  // AKTE-DETAILANSICHT (Design-Upgrade)
  // ═══════════════════════════════════════
  if (selectedKindId) {
    if (akteLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><Spinner /></div>;
    if (!akte) return <div className="card"><p style={{ color: 'var(--danger)', padding: '2rem', textAlign: 'center' }}>Kind nicht gefunden</p><button className="btn btn-ghost btn-sm" onClick={() => setSelectedKindId(null)}>← Zurück zur Liste</button></div>;

    const { kind, aliases, blocks: akteBlocks, summary } = akte;

    // Kurzer Wochentag aus Datum
    const weekday = (d) => {
      try { return new Date(d).toLocaleDateString('de-DE', { weekday: 'short' }); } catch { return ''; }
    };

    return (
      <div>
        {/* Zurück-Link */}
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedKindId(null)} style={{ marginBottom: '1rem' }}>
          ← Zurück zur Übersicht
        </button>

        {/* ── PROFIL-KARTE ── */}
        <div className="akte-profile">
          <div className="akte-profile-actions">
            <button className="btn btn-sm" onClick={() => startEdit(kind)}>✎ Bearbeiten</button>
          </div>
          <div className="akte-profile-top">
            <Avatar vorname={kind.vorname} nachname={kind.nachname} size="lg" />
            <div>
              <div className="akte-profile-name">{kind.vorname} {kind.nachname}</div>
              {kind.klasse && <span className="akte-profile-klasse">Klasse {kind.klasse}</span>}
              {aliases && aliases.length > 0 && (
                <div className="akte-profile-aliases">Auch bekannt als: {aliases.join(', ')}</div>
              )}
            </div>
          </div>
          <div className="akte-stats-row">
            <div className="akte-stat">
              <div className="val">{summary.total_blocks}</div>
              <div className="lbl">Ferienblöcke</div>
            </div>
            <div className="akte-stat">
              <div className="val">{summary.total_anmeldungen}</div>
              <div className="lbl">Tage angemeldet</div>
            </div>
            <div className="akte-stat">
              <div className="val">{summary.total_buchungen}</div>
              <div className="lbl">Tage gebucht</div>
            </div>
            <div className="akte-stat">
              <div className="val">{summary.total_kosten.toFixed(0)} €</div>
              <div className="lbl">Gesamtkosten</div>
            </div>
          </div>
        </div>

        {/* ── NOTIZEN ── */}
        {kind.notizen && (
          <div className="akte-notes">
            <span className="akte-notes-icon">📝</span>
            <div className="akte-notes-text">{kind.notizen}</div>
          </div>
        )}

        {/* ── FERIENBLÖCKE TIMELINE ── */}
        {akteBlocks.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="icon">📭</div>
              <p>Keine Einträge in den Listen gefunden.</p>
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text2)' }}>
              Verlauf ({akteBlocks.length} {akteBlocks.length === 1 ? 'Block' : 'Blöcke'})
            </h3>
            <div className="akte-timeline">
              {akteBlocks.map(b => {
                const aDates = new Set(b.anmeldungen.map(a => String(a.datum).split('T')[0]));
                const bDates = new Set(b.buchungen.map(x => String(x.datum).split('T')[0]));
                const allDates = [...new Set([...aDates, ...bDates])].sort();
                const matchedDays = allDates.filter(d => aDates.has(d) && bDates.has(d)).length;
                const missingDays = [...aDates].filter(d => !bDates.has(d)).length;
                const extraDays = [...bDates].filter(d => !aDates.has(d)).length;

                // Block-Status für Timeline-Punkt
                const statusClass = missingDays > 0 ? 'status-miss' : extraDays > 0 ? 'status-warn' : 'status-ok';

                return (
                  <div className={`akte-block ${statusClass}`} key={b.ferienblock_id}>
                    <div className="akte-block-card">
                      <div className="akte-block-head">
                        <div>
                          <h3>{b.block_name}</h3>
                          <div className="meta">{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</div>
                        </div>
                        <div className="akte-block-badges">
                          {b.klasse && <span className="badge badge-blue">Klasse {b.klasse}</span>}
                          {b.match_status && (
                            <span className={`badge ${b.match_status === 'exact' || b.match_status === 'fuzzy_accepted' ? 'badge-green'
                                : b.match_status === 'nur_in_a' ? 'badge-red' : 'badge-orange'
                              }`}>
                              {b.match_status === 'exact' ? '✓ Exakt' : b.match_status === 'fuzzy_accepted' ? '≈ Fuzzy' : b.match_status === 'nur_in_a' ? '✗ Fehlt in B' : b.match_status === 'nur_in_b' ? '⚠ Nur in B' : b.match_status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Anmeldungen (A) */}
                      <div className="days-section">
                        <div className="days-section-title">
                          Anmeldungen (A) <span className="count">{b.anmeldungen.length} Tage</span>
                        </div>
                        <div className="days-grid">
                          {[...aDates].sort().map(d => {
                            const inB = bDates.has(d);
                            return (
                              <div key={'a' + d} className={`day-chip ${inB ? 'matched' : 'missing'}`}>
                                <span className="day-icon">{inB ? '✓' : '✗'}</span>
                                <span>{weekday(d)} {fmtDate(d)}</span>
                              </div>
                            );
                          })}
                          {b.anmeldungen.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Keine Anmeldungen</span>}
                        </div>
                      </div>

                      {/* Buchungen (B) */}
                      <div className="days-section">
                        <div className="days-section-title">
                          Buchungen (B) <span className="count">{b.buchungen.length} Tage</span>
                        </div>
                        <div className="days-grid">
                          {[...bDates].sort().map(d => {
                            const inA = aDates.has(d);
                            const buchung = b.buchungen.find(x => String(x.datum).split('T')[0] === d);
                            return (
                              <div key={'b' + d} className={`day-chip ${inA ? 'matched' : 'extra'}`} title={buchung?.menu || ''}>
                                <span className="day-icon">{inA ? '✓' : '⚠'}</span>
                                <span>{weekday(d)} {fmtDate(d)}</span>
                                {buchung?.menu && <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({buchung.menu})</span>}
                              </div>
                            );
                          })}
                          {b.buchungen.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Keine Buchungen</span>}
                        </div>
                      </div>

                      {/* Block-Zusammenfassung */}
                      <div className="block-summary-row">
                        <span>✓ <strong>{matchedDays}</strong> übereinstimmend</span>
                        {missingDays > 0 && <span style={{ color: 'var(--danger)' }}>✗ <strong>{missingDays}</strong> ohne Buchung</span>}
                        {extraDays > 0 && <span style={{ color: 'var(--warning)' }}>⚠ <strong>{extraDays}</strong> ohne Anmeldung</span>}
                        <span style={{ marginLeft: 'auto' }}><strong>{b.kosten.toFixed(2)} €</strong></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editKind && (
          <div className="modal-overlay" onClick={() => setEditKind(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>Kind bearbeiten</h3>
              <div className="form-group">
                <label>Nachname</label>
                <input className="form-input" value={editForm.nachname} onChange={e => setEditForm({ ...editForm, nachname: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Vorname</label>
                <input className="form-input" value={editForm.vorname} onChange={e => setEditForm({ ...editForm, vorname: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Klasse</label>
                <input className="form-input" value={editForm.klasse} onChange={e => setEditForm({ ...editForm, klasse: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notizen</label>
                <textarea className="textarea" style={{ minHeight: '80px' }} value={editForm.notizen} onChange={e => setEditForm({ ...editForm, notizen: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setEditKind(null)}>Abbrechen</button>
                <button className="btn btn-primary" style={{ width: 'auto' }} onClick={saveEdit}>Speichern</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

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
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Kinder-Verzeichnis</h1>
          <p>Alle registrierten Kinder mit ihren Akten</p>
        </div>
      </div>

      {/* Ferienblock-Filter */}
      {blocks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap' }}>Statistik für:</span>
          <select
            className="form-input"
            style={{ maxWidth: '300px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
            value={filterBlock}
            onChange={e => setFilterBlock(e.target.value)}
          >
            <option value="">Alle Ferienblöcke</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card accent-blue">
          <div className="stat-label">{filterBlock ? 'Angemeldet (A)' : 'Kinder gesamt'}</div>
          <div className="stat-value">{loading ? '…' : filterBlock ? kinder.filter(k => parseInt(k.anmeldungen_count) > 0).length : kinder.length}</div>
        </div>
        <div className="stat-card accent-green">
          <div className="stat-label">{filterBlock ? 'Gebucht (B)' : 'Mit Buchungen'}</div>
          <div className="stat-value">{loading ? '…' : mitBuchung}</div>
        </div>
        <div className={`stat-card ${ohneBuchung > 0 ? 'accent-red' : 'accent-green'}`}>
          <div className="stat-label">Ohne Buchung</div>
          <div className="stat-value">{loading ? '…' : ohneBuchung}</div>
          <div className="stat-sub">{ohneBuchung > 0 ? 'Angemeldet aber keine Buchung' : ''}</div>
        </div>
      </div>

      <div className="toolbar">
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => setShowImport(!showImport)}>
          {showImport ? '✗ Import schließen' : '📥 Excel importieren'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={syncing} onClick={syncFromLists}>
          {syncing ? '⏳ Synchronisiere...' : '🔄 Aus Listen synchronisieren'}
        </button>
        {kinder.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const wb = XLSX.utils.book_new();
            const rows = filtered.map(k => ({
              Nachname: k.nachname,
              Vorname: k.vorname,
              Klasse: k.klasse || '',
              'Anmeldungen (A)': parseInt(k.anmeldungen_count) || 0,
              'Buchungen (B)': parseInt(k.buchungen_count) || 0,
              'Blöcke': parseInt(k.block_count_a) || 0,
              Notizen: k.notizen || ''
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Kinder');
            XLSX.writeFile(wb, `Kinder-Verzeichnis${search ? '_' + search : ''}.xlsx`);
            toast.success(`${rows.length} Kinder exportiert`);
          }}>📊 Excel exportieren</button>
        )}
        {kinder.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => {
            const ok = await confirmDialog(
              'Alle Kinder löschen',
              `Wirklich alle ${kinder.length} Kinder aus dem Verzeichnis löschen? Die Listen-Einträge (A/B) bleiben erhalten.`,
              'Alle löschen'
            );
            if (!ok) return;
            const res = await API.post('kinder', { action: 'delete_all' });
            toast.success(`${res.deleted} Kinder gelöscht`);
            loadKinder(filterBlock);
          }}>🗑 Alle löschen</button>
        )}
        {kinder.length > 1 && (
          <button className={`btn btn-ghost btn-sm ${showDuplicates ? 'btn-active' : ''}`} onClick={() => setShowDuplicates(!showDuplicates)}>
            🔎 Duplikate {showDuplicates && duplicates.length > 0 ? `(${duplicates.length})` : 'prüfen'}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => loadKinder(filterBlock)}>↻ Aktualisieren</button>
      </div>

      {/* Duplikat-Warnung */}
      {showDuplicates && duplicates.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--warning)' }}>
          <div className="card-title" style={{ color: 'var(--warning)', marginBottom: '0.5rem' }}>⚠ {duplicates.length} mögliche Duplikate gefunden</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1.5rem' }}>Es sieht so aus, als wären folgende Kinder mehrfach angelegt. Schau auf die Zahl der Anmeldungen (A) und Buchungen (B) und lösche den überflüssigen Eintrag.</p>

          {duplicates.map((g, i) => {
            const allEntries = [{ kind: g.kind, reason: 'Haupt-Eintrag' }, ...g.matches.map(m => ({ kind: m.kind, reason: m.reason }))];
            return (
              <div key={i} style={{ padding: '1rem', background: 'var(--bg)', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.5px' }}>Duplikat-Gruppe {i + 1}</div>
                {allEntries.map((e, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0', borderBottom: j < allEntries.length - 1 ? '1px dashed var(--border)' : 'none', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1rem' }}>{e.kind.vorname} {e.kind.nachname}</strong>
                    {e.kind.klasse && <span className="badge badge-blue">Kl. {e.kind.klasse}</span>}

                    <span style={{ fontSize: '0.85rem', color: 'var(--text)', background: 'rgba(0,0,0,0.04)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      <strong>A:</strong> {parseInt(e.kind.anmeldungen_count) || 0} | <strong>B:</strong> {parseInt(e.kind.buchungen_count) || 0}
                    </span>

                    <span className="badge badge-orange">{e.reason}</span>

                    <span style={{ marginLeft: 'auto' }} />
                    {j > 0 && (
                      <button
                        className="btn btn-sm"
                        style={{ color: 'var(--primary)', width: 'auto', padding: '0.3rem 0.75rem', background: 'rgba(0,90,156,0.1)', border: 'none', marginRight: '0.5rem' }}
                        onClick={() => mergeKind(allEntries[0].kind.id, e.kind.id)}
                      >
                        🔗 Zu Haupt-Eintrag
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      style={{ color: 'var(--danger)', width: 'auto', padding: '0.3rem 0.75rem', background: 'rgba(220,53,69,0.1)', border: 'none' }}
                      onClick={() => deleteKind(e.kind.id)}
                    >
                      ✗ Löschen
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {showDuplicates && duplicates.length === 0 && (
        <div className="info-box" style={{ marginBottom: '1.5rem' }}>✅ Keine Duplikate gefunden — alle {kinder.length} Kinder sind eindeutig.</div>
      )}

      {/* Import-Bereich */}
      {showImport && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-title">Kinder-Stammliste importieren</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1rem' }}>
            Excel-Datei hochladen und Spalten zuordnen. Duplikate werden automatisch übersprungen.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ marginBottom: '1rem' }} />

          {importHeaders.length > 0 && (
            <div>
              <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>{importData.length} Zeilen erkannt — Spalten zuordnen:</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', maxWidth: '600px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>
                    Name (kombiniert) <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>— ODER Nachname+Vorname getrennt</span>
                  </label>
                  <select className="form-input" value={importCols.name}
                    onChange={e => setImportCols({ ...importCols, name: e.target.value, nachname: e.target.value ? '' : importCols.nachname, vorname: e.target.value ? '' : importCols.vorname })}>
                    <option value="">– nicht verwenden –</option>
                    {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>Klasse (optional)</label>
                  <select className="form-input" value={importCols.klasse}
                    onChange={e => setImportCols({ ...importCols, klasse: e.target.value })}>
                    <option value="">– nicht verwenden –</option>
                    {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
                {importCols.name === '' && (
                  <>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>Nachname *</label>
                      <select className="form-input" value={importCols.nachname}
                        onChange={e => setImportCols({ ...importCols, nachname: e.target.value })}>
                        <option value="">– wählen –</option>
                        {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>Vorname *</label>
                      <select className="form-input" value={importCols.vorname}
                        onChange={e => setImportCols({ ...importCols, vorname: e.target.value })}>
                        <option value="">– wählen –</option>
                        {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>

              {importCols.name !== '' && (
                <div className="info-box" style={{ marginBottom: '1rem' }}>
                  Kombiniertes Namensfeld erkannt — wird automatisch in Vor-/Nachname getrennt.<br />
                  <span style={{ fontSize: '0.8rem' }}>Format: "Vorname Nachname" oder "Nachname, Vorname"</span>
                </div>
              )}

              {/* Vorschau */}
              {(importCols.name !== '' || (importCols.nachname !== '' && importCols.vorname !== '')) && (() => {
                const preview = getImportPreviewEntries();
                return (
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem' }}>Vorschau (erste {preview.length}):</p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Vorname</th><th>Nachname</th><th>Klasse</th></tr></thead>
                        <tbody>
                          {preview.map((e, i) => (
                            <tr key={i} style={!e.nachname || !e.vorname ? { background: 'rgba(220,53,69,0.08)' } : {}}>
                              <td>{e.vorname || <span style={{ color: 'var(--danger)' }}>–fehlt–</span>}</td>
                              <td>{e.nachname || <span style={{ color: 'var(--danger)' }}>–fehlt–</span>}</td>
                              <td>{e.klasse || '–'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={importing} onClick={executeImport}>
                {importing ? 'Importiere...' : `${importData.length} Kinder importieren`}
              </button>
            </div>
          )}

          {importResult && (
            <div className="info-box" style={{ marginTop: '1rem' }}>
              ✓ {importResult.message}
              {importResult.skipped_names?.length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>Übersprungen: {importResult.skipped_names.join(', ')}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Suche + Sortierung */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="search-wrap" style={{ flex: '1', minWidth: '200px', marginBottom: 0 }}>
          <span className="search-icon">🔍</span>
          <input
            className="form-input"
            placeholder="Kind suchen (Name, Klasse)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>Sortieren:</span>
          <select className="form-input" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto', padding: '0.4rem 0.5rem', fontSize: '0.85rem' }} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Kinder-Ergebnis Zähler */}
      {!loading && filtered.length > 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
          {filtered.length} {filtered.length === 1 ? 'Kind' : 'Kinder'}{search ? ` für "${search}"` : ''}
        </div>
      )}

      {/* Kinder-Liste */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👦</div>
            <p>{kinder.length === 0
              ? 'Noch keine Kinder registriert. Importiere eine Excel-Liste oder synchronisiere aus den bestehenden Listen.'
              : 'Keine Kinder gefunden für "' + search + '"'
            }</p>
          </div>
        ) : (
          filtered.map(k => {
            const aCount = parseInt(k.anmeldungen_count) || 0;
            const bCount = parseInt(k.buchungen_count) || 0;
            const fehlend = aCount > 0 && bCount === 0;
            return (
              <div key={k.id} className="kind-row" onClick={() => setSelectedKindId(k.id)}>
                <Avatar vorname={k.vorname} nachname={k.nachname} size="md" />
                <div className="kind-row-info">
                  <div className="kind-row-name">{k.vorname} {k.nachname}</div>
                  <div className="kind-row-meta">
                    {k.klasse ? `Klasse ${k.klasse}` : 'Keine Klasse'}
                    {' · '}
                    {parseInt(k.block_count_a) || 0} {(parseInt(k.block_count_a) || 0) === 1 ? 'Block' : 'Blöcke'}
                  </div>
                </div>
                <div className="kind-row-stats">
                  <div className="kind-mini-stat">
                    <div className="val" style={{ color: 'var(--primary)' }}>{aCount}</div>
                    <div className="lbl">Anmeld.</div>
                  </div>
                  <div className="kind-mini-stat">
                    <div className="val" style={{ color: fehlend ? 'var(--danger)' : bCount > 0 ? 'var(--success)' : 'var(--text2)' }}>{bCount}</div>
                    <div className="lbl">Buchung.</div>
                  </div>
                </div>
                <div className="kind-row-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => startEdit(k)} title="Bearbeiten">✎</button>
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => deleteKind(k.id)} title="Löschen">✗</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit Modal */}
      {editKind && (
        <div className="modal-overlay" onClick={() => setEditKind(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Kind bearbeiten</h3>
            <div className="form-group">
              <label>Nachname</label>
              <input className="form-input" value={editForm.nachname} onChange={e => setEditForm({ ...editForm, nachname: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Vorname</label>
              <input className="form-input" value={editForm.vorname} onChange={e => setEditForm({ ...editForm, vorname: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Klasse</label>
              <input className="form-input" value={editForm.klasse} onChange={e => setEditForm({ ...editForm, klasse: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Notizen</label>
              <textarea className="textarea" style={{ minHeight: '80px' }} value={editForm.notizen} onChange={e => setEditForm({ ...editForm, notizen: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditKind(null)}>Abbrechen</button>
              <button className="btn btn-primary" style={{ width: 'auto' }} onClick={saveEdit}>Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KinderVerzeichnis;
