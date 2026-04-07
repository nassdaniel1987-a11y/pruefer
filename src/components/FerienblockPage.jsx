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
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">beach_access</span>
            Ferienblöcke
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Verwalte Ferienblöcke, Daten und Einträge</p>
        </div>
        <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors" onClick={openNew}>
          <span className="material-symbols-outlined text-base">add</span>Neuer Ferienblock
        </button>
      </div>

      {blocks.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-sm border border-outline-variant/10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">calendar_month</span>
          <p className="text-on-surface-variant">Noch kein Ferienblock vorhanden.</p>
        </div>
      ) : blocks.map(b => {
        const isOpen = expanded === b.id;
        const d = detail[b.id];
        const loading = detailLoading[b.id];
        return (
          <div key={b.id} className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-3 overflow-hidden">
            <div className="flex justify-between items-center gap-3 p-5 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <span className="font-semibold text-on-surface text-base">{b.name}</span>
                  <span className="text-sm text-on-surface-variant">{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</span>
                  <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{parseFloat(b.preis_pro_tag).toFixed(2)} €/Tag</span>
                </div>
                {d && (
                  <div className="flex gap-2 flex-wrap">
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.a.length} Anmeldungen</span>
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.b.length} Buchungen</span>
                    {d.a.length > d.b.length && (
                      <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.a.length - d.b.length} fehlend</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => toggleExpand(b.id)}>
                  <span className="material-symbols-outlined text-sm">{isOpen ? 'expand_less' : 'expand_more'}</span>
                  {isOpen ? 'Zuklappen' : 'Details'}
                </button>
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => openEdit(b)}>
                  <span className="material-symbols-outlined text-sm">edit</span>Bearbeiten
                </button>
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-error hover:bg-error/10 transition-colors" onClick={() => remove(b.id)}>
                  <span className="material-symbols-outlined text-sm">delete</span>Löschen
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-outline-variant/10 p-5">
                {loading ? <Spinner /> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-semibold text-sm text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base text-primary">assignment</span>
                          Liste A – Anmeldungen ({d?.a.length || 0})
                        </span>
                        <div className="flex gap-1.5">
                          <button className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => reloadDetail(b.id)}>
                            <span className="material-symbols-outlined text-sm">refresh</span>
                          </button>
                          {d?.a.length > 0 && (
                            <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-error hover:bg-error/10 transition-colors" onClick={() => clearListe(b.id, 'A')}>Alle löschen</button>
                          )}
                        </div>
                      </div>
                      {!d?.a.length ? (
                        <p className="text-on-surface-variant text-sm">Keine Einträge vorhanden.</p>
                      ) : (
                        <div className="max-h-[300px] overflow-y-auto rounded-xl border border-outline-variant/10">
                          <table className="w-full text-sm">
                            <thead><tr className="bg-surface-container/50 sticky top-0">
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Nachname</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Vorname</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Klasse</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Datum</th>
                            </tr></thead>
                            <tbody className="divide-y divide-outline-variant/10">
                              {d.a.map(e => (
                                <tr key={e.id} className="hover:bg-surface-container/30">
                                  <td className="px-3 py-2 text-on-surface">{e.nachname}</td>
                                  <td className="px-3 py-2 text-on-surface">{e.vorname}</td>
                                  <td className="px-3 py-2 text-on-surface-variant">{e.klasse || '–'}</td>
                                  <td className="px-3 py-2 text-on-surface-variant">{fmtDate(e.datum)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-semibold text-sm text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base text-primary">restaurant</span>
                          Liste B – Buchungen ({d?.b.length || 0})
                        </span>
                        <div className="flex gap-1.5">
                          <button className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => reloadDetail(b.id)}>
                            <span className="material-symbols-outlined text-sm">refresh</span>
                          </button>
                          {d?.b.length > 0 && (
                            <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-error hover:bg-error/10 transition-colors" onClick={() => clearListe(b.id, 'B')}>Alle löschen</button>
                          )}
                        </div>
                      </div>
                      {!d?.b.length ? (
                        <p className="text-on-surface-variant text-sm">Keine Einträge vorhanden.</p>
                      ) : (
                        <div className="max-h-[300px] overflow-y-auto rounded-xl border border-outline-variant/10">
                          <table className="w-full text-sm">
                            <thead><tr className="bg-surface-container/50 sticky top-0">
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Nachname</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Vorname</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Klasse</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Datum</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Menü</th>
                            </tr></thead>
                            <tbody className="divide-y divide-outline-variant/10">
                              {d.b.map(e => (
                                <tr key={e.id} className="hover:bg-surface-container/30">
                                  <td className="px-3 py-2 text-on-surface">{e.nachname}</td>
                                  <td className="px-3 py-2 text-on-surface">{e.vorname}</td>
                                  <td className="px-3 py-2 text-on-surface-variant">{e.klasse || '–'}</td>
                                  <td className="px-3 py-2 text-on-surface-variant">{fmtDate(e.datum)}</td>
                                  <td className="px-3 py-2 text-on-surface-variant text-xs">{e.menu || '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-on-surface mb-5">{editing ? 'Ferienblock bearbeiten' : 'Neuer Ferienblock'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Name</label>
                <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Winterferien 2026" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Startdatum</label>
                  <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
                    type="date" value={form.startdatum} onChange={e => setForm({ ...form, startdatum: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Enddatum</label>
                  <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
                    type="date" value={form.enddatum} onChange={e => setForm({ ...form, enddatum: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Preis pro Tag (€)</label>
                <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
                  type="number" step="0.01" value={form.preis_pro_tag} onChange={e => setForm({ ...form, preis_pro_tag: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => setShowModal(false)}>Abbrechen</button>
              <button className="px-4 py-2 text-sm font-medium rounded-xl bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
                disabled={saving || !form.name || !form.startdatum || !form.enddatum} onClick={save}>
                {saving ? 'Speichern...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FerienblockPage;
