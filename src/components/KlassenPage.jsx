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
    <div className="pb-20 space-y-8 max-w-6xl mx-auto">
      <div>
        <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Verwaltung</span>
        <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Klassen & Einteilung</h2>
        <p className="text-sm text-on-surface-variant mt-1">Übersicht aller Klassen, Hortgruppen und unzugeordneten Kinder.</p>
      </div>

      <div className="flex items-center gap-3">
        <select className="bg-surface-container-lowest text-sm border border-outline-variant/20 rounded-xl focus:ring-2 focus:ring-primary outline-none px-4 py-2.5 font-bold text-on-surface shadow-sm cursor-pointer" value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">Block wählen</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {blockId && !loading && (
          <button className="px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl shadow-sm hover:opacity-90 transition-opacity flex items-center gap-2" onClick={handleGenerateKlassen}>
            <span className="material-symbols-outlined text-[18px]">build</span> Klassen aus Block generieren
          </button>
        )}
      </div>

      {loading && <div className="py-12 flex justify-center"><Spinner /></div>}

      {!loading && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Klassen gesamt</div>
            <div className="text-2xl font-extrabold text-primary">{stats.totalKlassen}</div>
          </div>
          <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Kinder in Klassen</div>
            <div className="text-2xl font-extrabold text-emerald-600">{stats.kinderZugeordnet}</div>
          </div>
          <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Keine Klasse (Leer)</div>
            <div className={`text-2xl font-extrabold ${stats.kinderOhne > 0 ? 'text-amber-500' : 'text-on-surface-variant/40'}`}>{stats.kinderOhne}</div>
          </div>
          <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1">Invalide (z.B. Test)</div>
            <div className={`text-2xl font-extrabold ${stats.invalidKlassen > 0 ? 'text-error' : 'text-on-surface-variant/40'}`}>{stats.invalidKlassen}</div>
          </div>
        </div>
      )}

      {!loading && !blockId && (
        <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>grid_view</span>
          <p className="text-xl font-bold text-on-surface mb-2">Block für Klassenauswertung wählen</p>
          <p className="text-sm text-on-surface-variant/80 max-w-sm">Bitte wähle oben einen Ferienblock, um die Klassenzuteilung der dort registrierten Kinder zu analysieren.</p>
        </div>
      )}

      {!loading && blockId && klassen.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {klassen.map(kl => {
            const isEmpty = !kl.name || kl.name.trim() === '';
            const isInvalid = !isEmpty && kl.name.toLowerCase().includes('abgemeldet') || kl.name.toLowerCase().includes('test');
            // Card Styles
            let cardClasses = 'bg-surface-container-lowest border-outline-variant/10';
            let headerClasses = 'bg-primary-container text-white';
            if (isEmpty) {
               cardClasses = 'bg-amber-50 border-amber-200';
               headerClasses = 'bg-amber-500 text-white';
            } else if (isInvalid) {
               cardClasses = 'bg-error-container/20 border-error-container/50';
               headerClasses = 'bg-error text-white';
            }

            return (
              <div key={kl.name || 'unbekannt'} className={`rounded-2xl shadow-sm border overflow-hidden flex flex-col ${cardClasses}`}>
                <div className={`px-5 py-3 ${headerClasses} flex justify-between items-center`}>
                  <h3 className="font-bold text-lg">{isEmpty ? 'Keine Klasse angegeben' : kl.name}</h3>
                  <span className="bg-white/20 text-white px-2 py-0.5 rounded text-xs font-bold">{kl.kinder.length} Kinder</span>
                </div>
                <div className="p-4 flex-1">
                  <div className="overflow-y-auto max-h-[300px] pr-2 space-y-2">
                    {kl.kinder.map(k => (
                      <div key={k.id} className="flex border-b border-outline-variant/5 pb-2 last:border-0 rounded-lg p-2 hover:bg-black/5 items-center gap-3 transition-colors">
                        <Avatar vorname={k.vorname} nachname={k.nachname} size="sm" />
                        <span className="text-sm font-medium text-on-surface">{k.vorname} {k.nachname}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

};

export default KlassenPage;
