import React, { useState } from 'react';
import { API } from '../utils/api';
import { fmtDate } from '../utils/helpers';
import Spinner from './Spinner';

const FerienblockPage = ({ blocks, onReload }) => {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', startdatum: '', enddatum: '', preis_pro_tag: '3.50' });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null); // welcher Block ist aufgeklappt
  const [detail, setDetail] = useState({});   // { blockId: { a: [...], b: [...] } }
  const [detailLoading, setDetailLoading] = useState({});

  const openNew = () => { setEditing(null); setForm({ name: '', startdatum: '', enddatum: '', preis_pro_tag: '3.50' }); setShowModal(true); };
  const openEdit = (b) => {
    setEditing(b);
    setForm({ name: b.name, startdatum: String(b.startdatum).split('T')[0], enddatum: String(b.enddatum).split('T')[0], preis_pro_tag: String(b.preis_pro_tag) });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    if (editing) await API.put('ferienblock', { ...form, id: editing.id });
    else await API.post('ferienblock', form);
    setSaving(false);
    setShowModal(false);
    onReload();
  };

  const remove = async (id) => {
    if (!window.confirm('Ferienblock und ALLE zugehörigen Daten (Listen A+B, Abgleiche) löschen?')) return;
    await API.post('ferienblock', { action: 'delete', id });
    onReload();
  };

  // Block aufklappen & Daten laden
  const toggleExpand = async (blockId) => {
    if (expanded === blockId) { setExpanded(null); return; }
    setExpanded(blockId);
    if (detail[blockId]) return; // schon geladen
    setDetailLoading(prev => ({ ...prev, [blockId]: true }));
    const [a, b] = await Promise.all([
      API.get('listen', { ferienblock_id: blockId, liste: 'A' }),
      API.get('listen', { ferienblock_id: blockId, liste: 'B' })
    ]);
    setDetail(prev => ({
      ...prev, [blockId]: {
        a: Array.isArray(a) ? a : [],
        b: Array.isArray(b) ? b : []
      }
    }));
    setDetailLoading(prev => ({ ...prev, [blockId]: false }));
  };

  // Alle Einträge einer Liste löschen
  const clearListe = async (blockId, liste) => {
    if (!window.confirm(`Alle Einträge in Liste ${liste} für diesen Block löschen?`)) return;
    await API.post('listen', { action: 'delete', ferienblock_id: blockId, liste });
    // Detail-Cache leeren und neu laden
    setDetail(prev => { const n = { ...prev }; delete n[blockId]; return n; });
    setExpanded(null);
    setTimeout(() => toggleExpand(blockId), 100);
    onReload();
  };

  // Einzelnen Eintrag löschen (nicht direkt in API, aber wir können über listen.js erweitern - vorerst ganze Liste neu laden)
  const reloadDetail = async (blockId) => {
    setDetailLoading(prev => ({ ...prev, [blockId]: true }));
    const [a, b] = await Promise.all([
      API.get('listen', { ferienblock_id: blockId, liste: 'A' }),
      API.get('listen', { ferienblock_id: blockId, liste: 'B' })
    ]);
    setDetail(prev => ({
      ...prev, [blockId]: {
        a: Array.isArray(a) ? a : [],
        b: Array.isArray(b) ? b : []
      }
    }));
    setDetailLoading(prev => ({ ...prev, [blockId]: false }));
    onReload();
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Buchungszeiträume</span>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Ferienblöcke</h2>
        </div>
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-xl shadow-primary/20 hover:-translate-y-0.5 transition-transform" onClick={openNew}>
          <span className="material-symbols-outlined text-sm">add</span>Neuer Ferienblock
        </button>
      </div>

      {blocks.length === 0 ? (
        <button className="w-full border-2 border-dashed border-outline-variant/30 rounded-2xl flex flex-col items-center justify-center p-12 gap-4 group hover:border-primary/40 hover:bg-surface-container-low transition-all" onClick={openNew}>
          <div className="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center group-hover:scale-110 group-hover:bg-primary-fixed transition-all">
            <span className="material-symbols-outlined text-primary text-3xl">add</span>
          </div>
          <span className="text-sm font-black text-primary uppercase tracking-widest">Ersten Block erstellen</span>
        </button>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {blocks.map(b => {
            const isOpen = expanded === b.id;
            const d = detail[b.id];
            const loading = detailLoading[b.id];
            return (
              <article key={b.id} className="bg-surface-container-lowest p-6 rounded-2xl relative group hover:shadow-[0_24px_32px_rgba(28,27,31,0.06)] transition-all duration-300">
                <div className="flex justify-between items-start mb-6">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-primary tracking-tight">{b.name}</h3>
                    <div className="flex items-center gap-2 text-on-surface-variant/60 text-sm">
                      <span className="material-symbols-outlined text-sm">event</span>
                      <span>{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</span>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-tertiary-container/20 text-on-tertiary-container text-[10px] font-black uppercase tracking-widest">Aktiv</span>
                </div>
                <div className="mb-6">
                  <div className="text-3xl font-black text-on-surface tracking-tighter">{parseFloat(b.preis_pro_tag).toFixed(2)} € <span className="text-sm font-normal text-on-surface-variant">/ Tag</span></div>
                </div>
                {d && (
                  <div className="flex items-center justify-between py-3 border-t border-outline-variant/30 text-xs text-on-surface-variant">
                    <div className="flex items-center gap-1 font-medium">
                      <span className="material-symbols-outlined text-sm">child_care</span>
                      {d.a.length} Anmeldungen
                    </div>
                    <div className="flex items-center gap-1 font-medium">
                      <span className="material-symbols-outlined text-sm">bookmark_added</span>
                      {d.b.length} Buchungen
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-outline-variant/30">
                  <button className="flex-1 bg-secondary-container text-on-secondary-container py-2.5 rounded-lg text-xs font-bold hover:opacity-80 transition-all" onClick={() => toggleExpand(b.id)}>
                    {isOpen ? 'Zuklappen' : 'Details'}
                  </button>
                  <button className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors" onClick={() => openEdit(b)}>
                    <span className="material-symbols-outlined text-lg">edit</span>
                  </button>
                  <button className="p-2 text-error hover:bg-error-container rounded-lg transition-colors" onClick={() => remove(b.id)}>
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-outline-variant/30">
                    {loading ? <div className="py-4 text-center"><Spinner /></div> : (
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1"><span className="material-symbols-outlined text-xs">assignment</span>Liste A ({d?.a.length || 0})</span>
                            <div className="flex gap-1">
                              <button className="p-1 rounded text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => reloadDetail(b.id)}><span className="material-symbols-outlined text-sm">refresh</span></button>
                              {d?.a.length > 0 && <button className="px-2 py-0.5 text-[10px] font-bold rounded text-error hover:bg-error/10 transition-colors" onClick={() => clearListe(b.id, 'A')}>Leeren</button>}
                            </div>
                          </div>
                          {!d?.a.length ? (
                            <p className="text-xs text-on-surface-variant/50 italic p-2">Keine Einträge</p>
                          ) : (
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-outline-variant/30">
                              <table className="w-full text-xs">
                                <tbody className="divide-y divide-outline-variant/25">{d.a.map((k,i)=>(
                                  <tr key={i} className="hover:bg-surface-container-low/50">
                                    <td className="px-2 py-1.5 font-bold text-on-surface">{k.nachname}</td>
                                    <td className="px-2 py-1.5 text-on-surface-variant">{k.vorname}</td>
                                    <td className="px-2 py-1.5 text-on-surface-variant/60">{k.klasse||'–'}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1"><span className="material-symbols-outlined text-xs">bookmark_added</span>Liste B ({d?.b.length || 0})</span>
                            {d?.b.length > 0 && <button className="px-2 py-0.5 text-[10px] font-bold rounded text-error hover:bg-error/10 transition-colors" onClick={() => clearListe(b.id, 'B')}>Leeren</button>}
                          </div>
                          {!d?.b.length ? (
                            <p className="text-xs text-on-surface-variant/50 italic p-2">Keine Einträge</p>
                          ) : (
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-outline-variant/30">
                              <table className="w-full text-xs">
                                <tbody className="divide-y divide-outline-variant/25">{d.b.map((k,i)=>(
                                  <tr key={i} className="hover:bg-surface-container-low/50">
                                    <td className="px-2 py-1.5 font-bold text-on-surface">{k.nachname}</td>
                                    <td className="px-2 py-1.5 text-on-surface-variant">{k.vorname}</td>
                                    <td className="px-2 py-1.5 text-on-surface-variant/60">{k.datum ? fmtDate(k.datum) : '–'}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center" onClick={() => setShowModal(false)}>
          <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-xl max-w-md w-full mx-4 space-y-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-extrabold text-on-surface">{editing ? 'Block bearbeiten' : 'Neuer Ferienblock'}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Name</label>
                <input className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="z.B. Herbstferien 2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Start</label>
                  <input type="date" className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" value={form.startdatum} onChange={e => setForm({...form, startdatum: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Ende</label>
                  <input type="date" className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" value={form.enddatum} onChange={e => setForm({...form, enddatum: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Preis / Tag (€)</label>
                <input type="number" step="0.01" className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" value={form.preis_pro_tag} onChange={e => setForm({...form, preis_pro_tag: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button className="px-5 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setShowModal(false)}>Abbrechen</button>
              <button className="px-6 py-2 text-sm font-bold rounded-xl bg-primary text-on-primary shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform disabled:opacity-50" disabled={saving || !form.name || !form.startdatum || !form.enddatum} onClick={save}>
                {saving ? 'Speichern...' : editing ? 'Aktualisieren' : 'Erstellen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FerienblockPage;
