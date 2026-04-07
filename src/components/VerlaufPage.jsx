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
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareData, setCompareData] = useState({ a: null, b: null });
  const [compareLoading, setCompareLoading] = useState(false);

  const loadVerlauf = (id) => {
    if (!id) return;
    setLoading(true);
    setOpenId(null);
    setCompareMode(false); setCompareA(''); setCompareB(''); setCompareData({ a: null, b: null });
    API.get('abgleich', { ferienblock_id: id }).then(d => {
      setVerlauf(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  const loadComparison = async () => {
    if (!compareA || !compareB || compareA === compareB) return;
    setCompareLoading(true);
    const [resA, resB] = await Promise.all([
      API.get('abgleich', { abgleich_id: compareA }),
      API.get('abgleich', { abgleich_id: compareB })
    ]);
    setCompareData({ a: resA, b: resB });
    setCompareLoading(false);
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

  const typConfig = [
    { key: 'exact', label: '✅ Exakte Treffer', badge: 'badge-green' },
    { key: 'fuzzy_accepted', label: '🟡 Angenommene Treffer', badge: 'badge-orange' },
    { key: 'fuzzy_rejected', label: '❌ Abgelehnte Vorschläge', badge: 'badge-red' },
    { key: 'nur_in_a', label: '⚠️ Nur in Liste A', badge: 'badge-red' },
    { key: 'nur_in_b', label: '📋 Nur in Liste B', badge: 'badge-blue' },
  ];

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">history</span>
            Verlauf
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Gespeicherte Abgleiche einsehen</p>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10 mb-4 flex items-center gap-3 flex-wrap">
        <select className="flex-1 min-w-[200px] border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
          value={blockId} onChange={e => { setBlockId(e.target.value); setVerlauf([]); }}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
        </select>
        {blockId && (
          <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => loadVerlauf(blockId)}>
            <span className="material-symbols-outlined text-sm">refresh</span>Neu laden
          </button>
        )}
        {blockId && verlauf.length > 0 && (
          <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-error hover:bg-error/10 transition-colors" onClick={async () => {
            const ok = await confirmDialog('Alle Abgleiche löschen', `Alle ${verlauf.length} gespeicherten Abgleiche für diesen Block löschen?`, 'Alle löschen');
            if (!ok) return;
            const res = await API.post('abgleich', { action: 'delete_all', ferienblock_id: blockId });
            toast.success(`${res.deleted} Abgleiche gelöscht`);
            setVerlauf([]); setDetail({}); setOpenId(null);
          }}><span className="material-symbols-outlined text-sm">delete</span>Alle löschen</button>
        )}
      </div>

      {loading && <Spinner />}

      {!loading && !blockId && (
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-sm border border-outline-variant/10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">history</span>
          <p className="text-on-surface-variant">Bitte einen Ferienblock auswählen.</p>
        </div>
      )}

      {!loading && blockId && verlauf.length === 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-sm border border-outline-variant/10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">history</span>
          <p className="text-on-surface-variant">Noch keine Abgleiche für diesen Block gespeichert.</p>
        </div>
      )}

      {/* ── Vergleichsmodus ── */}
      {!loading && blockId && verlauf.length >= 2 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
            <span className="font-semibold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-primary">compare_arrows</span>
              Abgleiche vergleichen
            </span>
            <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
              onClick={() => { setCompareMode(!compareMode); setCompareData({ a: null, b: null }); setCompareA(''); setCompareB(''); }}>
              <span className="material-symbols-outlined text-sm">{compareMode ? 'close' : 'compare_arrows'}</span>
              {compareMode ? 'Schließen' : 'Vergleichen'}
            </button>
          </div>
          {compareMode && (
            <div className="p-5">
              <div className="flex gap-3 items-end flex-wrap mb-4">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Alter Abgleich (vorher)</label>
                  <select className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors text-sm"
                    value={compareA} onChange={e => { setCompareA(e.target.value); setCompareData({ a: null, b: null }); }}>
                    <option value="">– wählen –</option>
                    {verlauf.map(v => (
                      <option key={v.id} value={v.id} disabled={String(v.id) === String(compareB)}>
                        {fmtDateTime(v.erstellt_am)} — {v.matches_count || 0} Treffer, {v.nur_in_a_count || 0} fehlend
                      </option>
                    ))}
                  </select>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant pb-1">arrow_forward</span>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Neuer Abgleich (nachher)</label>
                  <select className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors text-sm"
                    value={compareB} onChange={e => { setCompareB(e.target.value); setCompareData({ a: null, b: null }); }}>
                    <option value="">– wählen –</option>
                    {verlauf.map(v => (
                      <option key={v.id} value={v.id} disabled={String(v.id) === String(compareA)}>
                        {fmtDateTime(v.erstellt_am)} — {v.matches_count || 0} Treffer, {v.nur_in_a_count || 0} fehlend
                      </option>
                    ))}
                  </select>
                </div>
                <button className="px-4 py-2 text-sm font-semibold rounded-xl bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
                  disabled={!compareA || !compareB || compareA === compareB || compareLoading}
                  onClick={loadComparison}>
                  {compareLoading ? 'Lade…' : 'Vergleichen'}
                </button>
              </div>
              {compareLoading && <Spinner />}
              {!compareLoading && compareData.a?.matches && compareData.b?.matches && (
                <VergleichView matchesOld={compareData.a.matches} matchesNew={compareData.b.matches} abgleichOld={compareData.a.abgleich} abgleichNew={compareData.b.abgleich} />
              )}
            </div>
          )}
        </div>
      )}

      {!loading && verlauf.map(v => {
        const isOpen = openId === v.id;
        const d = detail[v.id];
        const dLoading = detailLoading[v.id];
        const badgeCls = (key) => { if (key === 'exact' || key === 'fuzzy_accepted') return 'bg-green-100 text-green-700'; if (key === 'nur_in_b') return 'bg-blue-100 text-blue-700'; if (key === 'nur_in_a' || key === 'fuzzy_rejected') return 'bg-red-100 text-red-700'; return 'bg-gray-100 text-gray-600'; };
        return (
          <div key={v.id} className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-3 overflow-hidden">
            <div className="flex justify-between items-center p-5 flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-on-surface">Abgleich vom {fmtDateTime(v.erstellt_am)}</span>
                  <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{v.status}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{v.matches_count} Treffer</span>
                  {parseInt(v.nur_in_a_count) > 0 && <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{v.nur_in_a_count} nur in A</span>}
                  {parseInt(v.nur_in_b_count) > 0 && <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{v.nur_in_b_count} nur in B</span>}
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => toggleDetail(v.id)}>
                  <span className="material-symbols-outlined text-sm">{isOpen ? 'expand_less' : 'expand_more'}</span>
                  {isOpen ? 'Zuklappen' : 'Details'}
                </button>
                <button className="w-8 h-8 rounded-lg text-error hover:bg-error/10 transition-colors flex items-center justify-center" title="Abgleich löschen"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirmDialog('Abgleich löschen', `Abgleich vom ${fmtDateTime(v.erstellt_am)} löschen?`, 'Löschen');
                    if (!ok) return;
                    await API.post('abgleich', { action: 'delete', id: v.id });
                    toast.success('Abgleich gelöscht');
                    loadVerlauf(blockId);
                  }}>
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-outline-variant/10 p-5">
                {dLoading && <Spinner />}
                {d && typConfig.map(({ key, label }) => {
                  const items = d.matches?.filter(m => m.match_typ === key) || [];
                  if (!items.length) return null;
                  return (
                    <div key={key} className="mb-5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm text-on-surface">{label}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCls(key)}`}>{items.length}</span>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-surface-container/50">
                            <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Name A</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Datum A</th>
                            {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Name B</th>}
                            {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Datum B</th>}
                            {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Score</th>}
                            {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Grund</th>}
                          </tr></thead>
                          <tbody className="divide-y divide-outline-variant/10">
                            {items.map(m => (
                              <tr key={m.id} className="hover:bg-surface-container/30">
                                <td className="px-3 py-2 text-on-surface">{m.a_vorname} {m.a_nachname}</td>
                                <td className="px-3 py-2 text-on-surface-variant">{fmtDate(m.a_datum)}</td>
                                {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td className="px-3 py-2 text-on-surface">{m.b_vorname} {m.b_nachname}</td>}
                                {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td className="px-3 py-2 text-on-surface-variant">{fmtDate(m.b_datum)}</td>}
                                {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td className="px-3 py-2"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${m.score >= 90 ? 'bg-green-100 text-green-700' : m.score >= 75 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{m.score}%</span></td>}
                                {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td className="px-3 py-2 text-xs text-on-surface-variant">{m.grund}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default VerlaufPage;
