import React, { useState, useEffect, useMemo } from 'react';
import { API } from '../utils/api';
import { fmtDate } from '../utils/helpers';
import Spinner from './Spinner';

// ─── TAGESANSICHT ─────────────────────────────────────
const TagesansichtPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [abgleichMatches, setAbgleichMatches] = useState([]);
  const [hasAbgleich, setHasAbgleich] = useState(false);
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
    } else {
      setAbgleichMatches([]);
      setHasAbgleich(false);
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
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">calendar_view_day</span>
            Tagesansicht
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Welche Kinder sind pro Tag angemeldet und gebucht?</p>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10 mb-4">
        <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Ferienblock</label>
        <select className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
          value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
        </select>
      </div>

      {loading && <Spinner />}

      {!loading && blockId && dayStats.length === 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-sm border border-outline-variant/10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">event_busy</span>
          <p className="text-on-surface-variant">Keine Daten für diesen Block vorhanden.</p>
        </div>
      )}

      {!loading && dayStats.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-4 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10 flex-wrap">
            <span className="font-semibold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-primary">date_range</span>
              Tage im Überblick
            </span>
            {!hasAbgleich && <span className="text-xs text-on-surface-variant">– Führe zuerst einen Abgleich durch für OK/Fehlt/Nur-in-B Spalten</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-surface-container/50">
                <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Tag</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Datum</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Angemeldet (A)</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Gebucht (B)</th>
                {hasAbgleich && <><th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">OK</th><th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Fehlt in B</th><th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Nur in B</th></>}
                <th className="px-4 py-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-outline-variant/10">
                {dayStats.map(d => (
                  <tr key={d.date} className={`cursor-pointer hover:bg-surface-container/30 transition-colors ${selectedDate === d.date ? 'bg-primary/5' : ''}`}
                    onClick={() => setSelectedDate(selectedDate === d.date ? null : d.date)}>
                    <td className="px-4 py-2 font-semibold text-on-surface">{weekday(d.date)}</td>
                    <td className="px-4 py-2 text-on-surface">{fmtDate(d.date)}</td>
                    <td className="px-4 py-2"><span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.angemeldet}</span></td>
                    <td className="px-4 py-2"><span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.gebucht}</span></td>
                    {hasAbgleich && <>
                      <td className="px-4 py-2"><span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.matched}</span></td>
                      <td className="px-4 py-2">{d.missingInB > 0 ? <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.missingInB}</span> : <span className="text-on-surface-variant">0</span>}</td>
                      <td className="px-4 py-2">{d.onlyInB > 0 ? <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.onlyInB}</span> : <span className="text-on-surface-variant">0</span>}</td>
                    </>}
                    <td className="px-4 py-2 text-primary">
                      <span className="material-symbols-outlined text-sm">{selectedDate === d.date ? 'expand_less' : 'expand_more'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedDate && dayDetail && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10">
            <span className="material-symbols-outlined text-base text-primary">today</span>
            <span className="font-semibold text-on-surface">{weekday(selectedDate)} {fmtDate(selectedDate)} — {dayDetail.length} Kinder</span>
          </div>
          {hasAbgleich && (
            <div className="grid grid-cols-3 gap-3 p-5 pb-0">
              <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                <div className="text-xs text-on-surface-variant mb-1">Angemeldet + Gebucht</div>
                <div className="text-2xl font-bold text-green-700">{dayDetail.filter(k => k.inA && k.inB).length}</div>
              </div>
              <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                <div className="text-xs text-on-surface-variant mb-1">Angemeldet, nicht gebucht</div>
                <div className={`text-2xl font-bold ${dayDetail.filter(k => k.inA && !k.inB).length > 0 ? 'text-error' : 'text-green-700'}`}>{dayDetail.filter(k => k.inA && !k.inB).length}</div>
              </div>
              <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
                <div className="text-xs text-on-surface-variant mb-1">Nur gebucht</div>
                <div className="text-2xl font-bold text-amber-700">{dayDetail.filter(k => !k.inA && k.inB).length}</div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto p-5 pt-4">
            <table className="w-full text-sm">
              <thead><tr className="bg-surface-container/50">
                <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">#</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant cursor-pointer select-none" onClick={() => toggleSort('nachname')}>Nachname{sIcon('nachname')}</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant cursor-pointer select-none" onClick={() => toggleSort('vorname')}>Vorname{sIcon('vorname')}</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant cursor-pointer select-none" onClick={() => toggleSort('klasse')}>Klasse{sIcon('klasse')}</th>
                {hasAbgleich && <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant cursor-pointer select-none" onClick={() => toggleSort('status')}>Status{sIcon('status')}</th>}
                <th className="text-left px-3 py-2 text-xs font-semibold text-on-surface-variant">Liste</th>
              </tr></thead>
              <tbody className="divide-y divide-outline-variant/10">
                {sortedDetail.map((k, i) => (
                  <tr key={i} className={`hover:bg-surface-container/30 ${hasAbgleich && k.inA && !k.inB ? 'bg-red-50/40' : hasAbgleich && !k.inA && k.inB ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2 text-on-surface-variant">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold text-on-surface">{k.nachname}</td>
                    <td className="px-3 py-2 text-on-surface">{k.vorname}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                    {hasAbgleich && <td className="px-3 py-2">
                      {k.inA && k.inB && <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">OK</span>}
                      {k.inA && !k.inB && <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">Fehlt in B</span>}
                      {!k.inA && k.inB && <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">Nur in B</span>}
                    </td>}
                    <td className="px-3 py-2 flex gap-1">
                      {k.inA && <span className="bg-blue-100 text-blue-700 text-xs font-bold px-1.5 py-0.5 rounded-full">A</span>}
                      {k.inB && <span className="bg-green-100 text-green-700 text-xs font-bold px-1.5 py-0.5 rounded-full">B</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default TagesansichtPage;
