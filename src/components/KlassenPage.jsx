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
      const letzter = abgleiche[0]; // neuester (API liefert DESC sortiert)
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

    // Kinder aus A sammeln
    listA.forEach(e => {
      const key = (e.nachname + '|' + e.vorname).toLowerCase();
      const klasse = normKlasse(e.klasse);
      if (!map[klasse]) map[klasse] = { klasse, kinderA: new Set(), kinderB: new Set(), tageA: 0, tageB: 0, matchedA: new Set() };
      map[klasse].kinderA.add(key);
      map[klasse].tageA++;
      if (hasAbgleich && matchedAIds.has(e.id)) map[klasse].matchedA.add(key);
    });
    // Kinder aus B: nur Tage und unique Kinder zählen
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
        // Mit Abgleich: Kinder ohne Match = nicht gematcht
        ohneB = k.kinderA.size - k.matchedA.size;
        // Nur in B: B-Kinder die nicht gematcht sind
        const matchedBKeys = new Set();
        listB.forEach(e => {
          if (matchedBIds.has(e.id) && normKlasse(e.klasse) === k.klasse) {
            matchedBKeys.add((e.nachname + '|' + e.vorname).toLowerCase());
          }
        });
        nurInB = [...k.kinderB].filter(x => !matchedBKeys.has(x)).length;
      } else {
        // Ohne Abgleich: einfacher Namensvergleich (Schätzung)
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

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">school</span>
            Klassen-Übersicht
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Statistiken gruppiert nach Schulklasse</p>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10 mb-4 flex items-center gap-3 flex-wrap">
        <select className="flex-1 min-w-[200px] border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
          value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
        </select>
        {klassenData.length > 0 && (
          <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => {
            const wb = XLSX.utils.book_new();
            const rows = klassenData.map(k => ({
              Klasse: k.klasse, 'Kinder (A)': k.kinderA, 'Kinder (B)': k.kinderB,
              'Tage (A)': k.tageA, 'Tage (B)': k.tageB, 'Fehlt in B': k.ohneB, 'Nur in B': k.nurInB,
              'Kosten (€)': (k.tageB * preis).toFixed(2)
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Klassen');
            XLSX.writeFile(wb, `Klassen_${block?.name || 'Export'}.xlsx`);
            toast.success('Klassen-Übersicht exportiert');
          }}>
            <span className="material-symbols-outlined text-sm">download</span>Excel exportieren
          </button>
        )}
      </div>

      {loading && <Spinner />}

      {!loading && blockId && klassenData.length === 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-sm border border-outline-variant/10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">school</span>
          <p className="text-on-surface-variant">Keine Daten für diesen Block vorhanden.</p>
        </div>
      )}

      {!loading && klassenData.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
          {!hasAbgleich && <p className="text-xs text-on-surface-variant italic px-5 pt-4">
            Hinweis: Ohne Abgleich basieren "Fehlt in B" und "Nur in B" auf einfachem Namensvergleich (ungenau bei unterschiedlicher Schreibweise).
          </p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-surface-container/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase">Klasse</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase">Kinder (A)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase">Kinder (B)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase">Tage (A)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase">Tage (B)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase" title="Kinder aus A ohne Entsprechung in B">Fehlt in B</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase" title="Kinder nur in B">Nur in B</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase">Kosten</th>
              </tr></thead>
              <tbody className="divide-y divide-outline-variant/10">
                {klassenData.map(k => (
                  <tr key={k.klasse} className="hover:bg-surface-container/30">
                    <td className="px-4 py-2 font-semibold text-on-surface">{k.klasse}</td>
                    <td className="px-4 py-2"><span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.kinderA}</span></td>
                    <td className="px-4 py-2"><span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.kinderB}</span></td>
                    <td className="px-4 py-2 text-on-surface-variant">{k.tageA}</td>
                    <td className="px-4 py-2 text-on-surface-variant">{k.tageB}</td>
                    <td className="px-4 py-2">{k.ohneB > 0 ? <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.ohneB}</span> : <span className="text-on-surface-variant">0</span>}</td>
                    <td className="px-4 py-2">{k.nurInB > 0 ? <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.nurInB}</span> : <span className="text-on-surface-variant">0</span>}</td>
                    <td className="px-4 py-2 font-semibold text-on-surface">{(k.tageB * preis).toFixed(2)} €</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-outline-variant/30 font-semibold bg-surface-container/30">
                  <td className="px-4 py-2 text-on-surface">Gesamt</td>
                  <td className="px-4 py-2 text-on-surface">{klassenData.reduce((s, k) => s + k.kinderA, 0)}</td>
                  <td className="px-4 py-2 text-on-surface">{klassenData.reduce((s, k) => s + k.kinderB, 0)}</td>
                  <td className="px-4 py-2 text-on-surface">{klassenData.reduce((s, k) => s + k.tageA, 0)}</td>
                  <td className="px-4 py-2 text-on-surface">{klassenData.reduce((s, k) => s + k.tageB, 0)}</td>
                  <td className="px-4 py-2 text-error">{klassenData.reduce((s, k) => s + k.ohneB, 0)}</td>
                  <td className="px-4 py-2 text-amber-700">{klassenData.reduce((s, k) => s + k.nurInB, 0)}</td>
                  <td className="px-4 py-2 text-on-surface">{(klassenData.reduce((s, k) => s + k.tageB, 0) * preis).toFixed(2)} €</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default KlassenPage;
