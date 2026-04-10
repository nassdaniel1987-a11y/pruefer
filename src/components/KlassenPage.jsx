import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { fmtDate } from '../utils/helpers';
import Spinner from './Spinner';

// ─── KLASSEN-ZUSAMMENFASSUNG ──────────────────────────
const KlassenPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [abgleichMatches, setAbgleichMatches] = useState([]);
  const [hasAbgleich, setHasAbgleich] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (id) => {
    if (!id) return;
    setLoading(true);
    const [a, b, abl] = await Promise.all([
      API.get('listen', { ferienblock_id: id, liste: 'A' }),
      API.get('listen', { ferienblock_id: id, liste: 'B' }),
      API.get('abgleich', { ferienblock_id: id })
    ]);
    setListA(Array.isArray(a) ? a : []);
    setListB(Array.isArray(b) ? b : []);
    const abgleiche = Array.isArray(abl) ? abl : abl?.abgleiche || [];
    if (abgleiche.length > 0) {
      const letzter = abgleiche[0];
      const detail = await API.get('abgleich', { abgleich_id: letzter.id });
      setAbgleichMatches(Array.isArray(detail?.matches) ? detail.matches : []);
      setHasAbgleich(true);
    } else {
      setAbgleichMatches([]);
      setHasAbgleich(false);
    }
    setLoading(false);
  };

  useEffect(() => { if (blockId) load(blockId); }, [blockId]);

  // Gematchte IDs aus Abgleich
  const { matchedAIds, matchedBIds } = useMemo(() => {
    const aIds = new Set(), bIds = new Set();
    abgleichMatches.forEach(m => {
      if ((m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted') && m.liste_a_id && m.liste_b_id) {
        aIds.add(m.liste_a_id);
        bIds.add(m.liste_b_id);
      }
    });
    return { matchedAIds: aIds, matchedBIds: bIds };
  }, [abgleichMatches]);

  const klassenData = useMemo(() => {
    const map = {};
    const normKlasse = (k) => (k || 'Ohne Klasse').trim() || 'Ohne Klasse';

    listA.forEach(e => {
      const key = (e.nachname + '|' + e.vorname).toLowerCase();
      const klasse = normKlasse(e.klasse);
      if (!map[klasse]) map[klasse] = { klasse, kinderA: new Set(), kinderB: new Set(), tageA: 0, tageB: 0, matchedA: new Set() };
      map[klasse].kinderA.add(key);
      map[klasse].tageA++;
      if (hasAbgleich && matchedAIds.has(e.id)) map[klasse].matchedA.add(key);
    });
    listB.forEach(e => {
      const klasse = normKlasse(e.klasse);
      const key = (e.nachname + '|' + e.vorname).toLowerCase();
      if (!map[klasse]) map[klasse] = { klasse, kinderA: new Set(), kinderB: new Set(), tageA: 0, tageB: 0, matchedA: new Set() };
      map[klasse].kinderB.add(key);
      map[klasse].tageB++;
    });

    return Object.values(map).map(k => {
      let ohneB, nurInB;
      if (hasAbgleich) {
        ohneB = k.kinderA.size - k.matchedA.size;
        const matchedBKeys = new Set();
        listB.forEach(e => {
          if (matchedBIds.has(e.id) && normKlasse(e.klasse) === k.klasse) {
            matchedBKeys.add((e.nachname + '|' + e.vorname).toLowerCase());
          }
        });
        nurInB = [...k.kinderB].filter(x => !matchedBKeys.has(x)).length;
      } else {
        ohneB = [...k.kinderA].filter(x => !k.kinderB.has(x)).length;
        nurInB = [...k.kinderB].filter(x => !k.kinderA.has(x)).length;
      }
      return {
        klasse: k.klasse,
        kinderA: k.kinderA.size,
        kinderB: k.kinderB.size,
        tageA: k.tageA,
        tageB: k.tageB,
        ohneB,
        nurInB,
      };
    }).sort((a, b) => a.klasse.localeCompare(b.klasse, 'de'));
  }, [listA, listB, hasAbgleich, matchedAIds, matchedBIds]);

  const block = blocks.find(b => String(b.id) === String(blockId));
  const preis = block ? parseFloat(block.preis_pro_tag) : 3.5;

  // Stats computed from klassenData
  const totalKlassen = klassenData.length;
  const totalKinderA = klassenData.reduce((s, k) => s + k.kinderA, 0);
  const totalOhneB = klassenData.reduce((s, k) => s + k.ohneB, 0);

  const exportKlassen = () => {
    if (!klassenData.length) return;
    const wb = XLSX.utils.book_new();
    const rows = klassenData.map(k => ({
      Klasse: k.klasse,
      'Kinder A': k.kinderA,
      'Kinder B': k.kinderB,
      'Tage A': k.tageA,
      'Tage B': k.tageB,
      'Ohne B': k.ohneB,
      'Nur B': k.nurInB,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Klassen');
    XLSX.writeFile(wb, `Klassen_${block?.name || 'export'}.xlsx`);
    toast.success('Klassen exportiert');
  };

  return (
    <div className="pb-20 space-y-6">
      <div>
        <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Verwaltung</span>
        <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Klassen & Einteilung</h2>
        <p className="text-sm text-on-surface-variant mt-1">Übersicht aller Klassen und der Verteilung auf Listen A/B.</p>
      </div>

      <div className="flex items-center gap-3">
        <select className="bg-surface-container-lowest text-sm border border-outline-variant/20 rounded-xl focus:ring-2 focus:ring-primary outline-none px-4 py-2.5 font-bold text-on-surface shadow-sm cursor-pointer" value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">Block wählen</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {blockId && !loading && klassenData.length > 0 && (
          <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-xl text-on-surface-variant hover:bg-surface-container-low border border-outline-variant/20 transition-colors" onClick={exportKlassen}>
            <span className="material-symbols-outlined text-base">download</span>Excel
          </button>
        )}
      </div>

      {loading && <div className="py-12 flex justify-center"><Spinner /></div>}

      {!loading && blockId && klassenData.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
              <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Klassen gesamt</div>
              <div className="text-2xl font-extrabold text-primary">{totalKlassen}</div>
            </div>
            <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
              <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Kinder (Liste A)</div>
              <div className="text-2xl font-extrabold text-emerald-600">{totalKinderA}</div>
            </div>
            <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
              <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Kein Essen gebucht</div>
              <div className={`text-2xl font-extrabold ${totalOhneB > 0 ? 'text-error' : 'text-on-surface-variant/40'}`}>{totalOhneB}</div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">school</span>
              <span className="font-bold text-on-surface text-sm">Klassenverteilung</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-surface-container-low">
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Klasse</th>
                  <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Kinder A</th>
                  <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Kinder B</th>
                  <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Tage A</th>
                  <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Tage B</th>
                  <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Kein Essen</th>
                  <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Nicht angem.</th>
                </tr></thead>
                <tbody className="divide-y divide-outline-variant/5">
                  {klassenData.map(k => (
                    <tr key={k.klasse} className={`hover:bg-surface-container-low/50 transition-colors ${k.ohneB > 0 ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 font-bold text-on-surface">{k.klasse}</td>
                      <td className="px-4 py-3 text-center text-on-surface">{k.kinderA}</td>
                      <td className="px-4 py-3 text-center text-on-surface-variant">{k.kinderB}</td>
                      <td className="px-4 py-3 text-center text-on-surface-variant">{k.tageA}</td>
                      <td className="px-4 py-3 text-center text-on-surface-variant">{k.tageB}</td>
                      <td className="px-4 py-3 text-center">
                        {k.ohneB > 0
                          ? <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full">{k.ohneB}</span>
                          : <span className="text-on-surface-variant/40">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {k.nurInB > 0
                          ? <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{k.nurInB}</span>
                          : <span className="text-on-surface-variant/40">0</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && blockId && klassenData.length === 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30 mb-3">school</span>
          <p className="text-lg font-bold text-on-surface">Keine Klassendaten</p>
          <p className="text-sm text-on-surface-variant mt-1">Lade zuerst Listen im Abgleich-Tool hoch.</p>
        </div>
      )}

      {!loading && !blockId && (
        <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4">grid_view</span>
          <p className="text-xl font-bold text-on-surface mb-2">Block für Klassenauswertung wählen</p>
          <p className="text-sm text-on-surface-variant/80 max-w-sm">Bitte wähle oben einen Ferienblock, um die Klassenzuteilung zu analysieren.</p>
        </div>
      )}
    </div>
  );
};

export default KlassenPage;
