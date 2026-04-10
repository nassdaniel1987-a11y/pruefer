import React, { useState, useEffect, useMemo } from 'react';
import { API } from '../utils/api';
import { fmtDate } from '../utils/helpers';
import { TagesansichtSkeleton } from './Skeleton';

// ─── TAGESANSICHT ─────────────────────────────────────
const TagesansichtPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [abgleichMatches, setAbgleichMatches] = useState([]);
  const [hasAbgleich, setHasAbgleich] = useState(false);
  const [letzterAbgleich, setLetzterAbgleich] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [sortCol, setSortCol] = useState('nachname');
  const [sortDir, setSortDir] = useState('asc');

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
    // Letzten Abgleich laden wenn vorhanden
    const abgleiche = Array.isArray(abl) ? abl : abl?.abgleiche || [];
    if (abgleiche.length > 0) {
      const letzter = abgleiche[0]; // neuester (API liefert DESC sortiert)
      const detail = await API.get('abgleich', { abgleich_id: letzter.id });
      setAbgleichMatches(Array.isArray(detail?.matches) ? detail.matches : []);
      setHasAbgleich(true);
      setLetzterAbgleich(letzter);
    } else {
      setAbgleichMatches([]);
      setHasAbgleich(false);
      setLetzterAbgleich(null);
    }
    setSelectedDate(null);
    setLoading(false);
  };

  useEffect(() => { if (blockId) load(blockId); }, [blockId]);

  // Matchings aus Abgleich-Ergebnissen aufbereiten
  const { matchedAIds, matchedBIds, bToAMap } = useMemo(() => {
    const aIds = new Set();
    const bIds = new Set();
    const b2a = new Map(); // B-entry-ID → A-entry-ID
    abgleichMatches.forEach(m => {
      if ((m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted') && m.liste_a_id && m.liste_b_id) {
        aIds.add(m.liste_a_id);
        bIds.add(m.liste_b_id);
        b2a.set(m.liste_b_id, m.liste_a_id);
      }
    });
    return { matchedAIds: aIds, matchedBIds: bIds, bToAMap: b2a };
  }, [abgleichMatches]);

  // Alle Tage sammeln
  const allDates = useMemo(() => {
    const dates = new Set();
    listA.forEach(e => dates.add(String(e.datum).split('T')[0]));
    listB.forEach(e => dates.add(String(e.datum).split('T')[0]));
    return [...dates].sort();
  }, [listA, listB]);

  // Tagesübersicht berechnen — nutzt Abgleich-Ergebnisse wenn vorhanden
  const dayStats = useMemo(() => {
    return allDates.map(d => {
      const aDay = listA.filter(e => String(e.datum).split('T')[0] === d);
      const bDay = listB.filter(e => String(e.datum).split('T')[0] === d);
      const aKids = new Set(aDay.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
      const bKids = new Set(bDay.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));

      if (hasAbgleich) {
        // Nutze echte Abgleich-Ergebnisse
        const aMatched = aDay.filter(e => matchedAIds.has(e.id));
        const aMissing = aDay.filter(e => !matchedAIds.has(e.id));
        const bOnly = bDay.filter(e => !matchedBIds.has(e.id));
        // Unique Kinder zählen
        const matchedKids = new Set(aMatched.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        const missingKids = new Set(aMissing.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        const onlyBKids = new Set(bOnly.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        return { date: d, angemeldet: aKids.size, gebucht: bKids.size, matched: matchedKids.size, missingInB: missingKids.size, onlyInB: onlyBKids.size };
      } else {
        // Kein Abgleich vorhanden — nur Zählen, kein Matching
        return { date: d, angemeldet: aKids.size, gebucht: bKids.size, matched: null, missingInB: null, onlyInB: null };
      }
    });
  }, [allDates, listA, listB, hasAbgleich, matchedAIds, matchedBIds]);

  // Detail für gewählten Tag — nutzt Abgleich-Ergebnisse
  const dayDetail = useMemo(() => {
    if (!selectedDate) return null;
    const d = selectedDate;
    const aEntries = listA.filter(e => String(e.datum).split('T')[0] === d);
    const bEntries = listB.filter(e => String(e.datum).split('T')[0] === d);

    if (hasAbgleich) {
      // Mit Abgleich: Nutze echte Match-Ergebnisse
      // Schritt 1: Alle A-Kinder einfügen, nach DB-ID indexiert
      const kinderById = {}; // a_entry_id → kind-Objekt
      const kinder = {};     // name-key → kind-Objekt (für Deduplizierung gleicher A-Namen)
      aEntries.forEach(e => {
        const key = (e.nachname + '|' + e.vorname).toLowerCase();
        if (!kinder[key]) {
          const kind = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: true, inB: matchedAIds.has(e.id) };
          kinder[key] = kind;
          kinderById[e.id] = kind;
        } else {
          kinderById[e.id] = kinder[key];
          if (matchedAIds.has(e.id)) kinder[key].inB = true;
        }
      });

      // Schritt 2: B-Kinder verarbeiten
      bEntries.forEach(e => {
        if (matchedBIds.has(e.id)) {
          // Gematcht → dem zugehörigen A-Kind zuordnen (nicht als separaten Eintrag!)
          const aId = bToAMap.get(e.id);
          if (aId && kinderById[aId]) {
            kinderById[aId].inB = true;
          }
          // Falls Klasse in B vorhanden aber nicht in A, übernehmen
          if (aId && kinderById[aId] && !kinderById[aId].klasse && e.klasse) {
            kinderById[aId].klasse = e.klasse;
          }
        } else {
          // Nicht gematcht → als "Nur in B" hinzufügen
          const key = (e.nachname + '|' + e.vorname).toLowerCase();
          if (!kinder[key]) {
            kinder[key] = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: false, inB: true };
          }
        }
      });
      return Object.values(kinder);
    } else {
      // Ohne Abgleich: Zeige einfach alle Kinder mit ihrer Listenzugehörigkeit
      const kinder = {};
      aEntries.forEach(e => {
        const key = (e.nachname + '|' + e.vorname).toLowerCase();
        if (!kinder[key]) kinder[key] = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: true, inB: false };
      });
      bEntries.forEach(e => {
        const key = (e.nachname + '|' + e.vorname).toLowerCase();
        if (kinder[key]) { kinder[key].inB = true; }
        else kinder[key] = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: false, inB: true };
      });
      return Object.values(kinder);
    }
  }, [selectedDate, listA, listB, hasAbgleich, matchedAIds, matchedBIds, bToAMap]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortedDetail = useMemo(() => {
    if (!dayDetail) return [];
    return [...dayDetail].sort((a, b) => {
      let va, vb;
      if (sortCol === 'status') { va = a.inA && a.inB ? 2 : a.inA ? 1 : 0; vb = b.inA && b.inB ? 2 : b.inA ? 1 : 0; }
      else { va = (a[sortCol] || '').toLowerCase(); vb = (b[sortCol] || '').toLowerCase(); }
      const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb, 'de');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [dayDetail, sortCol, sortDir]);

  const sIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const block = blocks.find(b => String(b.id) === String(blockId));
  const weekday = (d) => { try { return new Date(d).toLocaleDateString('de-DE', { weekday: 'short' }); } catch { return ''; } };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Tagesansicht</h2>
        </div>
        <div className="flex items-center bg-surface-container-lowest px-4 py-1.5 rounded-xl border border-outline-variant/20 gap-4">
          <select className="bg-transparent text-sm border-none focus:ring-0 outline-none font-bold text-on-surface py-2" value={blockId} onChange={e => setBlockId(e.target.value)}>
            <option value="">– Block wählen –</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {loading && <TagesansichtSkeleton />}

      {!loading && hasAbgleich && letzterAbgleich?.veraltet && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/40 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <span className="material-symbols-outlined text-base">sync_problem</span>
          <span>Abgleich veraltet — Liste A wurde manuell geändert. Bitte neuen Abgleich durchführen.</span>
        </div>
      )}
      
      {!loading && dayStats.length === 0 && blockId && (
        <div className="bg-surface-container-lowest rounded-2xl p-12 shadow-sm border border-outline-variant/30 text-center">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/40 mb-3">event_busy</span>
          <p className="text-lg font-bold text-on-surface">Keine Daten für diesen Block vorhanden.</p>
        </div>
      )}

      {!loading && dayStats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4 space-y-4">
            <h3 className="text-lg font-extrabold text-primary tracking-tight mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined">calendar_month</span>
              Tage im Überblick
            </h3>
            
            <div className="relative space-y-4 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-outline-variant/20 before:to-transparent">
              {dayStats.map(d => {
                const isActive = selectedDate === d.date;
                return (
                  <div key={d.date} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group select-none cursor-pointer" onClick={() => setSelectedDate(isActive ? null : d.date)}>
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm transition-colors ${isActive ? 'bg-primary border-primary-container z-10' : 'bg-surface-container-lowest border-surface-container group-hover:border-primary-fixed z-10'}`}>
                      <span className={`text-xs font-bold ${isActive ? 'text-white' : 'text-on-surface-variant group-hover:text-primary'}`}>{weekday(d.date).substring(0,2)}</span>
                    </div>
                    
                    <div className={`w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface-container-lowest p-4 rounded-xl shadow-sm border transition-all ${isActive ? 'border-primary border-l-4 shadow-md scale-[1.02]' : 'border-outline-variant/30 hover:border-primary/50'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-bold text-on-surface">{fmtDate(d.date)}</span>
                        <div className="flex gap-1">
                          {hasAbgleich && d.missingInB > 0 && <span className="w-2 h-2 rounded-full bg-error" title="Kein Essen gebucht"></span>}
                          {hasAbgleich && d.onlyInB > 0 && <span className="w-2 h-2 rounded-full bg-amber-400" title="Essen gebucht — nicht angemeldet"></span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>{d.angemeldet} A</span>
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>{d.gebucht} B</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="sticky top-24">
              {selectedDate && dayDetail ? (
                <div className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-primary-container rounded-xl text-white shadow-sm">
                      <span className="material-symbols-outlined text-2xl">group</span>
                    </div>
                    <div>
                      <h3 className="text-2xl font-extrabold text-on-surface">{weekday(selectedDate)}, {fmtDate(selectedDate)}</h3>
                      <p className="text-sm text-on-surface-variant font-medium">{dayDetail.length} Kinder an diesem Tag verzeichnet</p>
                    </div>
                  </div>

                  {hasAbgleich && dayDetail.filter(k => !k.inA && k.inB).length > 0 && (
                    <div className="mb-6 rounded-xl border-2 border-amber-400/60 bg-amber-400/10 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-amber-500 text-lg">warning</span>
                        <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                          {dayDetail.filter(k => !k.inA && k.inB).length} {dayDetail.filter(k => !k.inA && k.inB).length === 1 ? 'Kind' : 'Kinder'} — Essen gebucht, aber nicht angemeldet
                        </span>
                      </div>
                      <ul className="space-y-0.5 pl-6">
                        {dayDetail.filter(k => !k.inA && k.inB).map((k, i) => (
                          <li key={i} className="text-sm text-amber-800 dark:text-amber-300 font-medium">
                            {k.nachname} {k.vorname}{k.klasse ? <span className="text-xs text-amber-600 dark:text-amber-400 ml-1">Kl. {k.klasse}</span> : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {hasAbgleich && (
                    <div className="grid grid-cols-3 gap-4 mb-8">
                      <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">OK (Abgleich)</p>
                        <div className="flex items-end gap-1"><span className="text-2xl font-black text-emerald-500">{dayDetail.filter(k => k.inA && k.inB).length}</span><span className="text-xs font-medium text-on-surface-variant/40 mb-1">Kind.</span></div>
                      </div>
                      <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
                        <p className="text-[10px] font-bold text-error uppercase tracking-wider mb-1">Kein Essen gebucht</p>
                        <div className="flex items-end gap-1"><span className="text-2xl font-black text-error">{dayDetail.filter(k => k.inA && !k.inB).length}</span><span className="text-xs font-medium text-on-surface-variant/40 mb-1">Kind.</span></div>
                      </div>
                      <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
                        <p className="text-[10px] font-bold text-tertiary uppercase tracking-wider mb-1">Nicht angemeldet</p>
                        <div className="flex items-end gap-1"><span className="text-2xl font-black text-tertiary">{dayDetail.filter(k => !k.inA && k.inB).length}</span><span className="text-xs font-medium text-on-surface-variant/40 mb-1">Kind.</span></div>
                      </div>
                    </div>
                  )}

                  <h4 className="text-xs font-bold text-primary uppercase tracking-widest border-b border-outline-variant/30 pb-2 mb-4">Besonderheiten & Zuordnungen</h4>
                  <div className="overflow-x-auto rounded-xl border border-outline-variant/30 w-full">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low border-b border-outline-variant/30">
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline cursor-pointer" onClick={() => toggleSort('nachname')}>Nachname{sIcon('nachname')}</th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline cursor-pointer" onClick={() => toggleSort('vorname')}>Vorname{sIcon('vorname')}</th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline cursor-pointer" onClick={() => toggleSort('klasse')}>Klasse{sIcon('klasse')}</th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline text-center cursor-pointer" onClick={() => toggleSort('status')}>Status{sIcon('status')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/25">
                        {sortedDetail.map((k, i) => (
                           <tr key={i} className={`hover:bg-surface-container transition-colors group ${hasAbgleich && k.inA && !k.inB ? 'bg-error-container/20' : hasAbgleich && !k.inA && k.inB ? 'bg-tertiary-container/10' : ''}`}>
                             <td className="px-4 py-3 text-sm font-bold text-on-surface">{k.nachname}</td>
                             <td className="px-4 py-3 text-sm font-medium text-on-surface-variant">{k.vorname}</td>
                             <td className="px-4 py-3 text-sm font-medium text-on-surface-variant">
                               {k.klasse ? <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-outline font-bold">Kl. {k.klasse}</span> : <span className="opacity-50">–</span>}
                             </td>
                             <td className="px-4 py-3 text-center">
                               {hasAbgleich ? (
                                 <div className="flex justify-center flex-wrap gap-1">
                                   {k.inA && k.inB && <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5"><span className="material-symbols-outlined text-[10px]">check</span>OK</span>}
                                   {k.inA && !k.inB && <span className="bg-error font-bold text-on-error text-[10px] px-2 py-0.5 rounded-full">Kein Essen</span>}
                                   {!k.inA && k.inB && <span className="bg-tertiary font-bold text-on-tertiary text-[10px] px-2 py-0.5 rounded-full">Nicht angem.</span>}
                                 </div>
                               ) : (
                                  <div className="flex gap-1 justify-center">
                                    {k.inA && <span className="font-bold text-on-primary-fixed-variant bg-primary-fixed text-[10px] px-2 py-0.5 rounded-md">Liste A</span>}
                                    {k.inB && <span className="font-bold text-emerald-500 bg-emerald-500/10 text-[10px] px-2 py-0.5 rounded-md">Liste B</span>}
                                  </div>
                               )}
                             </td>
                           </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[400px] border-2 border-dashed border-outline-variant/30 rounded-2xl flex flex-col items-center justify-center p-12 text-center bg-surface-container-lowest/50">
                  <div className="w-20 h-20 bg-surface-container-high rounded-full flex items-center justify-center mb-4">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/50">ads_click</span>
                  </div>
                  <p className="text-xl font-extrabold text-on-surface mb-2">Tag auswählen</p>
                  <p className="text-sm text-on-surface-variant max-w-xs">Wähle links einen Tag aus der Zeitachse, um die Details zu Mittagessen, Anwesenheit und Fehlzeiten anzuzeigen.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

};

export default TagesansichtPage;