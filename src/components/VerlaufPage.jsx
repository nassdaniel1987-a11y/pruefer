import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';
import { fmtDate, fmtDateTime } from '../utils/helpers';
import Spinner from './Spinner';
import VergleichView from './VergleichView';

// VERLAUF
const VerlaufPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [verlauf, setVerlauf] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  // Vergleichsmodus
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [diffResult, setDiffResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  // Import-Log
  const [activeTab, setActiveTab] = useState('abgleiche');
  const [importLogs, setImportLogs] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [openLogId, setOpenLogId] = useState(null);

  const loadVerlauf = (id) => {
    if (!id) return;
    setLoading(true);
    setOpenId(null);
    setCompareMode(false); setCompareIds([]);
    API.get('abgleich', { ferienblock_id: id }).then(d => {
      setVerlauf(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  const loadImportLogs = (id) => {
    if (!id) return;
    setImportLoading(true);
    setOpenLogId(null);
    API.get('listen', { import_log: 1, ferienblock_id: id }).then(d => {
      setImportLogs(Array.isArray(d) ? d : []);
      setImportLoading(false);
    });
  };

  useEffect(() => {
    if (activeTab === 'abgleiche') loadVerlauf(blockId);
    else loadImportLogs(blockId);
  }, [blockId, activeTab]);

  const toggleDetail = async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (detail[id]) return;
    setDetailLoading(prev => ({ ...prev, [id]: true }));
    const res = await API.get('abgleich', { abgleich_id: id });
    setDetail(prev => ({ ...prev, [id]: res }));
    setDetailLoading(prev => ({ ...prev, [id]: false }));
  };

  const doDiff = async () => {
    if (compareIds.length !== 2) return;
    setCompareLoading(true);
    const [resA, resB] = await Promise.all([
      API.get('abgleich', { abgleich_id: compareIds[0] }),
      API.get('abgleich', { abgleich_id: compareIds[1] })
    ]);

    const abgA = verlauf.find(a => a.id === compareIds[0]);
    const abgB = verlauf.find(a => a.id === compareIds[1]);

    const isAOlder = new Date(abgA.erstellt_am) < new Date(abgB.erstellt_am);

    setDiffResult({
      matchesOld: isAOlder ? resA.matches : resB.matches,
      matchesNew: isAOlder ? resB.matches : resA.matches,
      abgleichOld: isAOlder ? abgA : abgB,
      abgleichNew: isAOlder ? abgB : abgA
    });
    setCompareLoading(false);
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Protokoll & Audit</span>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Verlauf</h2>
        </div>
        <div className="flex items-center gap-3">
          <select className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl px-4 py-2 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary/20" value={blockId} onChange={e => setBlockId(e.target.value)}>
            <option value="">Alle Blöcke</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {activeTab === 'abgleiche' && compareMode && compareIds.length === 2 && (
            <button className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-lg shadow-primary/20" onClick={doDiff} disabled={compareLoading}>{compareLoading ? 'Laden...' : 'Vergleichen'}</button>
          )}
          {activeTab === 'abgleiche' && (
            <button className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${compareMode ? 'bg-error text-on-error' : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low'}`} onClick={() => { setCompareMode(!compareMode); setCompareIds([]); setDiffResult(null); }}>
              <span className="material-symbols-outlined text-sm mr-1">{compareMode ? 'close' : 'compare_arrows'}</span>{compareMode ? 'Abbrechen' : 'Vergleichen'}
            </button>
          )}
        </div>
      </div>

      {/* Tab-Bar */}
      <div className="flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
        <button
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'abgleiche' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
          onClick={() => setActiveTab('abgleiche')}
        >Abgleiche</button>
        <button
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'importe' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
          onClick={() => setActiveTab('importe')}
        >Importe</button>
      </div>

      {/* ── ABGLEICHE TAB ── */}
      {activeTab === 'abgleiche' && (
        <>
          {loading && <div className="py-12 flex justify-center"><Spinner /></div>}

          {!loading && verlauf.length === 0 && (
            <div className="bg-surface-container-lowest rounded-2xl p-12 shadow-sm border border-outline-variant/10 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant/40 mb-3">history</span>
              <p className="text-lg font-bold text-on-surface">Keine Abgleiche vorhanden.</p>
              <p className="text-sm text-on-surface-variant mt-1">Führe im Abgleich-Tool zuerst einen Abgleich durch.</p>
            </div>
          )}

          {!loading && verlauf.length > 0 && (
            <div className="space-y-3">
              {verlauf.map(a => {
                const isOpen = openId === a.id;
                return (
                  <div key={a.id} className={`bg-surface-container-lowest rounded-2xl shadow-sm border transition-all ${compareMode && compareIds.includes(a.id) ? 'border-primary border-l-4 shadow-md' : 'border-outline-variant/10'}`}>
                    <div className="flex items-center gap-4 p-5 cursor-pointer" onClick={() => {
                      if (compareMode) { setCompareIds(prev => prev.includes(a.id) ? prev.filter(x => x !== a.id) : prev.length < 2 ? [...prev, a.id] : prev); return; }
                      toggleDetail(a.id);
                    }}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${compareMode && compareIds.includes(a.id) ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
                        <span className="material-symbols-outlined text-xl">sync</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-on-surface text-sm">{a.block_name || 'Block'}</span>
                          <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase">{new Date(a.erstellt_am).toLocaleDateString('de-DE')} {new Date(a.erstellt_am).toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ {a.matches}</span>
                          {a.nur_in_a > 0 && <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full" title="Kein Essen gebucht">↓ {a.nur_in_a} kein Essen</span>}
                          {a.nur_in_b > 0 && <span className="bg-tertiary-container text-on-tertiary-container text-[10px] font-bold px-2 py-0.5 rounded-full" title="Essen gebucht — nicht angemeldet">↑ {a.nur_in_b} nicht angem.</span>}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant/50">{isOpen ? 'expand_less' : 'expand_more'}</span>
                    </div>
                    {isOpen && detail[a.id] && (
                      <div className="border-t border-outline-variant/10 p-5">
                        <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                          <table className="w-full text-sm">
                            <thead><tr className="bg-surface-container-low">
                              <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Typ</th>
                              <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                              <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                              <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Datum</th>
                            </tr></thead>
                            <tbody className="divide-y divide-outline-variant/5">
                              {detail[a.id].matches?.map((m,i) => (
                                <tr key={i} className={`${m.match_typ === 'nur_in_a' ? 'bg-error-container/10' : m.match_typ === 'nur_in_b' ? 'bg-tertiary-container/10' : ''}`}>
                                  <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted') ? 'bg-emerald-500/10 text-emerald-500' : m.match_typ === 'nur_in_a' ? 'bg-error text-on-error' : 'bg-tertiary text-on-tertiary'}`}>{(m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted') ? 'OK' : m.match_typ === 'nur_in_a' ? 'Kein Essen' : 'Nicht angem.'}</span></td>
                                  <td className="px-3 py-2 font-bold text-on-surface">{m.a_nachname || m.b_nachname || '–'}</td>
                                  <td className="px-3 py-2 text-on-surface-variant">{m.a_vorname || m.b_vorname || '–'}</td>
                                  <td className="px-3 py-2 text-on-surface-variant/60 text-xs">{m.a_datum ? fmtDate(m.a_datum) : m.b_datum ? fmtDate(m.b_datum) : '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {isOpen && detailLoading[a.id] && <div className="p-5 text-center border-t border-outline-variant/10"><Spinner /></div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── IMPORTE TAB ── */}
      {activeTab === 'importe' && (
        <>
          {importLoading && <div className="py-12 flex justify-center"><Spinner /></div>}

          {!importLoading && importLogs.length === 0 && (
            <div className="bg-surface-container-lowest rounded-2xl p-12 shadow-sm border border-outline-variant/10 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant/40 mb-3">upload_file</span>
              <p className="text-lg font-bold text-on-surface">Keine Import-Protokolle vorhanden.</p>
              <p className="text-sm text-on-surface-variant mt-1">Protokolle werden beim nächsten Listen-Import automatisch erstellt.</p>
            </div>
          )}

          {!importLoading && importLogs.length > 0 && (
            <div className="space-y-3">
              {importLogs.map(log => {
                const isOpen = openLogId === log.id;
                const neuItems = log.details?.filter(d => d.aktion === 'neu') || [];
                const wegItems = log.details?.filter(d => d.aktion === 'weg') || [];
                const tagNeuItems = log.details?.filter(d => d.aktion === 'tag_neu') || [];
                const tagWegItems = log.details?.filter(d => d.aktion === 'tag_weg') || [];
                const hasAnyChanges = neuItems.length > 0 || wegItems.length > 0 || tagNeuItems.length > 0 || tagWegItems.length > 0;
                return (
                  <div key={log.id} className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10">
                    <div className="flex items-center gap-4 p-5 cursor-pointer" onClick={() => setOpenLogId(isOpen ? null : log.id)}>
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-xl">upload_file</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-on-surface text-sm">Liste {log.liste}</span>
                          <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase">
                            {new Date(log.erstellt_am).toLocaleDateString('de-DE')} {new Date(log.erstellt_am).toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] font-bold bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full">{log.eintraege_gesamt} gesamt</span>
                          {log.eintraege_neu > 0 && <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full">+{log.eintraege_neu} neu</span>}
                          {log.eintraege_weg > 0 && <span className="text-[10px] font-bold bg-error/10 text-error px-2 py-0.5 rounded-full">−{log.eintraege_weg} entfernt</span>}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant/50">{isOpen ? 'expand_less' : 'expand_more'}</span>
                    </div>

                    {isOpen && log.details && log.details.length > 0 && (
                      <div className="border-t border-outline-variant/10 p-5 space-y-4">
                        {neuItems.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-500 mb-2">Neu dazugekommen ({neuItems.length})</p>
                            <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                              <table className="w-full text-sm">
                                <thead><tr className="bg-surface-container-low">
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Tage</th>
                                </tr></thead>
                                <tbody className="divide-y divide-outline-variant/5">
                                  {neuItems.map((p, i) => (
                                    <tr key={i}>
                                      <td className="px-3 py-2 font-bold text-on-surface">{p.nachname}</td>
                                      <td className="px-3 py-2 text-on-surface-variant">{p.vorname || '–'}</td>
                                      <td className="px-3 py-2 text-on-surface-variant/60 text-xs">{p.tage?.map(t => fmtDate(t)).join(', ') || '–'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {wegItems.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-error mb-2">Komplett weggefallen ({wegItems.length})</p>
                            <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                              <table className="w-full text-sm">
                                <thead><tr className="bg-surface-container-low">
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Tage</th>
                                </tr></thead>
                                <tbody className="divide-y divide-outline-variant/5">
                                  {wegItems.map((p, i) => (
                                    <tr key={i}>
                                      <td className="px-3 py-2 font-bold text-on-surface">{p.nachname}</td>
                                      <td className="px-3 py-2 text-on-surface-variant">{p.vorname || '–'}</td>
                                      <td className="px-3 py-2 text-on-surface-variant/60 text-xs">{p.tage?.map(t => fmtDate(t)).join(', ') || '–'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {tagWegItems.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-amber-500 mb-2">Einzelne Tage entfernt ({tagWegItems.length} Kinder)</p>
                            <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                              <table className="w-full text-sm">
                                <thead><tr className="bg-surface-container-low">
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Entfernte Tage</th>
                                </tr></thead>
                                <tbody className="divide-y divide-outline-variant/5">
                                  {tagWegItems.map((p, i) => (
                                    <tr key={i} className="bg-amber-500/5">
                                      <td className="px-3 py-2 font-bold text-on-surface">{p.nachname}</td>
                                      <td className="px-3 py-2 text-on-surface-variant">{p.vorname || '–'}</td>
                                      <td className="px-3 py-2 text-amber-600 text-xs font-medium">{p.tage?.map(t => fmtDate(t)).join(', ') || '–'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {tagNeuItems.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-500 mb-2">Einzelne Tage hinzugekommen ({tagNeuItems.length} Kinder)</p>
                            <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                              <table className="w-full text-sm">
                                <thead><tr className="bg-surface-container-low">
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                                  <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-outline">Neue Tage</th>
                                </tr></thead>
                                <tbody className="divide-y divide-outline-variant/5">
                                  {tagNeuItems.map((p, i) => (
                                    <tr key={i}>
                                      <td className="px-3 py-2 font-bold text-on-surface">{p.nachname}</td>
                                      <td className="px-3 py-2 text-on-surface-variant">{p.vorname || '–'}</td>
                                      <td className="px-3 py-2 text-emerald-500 text-xs font-medium">{p.tage?.map(t => fmtDate(t)).join(', ') || '–'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {isOpen && (!log.details || log.details.length === 0) && (
                      <div className="border-t border-outline-variant/10 p-5 text-center text-sm text-on-surface-variant space-y-3">
                        <p>Erster Import — kein direkter Vergleich gespeichert.</p>
                        <button
                          className="px-4 py-2 text-xs font-bold rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          onClick={async () => {
                            const res = await API.post('listen', { action: 'rebuild_import_log', ferienblock_id: blockId, liste: log.liste });
                            if (res.success) {
                              if (res.weg === 0 && res.neu === 0 && res.tag_weg === 0 && res.tag_neu === 0) { alert('Kein Unterschied zwischen den Abgleichen gefunden.'); return; }
                              loadImportLogs(blockId);
                            }
                          }}
                        >
                          Nachträglich mit letztem Abgleich vergleichen
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Diff Modal */}
      {diffResult && typeof diffResult === 'object' && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4 xl:p-8" onClick={() => setDiffResult(null)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-6xl h-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-outline-variant/10 shrink-0 bg-surface-container-low">
              <div>
                <h3 className="text-xl font-extrabold text-on-surface">Vergleichs-Analyse</h3>
                <p className="text-sm text-on-surface-variant font-medium mt-1">Änderungen zwischen {new Date(diffResult.abgleichOld.erstellt_am).toLocaleDateString()} und {new Date(diffResult.abgleichNew.erstellt_am).toLocaleDateString()}</p>
              </div>
              <button className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 hover:bg-error/10 hover:text-error hover:border-error/20 transition-all" onClick={() => setDiffResult(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-surface">
              <VergleichView
                matchesOld={diffResult.matchesOld} matchesNew={diffResult.matchesNew}
                abgleichOld={diffResult.abgleichOld} abgleichNew={diffResult.abgleichNew}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerlaufPage;
