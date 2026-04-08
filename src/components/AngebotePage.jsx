import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';
import { fmtDate } from '../utils/helpers';
import Spinner from './Spinner';

// ─── ANGEBOTE PAGE ───────────────────────────────────
const STATUS_CFG = {
  vollstaendig:    { label: 'Vollständig',     badgeClass: 'badge-green'  },
  teilweise:       { label: 'Teilweise',        badgeClass: 'badge-orange' },
  nicht_gebucht:   { label: 'Kein Essen',       badgeClass: 'badge-red'    },
  nur_gebucht:     { label: 'Nur gebucht',      badgeClass: 'badge-blue'   },
  nicht_vorhanden: { label: 'Nicht vorhanden',  badgeClass: 'badge-grey'   },
};

// Hilfsfunktion: alle Tage zwischen start und end als YYYY-MM-DD Array
const tageBetween = (start, end) => {
  const days = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
};

const AngebotePage = ({ blocks }) => {
  const [angebote, setAngebote] = useState([]);
  const [selectedAngebot, setSelectedAngebot] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(null);
  const [createForm, setCreateForm] = useState({ name: '', ferienblock_id: '', beschreibung: '', tage: [] });
  const [filterBlock, setFilterBlock] = useState('');
  const [kinderSuche, setKinderSuche] = useState('');
  const [kinderListe, setKinderListe] = useState([]);
  const [kinderGefiltert, setKinderGefiltert] = useState([]);

  const loadAngebote = async (fbId = filterBlock) => {
    setLoadingList(true);
    const res = await API.get('angebote', fbId ? { ferienblock_id: fbId } : {});
    setAngebote(Array.isArray(res) ? res : []);
    setLoadingList(false);
  };

  const loadDetail = async (id) => {
    setLoadingDetail(true);
    setDetailData(null);
    const res = await API.get('angebote', { id });
    setDetailData(res.error ? null : res);
    setLoadingDetail(false);
  };

  const loadKinder = async () => {
    const res = await API.get('kinder');
    setKinderListe(Array.isArray(res) ? res : []);
  };

  useEffect(() => { loadAngebote(); loadKinder(); }, []);

  useEffect(() => {
    if (!kinderSuche.trim()) { setKinderGefiltert([]); return; }
    const q = kinderSuche.toLowerCase();
    const bereits = detailData?.kinder?.map(k => k.id) || [];
    setKinderGefiltert(
      kinderListe.filter(k =>
        !bereits.includes(k.id) &&
        (k.nachname.toLowerCase().includes(q) || k.vorname.toLowerCase().includes(q) || (k.klasse || '').toLowerCase().includes(q))
      ).slice(0, 10)
    );
  }, [kinderSuche, kinderListe, detailData]);

  const handleFilterBlock = (val) => {
    setFilterBlock(val);
    loadAngebote(val);
    setSelectedAngebot(null);
    setDetailData(null);
  };

  const handleSelectAngebot = (a) => {
    setSelectedAngebot(a);
    loadDetail(a.id);
    setKinderSuche('');
    setShowEditForm(null);
  };

  // Datum in createForm/editForm toggeln
  const toggleTag = (datum, form, setForm) => {
    setForm(f => ({
      ...f,
      tage: f.tage.includes(datum) ? f.tage.filter(d => d !== datum) : [...f.tage, datum].sort()
    }));
  };

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.ferienblock_id) {
      toast.error('Name und Ferienblock sind Pflichtfelder');
      return;
    }
    if (createForm.tage.length === 0) {
      toast.error('Bitte mindestens einen Tag auswählen');
      return;
    }
    const res = await API.post('angebote', { action: 'create', ...createForm });
    if (res.success) {
      toast.success('Angebot erstellt');
      setShowCreateForm(false);
      setCreateForm({ name: '', ferienblock_id: '', beschreibung: '', tage: [] });
      await loadAngebote();
    }
  };

  const handleEdit = async () => {
    if (!showEditForm) return;
    if (showEditForm.tage.length === 0) {
      toast.error('Bitte mindestens einen Tag auswählen');
      return;
    }
    const res = await API.post('angebote', { action: 'edit', id: showEditForm.id, name: showEditForm.name, beschreibung: showEditForm.beschreibung, tage: showEditForm.tage });
    if (res.success) {
      toast.success('Angebot aktualisiert');
      setShowEditForm(null);
      await loadAngebote();
      if (selectedAngebot?.id === showEditForm.id) loadDetail(showEditForm.id);
    }
  };

  const handleDelete = async (id, name) => {
    const ok = await confirmDialog('Angebot löschen', `"${name}" und alle zugeordneten Kinder wirklich löschen?`, 'Löschen');
    if (!ok) return;
    const res = await API.post('angebote', { action: 'delete', id });
    if (res.success) {
      toast.success('Angebot gelöscht');
      if (selectedAngebot?.id === id) { setSelectedAngebot(null); setDetailData(null); }
      await loadAngebote();
    }
  };

  const handleAddKind = async (kind) => {
    const res = await API.post('angebote', { action: 'add_kind', angebot_id: selectedAngebot.id, kind_id: kind.id });
    if (res.success) {
      toast.success(`${kind.vorname} ${kind.nachname} hinzugefügt`);
      setKinderSuche('');
      await loadDetail(selectedAngebot.id);
      await loadAngebote();
    }
  };

  const handleRemoveKind = async (kind) => {
    const ok = await confirmDialog('Kind entfernen', `${kind.vorname} ${kind.nachname} aus dem Angebot entfernen?`, 'Entfernen');
    if (!ok) return;
    const res = await API.post('angebote', { action: 'remove_kind', angebot_id: selectedAngebot.id, kind_id: kind.id });
    if (res.success) {
      toast.success(`${kind.vorname} ${kind.nachname} entfernt`);
      await loadDetail(selectedAngebot.id);
      await loadAngebote();
    }
  };

  const fmtD = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
  };
  const fmtShort = (d) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`;
  };

  // Tage-Auswahl Komponente (wiederverwendbar für create + edit)
  const TageAuswahl = ({ blockId, selectedTage, onChange }) => {
    const block = blocks.find(b => String(b.id) === String(blockId));
    if (!block) return <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>Erst Ferienblock wählen</p>;
    const alle = tageBetween(block.startdatum, block.enddatum);
    return (
      <div>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => onChange(alle)}>Alle</button>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => onChange([])}>Keine</button>
        </div>
        <div className="days-grid">
          {alle.map(d => {
            const dt = new Date(d);
            const wt = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
            const aktiv = selectedTage.includes(d);
            return (
              <span key={d}
                onClick={() => onChange(selectedTage.includes(d) ? selectedTage.filter(x => x !== d) : [...selectedTage, d].sort())}
                className={`day-chip ${aktiv ? 'matched' : ''}`}
                style={{ cursor: 'pointer', opacity: aktiv ? 1 : 0.45, userSelect: 'none' }}>
                {wt} {fmtShort(d)}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Gruppen & Buchungsstatus</span>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Angebote</h2>
        </div>
        <div className="flex items-center gap-3">
          <select className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl px-4 py-2 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary/20" value={filterBlock} onChange={e => handleFilterBlock(e.target.value)}>
            <option value="">Alle Ferienblöcke</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-xl shadow-primary/20 hover:-translate-y-0.5 transition-transform" onClick={() => setShowCreateForm(v => !v)}>
            <span className="material-symbols-outlined text-sm">{showCreateForm ? 'close' : 'add'}</span>
            {showCreateForm ? 'Abbrechen' : 'Neu'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* Left Column: List */}
        <div className="xl:col-span-4 space-y-4">
          {loadingList ? (
            <div className="py-12 flex justify-center"><Spinner /></div>
          ) : angebote.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl p-12 shadow-sm border border-outline-variant/10 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant/40 mb-3">local_offer</span>
              <p className="text-lg font-bold text-on-surface">Keine Angebote</p>
              <p className="text-sm text-on-surface-variant mt-1">Erstelle dein erstes Angebot.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {angebote.map(a => (
                <button key={a.id} className={`w-full text-left p-4 rounded-xl border transition-all ${selectedAngebot?.id === a.id ? 'bg-primary/5 border-primary border-l-4 shadow-md' : 'bg-surface-container-lowest border-outline-variant/10 hover:border-primary/30'}`} onClick={() => handleSelectAngebot(a)}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-sm font-bold ${selectedAngebot?.id === a.id ? 'text-primary' : 'text-on-surface'}`}>{a.name}</span>
                      <p className="text-xs text-on-surface-variant mt-0.5">{a.block_name}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">{a.kinder_count} Kinder</span>
                      <span className="text-[10px] text-on-surface-variant">{a.tage_count} Tage</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Create Form */}
          {showCreateForm && (
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/10 space-y-4">
              <h3 className="text-lg font-extrabold text-on-surface">Neues Angebot</h3>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Name</label>
                <input className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" placeholder="z.B. Fußball, Schwimmen …" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Ferienblock</label>
                <select className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={createForm.ferienblock_id} onChange={e => setCreateForm(f => ({ ...f, ferienblock_id: e.target.value, tage: [] }))}>
                  <option value="">Ferienblock wählen</option>
                  {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Tage <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold ml-1">{createForm.tage.length}</span></label>
                <TageAuswahl blockId={createForm.ferienblock_id} selectedTage={createForm.tage} onChange={tage => setCreateForm(f => ({ ...f, tage }))} />
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Beschreibung</label>
                <textarea className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20 min-h-[60px]" placeholder="Optional …" value={createForm.beschreibung} onChange={e => setCreateForm(f => ({ ...f, beschreibung: e.target.value }))} />
              </div>
              <div className="flex gap-2 justify-end">
                <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setShowCreateForm(false)}>Abbrechen</button>
                <button className="px-5 py-2 text-sm font-bold rounded-xl bg-primary text-on-primary shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform" onClick={handleCreate}>Erstellen</button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Detail */}
        <div className="xl:col-span-8">
          {!selectedAngebot ? (
            <div className="h-full min-h-[400px] border-2 border-dashed border-outline-variant/30 rounded-2xl flex flex-col items-center justify-center p-12 text-center bg-surface-container-lowest/50">
              <div className="w-20 h-20 bg-surface-container-high rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/50">ads_click</span>
              </div>
              <p className="text-xl font-extrabold text-on-surface mb-2">Angebot wählen</p>
              <p className="text-sm text-on-surface-variant max-w-xs">Wähle links ein Angebot aus der Liste, um die Details und den Buchungsstatus anzuzeigen.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header Card */}
              <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/10">
                {showEditForm?.id === selectedAngebot.id ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input className="border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={showEditForm.name} placeholder="Name" onChange={e => setShowEditForm(f => ({ ...f, name: e.target.value }))} />
                      <input className="border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={showEditForm.beschreibung || ''} placeholder="Beschreibung" onChange={e => setShowEditForm(f => ({ ...f, beschreibung: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Tage <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold ml-1">{showEditForm.tage.length}</span></label>
                      <TageAuswahl blockId={selectedAngebot.ferienblock_id} selectedTage={showEditForm.tage} onChange={tage => setShowEditForm(f => ({ ...f, tage }))} />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container" onClick={() => setShowEditForm(null)}>Abbrechen</button>
                      <button className="px-5 py-2 text-sm font-bold rounded-xl bg-primary text-on-primary" onClick={handleEdit}>Speichern</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-2xl font-extrabold text-on-surface mb-1">{selectedAngebot.name}</h3>
                      <p className="text-sm text-on-surface-variant">{selectedAngebot.block_name} · {fmtD(selectedAngebot.startdatum)} – {fmtD(selectedAngebot.enddatum)}</p>
                      {detailData?.angebot?.tage?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {detailData.angebot.tage.map(d => {
                            const dt = new Date(d);
                            const wt = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
                            return <span key={d} className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">{wt} {fmtShort(d)}</span>;
                          })}
                        </div>
                      )}
                      {selectedAngebot.beschreibung && <p className="text-sm text-on-surface-variant mt-2">{selectedAngebot.beschreibung}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-xs font-bold rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setShowEditForm({ id: selectedAngebot.id, name: selectedAngebot.name, beschreibung: selectedAngebot.beschreibung || '', tage: detailData?.angebot?.tage || [] })}>
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                      <button className="px-3 py-1.5 text-xs font-bold rounded-lg text-error hover:bg-error-container transition-colors" onClick={() => handleDelete(selectedAngebot.id, selectedAngebot.name)}>
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {loadingDetail ? <div className="py-8 flex justify-center"><Spinner /></div> : detailData && (
                <>
                  {/* Status Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                      <div key={key} className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 text-center">
                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">{cfg.label}</p>
                        <p className={`text-2xl font-black ${key === 'vollstaendig' ? 'text-emerald-600' : key === 'nicht_gebucht' ? 'text-error' : key === 'teilweise' ? 'text-amber-600' : 'text-on-surface'}`}>{detailData.summary[key]}</p>
                      </div>
                    ))}
                  </div>

                  {/* Add Kind */}
                  <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10 relative">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-on-surface-variant/50">search</span>
                      <input className="flex-1 bg-transparent border-none text-sm focus:ring-0 outline-none" placeholder="Kind hinzufügen – Name oder Klasse suchen…" value={kinderSuche} onChange={e => setKinderSuche(e.target.value)} />
                    </div>
                    {kinderGefiltert.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-xl max-h-[220px] overflow-y-auto">
                        {kinderGefiltert.map(k => (
                          <button key={k.id} className="w-full text-left px-4 py-2.5 hover:bg-surface-container-low transition-colors flex justify-between items-center" onMouseDown={() => handleAddKind(k)}>
                            <span className="text-sm font-bold text-on-surface">{k.nachname}, {k.vorname}</span>
                            <span className="text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{k.klasse || '—'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Children Table */}
                  <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
                    <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">group</span>
                      <span className="font-bold text-on-surface text-sm">Kinder</span>
                      <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-full">{detailData.kinder.length}</span>
                    </div>
                    {detailData.kinder.length === 0 ? (
                      <div className="p-8 text-center">
                        <span className="material-symbols-outlined text-4xl text-on-surface-variant/30">child_care</span>
                        <p className="text-sm text-on-surface-variant mt-2">Noch keine Kinder zugeordnet</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-surface-container-low">
                            <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Name</th>
                            <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Klasse</th>
                            <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Liste A</th>
                            <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Liste B</th>
                            <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Status</th>
                            <th className="px-4 py-3"></th>
                          </tr></thead>
                          <tbody className="divide-y divide-outline-variant/5">
                            {detailData.kinder.map(k => {
                              const cfg = STATUS_CFG[k.status] || { label: k.status };
                              return (
                                <tr key={k.id} className="hover:bg-surface-container-low/50 transition-colors">
                                  <td className="px-4 py-3 font-bold text-on-surface">{k.nachname}, {k.vorname}</td>
                                  <td className="px-4 py-3 text-on-surface-variant">{k.klasse || '—'}</td>
                                  <td className="px-4 py-3 text-center">
                                    {k.tage_liste_a.length > 0
                                      ? <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{k.tage_liste_a.length} Tage</span>
                                      : <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {k.tage_liste_b.length > 0
                                      ? <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{k.tage_liste_b.length} Tage</span>
                                      : <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full">—</span>}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${k.status === 'vollstaendig' ? 'bg-emerald-100 text-emerald-700' : k.status === 'nicht_gebucht' ? 'bg-error/10 text-error' : k.status === 'teilweise' ? 'bg-amber-100 text-amber-700' : 'bg-surface-container-high text-on-surface-variant'}`}>{cfg.label}</span>
                                    {k.nur_in_a.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {k.nur_in_a.map(d => <span key={d} className="bg-error/10 text-error text-[9px] font-bold px-1.5 py-0.5 rounded">⚠ {fmtShort(d)}</span>)}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <button className="text-error hover:bg-error-container px-2 py-1 rounded-lg text-xs font-bold transition-colors" onClick={() => handleRemoveKind(k)}>Entfernen</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AngebotePage;
