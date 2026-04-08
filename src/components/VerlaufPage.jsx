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

  useEffect(() => { loadVerlauf(blockId); }, [blockId]);

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
    // Simple text diff
    const fmtMatch = (m) => `${m.match_typ}: ${m.a_nachname || m.b_nachname || '?'}, ${m.a_vorname || m.b_vorname || '?'} — ${m.a_datum ? fmtDate(m.a_datum) : m.b_datum ? fmtDate(m.b_datum) : '?'}`;
    const textA = (resA?.matches || []).map(fmtMatch).sort().join('\n');
    const textB = (resB?.matches || []).map(fmtMatch).sort().join('\n');
    setDiffResult(`─── Abgleich #${compareIds[0]} ───\n${textA}\n\n─── Abgleich #${compareIds[1]} ───\n${textB}`);
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
          {compareMode && compareIds.length === 2 && (
            <button className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-lg shadow-primary/20" onClick={doDiff} disabled={compareLoading}>{compareLoading ? 'Laden...' : 'Vergleichen'}</button>
          )}
          <button className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${compareMode ? 'bg-error text-on-error' : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low'}`} onClick={() => { setCompareMode(!compareMode); setCompareIds([]); setDiffResult(null); }}>
            <span className="material-symbols-outlined text-sm mr-1">{compareMode ? 'close' : 'compare_arrows'}</span>{compareMode ? 'Abbrechen' : 'Vergleichen'}
          </button>
        </div>
      </div>

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
                      <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ {a.matches}</span>
                      {a.nur_in_a > 0 && <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full">↓ {a.nur_in_a}</span>}
                      {a.nur_in_b > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">↑ {a.nur_in_b}</span>}
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
                            <tr key={i} className={`${m.match_typ === 'nur_in_a' ? 'bg-red-50/50' : m.match_typ === 'nur_in_b' ? 'bg-amber-50/50' : ''}`}>
                              <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted' ? 'bg-emerald-100 text-emerald-700' : m.match_typ === 'nur_in_a' ? 'bg-error/10 text-error' : 'bg-amber-100 text-amber-700'}`}>{m.match_typ === 'exact' ? 'OK' : m.match_typ === 'fuzzy_accepted' ? 'Fuzzy' : m.match_typ === 'nur_in_a' ? 'Fehlt' : 'Nur B'}</span></td>
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

      {/* Diff Modal */}
      {diffResult && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center" onClick={() => setDiffResult(null)}>
          <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-extrabold text-on-surface">Abgleich-Vergleich</h3>
              <button className="p-1 text-on-surface-variant hover:text-error transition-colors" onClick={() => setDiffResult(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <pre className="text-xs font-mono bg-surface-container-low p-4 rounded-xl overflow-x-auto whitespace-pre-wrap">{diffResult}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerlaufPage;
