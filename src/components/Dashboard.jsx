import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { fmtDate, fmtDateTime } from '../utils/helpers';
import { printFehlendeKinder } from '../utils/print';
import Spinner from './Spinner';

// DASHBOARD
const Dashboard = ({ blocks, onNavigate, onReload }) => {
  const [blockDetail, setBlockDetail] = useState({});
  const [loadingDetail, setLoadingDetail] = useState({});
  const [expandedBlock, setExpandedBlock] = useState(null);
  const [abgleichDetail, setAbgleichDetail] = useState({});
  const [loadingAbgleich, setLoadingAbgleich] = useState({});
  const [detailSort, setDetailSort] = useState({ col: 'nachname', dir: 'asc' });

  const toggleDetailSort = (col) => {
    setDetailSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };
  const sortDetailList = (list) => {
    const { col, dir } = detailSort;
    return [...list].sort((a, b) => {
      let va, vb;
      if (col === 'tage') { va = a.dates.length; vb = b.dates.length; }
      else { va = (a[col] || '').toLowerCase(); vb = (b[col] || '').toLowerCase(); }
      const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb, 'de');
      return dir === 'asc' ? cmp : -cmp;
    });
  };
  const sortIcon = (col) => detailSort.col === col ? (detailSort.dir === 'asc' ? ' ▲' : ' ▼') : '';

  useEffect(() => {
    if (!blocks.length) return;
    setAbgleichDetail({});
    setExpandedBlock(null);
    blocks.forEach(b => {
      setLoadingDetail(prev => ({ ...prev, [b.id]: true }));
      Promise.all([
        API.get('listen', { ferienblock_id: b.id, liste: 'A' }),
        API.get('listen', { ferienblock_id: b.id, liste: 'B' }),
        API.get('abgleich', { ferienblock_id: b.id })
      ]).then(([aRows, bRows, abglList]) => {
        const aArr = Array.isArray(aRows) ? aRows : [];
        const bArr = Array.isArray(bRows) ? bRows : [];
        const abglArr = Array.isArray(abglList) ? abglList : [];
        const kinderA = new Set(aArr.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        const kinderBroh = new Set(bArr.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        const letzter = abglArr.length > 0 ? abglArr[0] : null;
        let matches = letzter ? parseInt(letzter.matches_kinder || letzter.matches_count || 0) : null;
        let nur_in_a = letzter ? parseInt(letzter.nur_in_a_kinder || letzter.nur_in_a_count || 0) : null;
        let nur_in_b = letzter ? parseInt(letzter.nur_in_b_kinder || letzter.nur_in_b_count || 0) : null;
        let matches_zeilen = letzter ? parseInt(letzter.matches_count || 0) : null;
        let nur_in_a_zeilen = letzter ? parseInt(letzter.nur_in_a_count || 0) : null;
        let nur_in_b_zeilen = letzter ? parseInt(letzter.nur_in_b_count || 0) : null;
        let kinderBkorrigiert = kinderBroh.size;
        if (letzter && matches !== null) kinderBkorrigiert = matches + (nur_in_b || 0);

        setBlockDetail(prev => ({
          ...prev, [b.id]: {
            kinder_a: kinderA.size, kinder_b: kinderBkorrigiert, kinder_b_roh: kinderBroh.size,
            eintraege_a: aArr.length, eintraege_b: bArr.length,
            abgleich_count: abglArr.length, letzter_abgleich: letzter,
            matches, nur_in_a, nur_in_b,
            matches_zeilen, nur_in_a_zeilen, nur_in_b_zeilen
          }
        }));
        setLoadingDetail(prev => ({ ...prev, [b.id]: false }));
      });
    });
  }, [blocks]);

  const vals = Object.values(blockDetail);
  const gesamtKinderA = vals.reduce((s, d) => s + (d?.kinder_a || 0), 0);
  const gesamtKinderB = vals.reduce((s, d) => s + (d?.kinder_b || 0), 0);
  const gesamtMatches = vals.reduce((s, d) => s + (d?.matches ?? 0), 0);
  const gesamtFehltInB = vals.reduce((s, d) => s + (d?.nur_in_a ?? 0), 0);
  const hatAbgleich = vals.some(d => d?.letzter_abgleich);

  // Excel-Export: Fehlende Kinder
  const exportFehlende = () => {
    const allFehlende = [];
    for (const bId of Object.keys(abgleichDetail)) {
      const am = abgleichDetail[bId]?.matches;
      if (!am) continue;
      const block = blocks.find(b => String(b.id) === String(bId));
      am.filter(m => m.match_typ === 'nur_in_a').forEach(m => {
        allFehlende.push({ Block: block?.name || '', Nachname: m.a_nachname, Vorname: m.a_vorname, Klasse: m.a_klasse || '', Datum: fmtDate(m.a_datum) });
      });
    }
    if (!allFehlende.length) { toast.info('Lade erst Details, dann exportieren'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allFehlende), 'Fehlende Buchungen');
    XLSX.writeFile(wb, 'Fehlende_Buchungen.xlsx');
    toast.success(`${allFehlende.length} Einträge exportiert`);
  };

  // Druckansicht: Alle fehlenden Kinder
  const printAllFehlende = () => {
    const grouped = {};
    for (const bId of Object.keys(abgleichDetail)) {
      const am = abgleichDetail[bId]?.matches;
      if (!am) continue;
      am.filter(m => m.match_typ === 'nur_in_a').forEach(m => {
        const key = ((m.a_nachname || '') + '|' + (m.a_vorname || '')).toLowerCase();
        if (!grouped[key]) grouped[key] = { nachname: m.a_nachname, vorname: m.a_vorname, klasse: m.a_klasse || '', dateSet: new Set() };
        grouped[key].dateSet.add(m.a_datum);
      });
    }
    Object.values(grouped).forEach(g => { g.dates = [...g.dateSet]; delete g.dateSet; });
    const printData = Object.values(grouped).sort((a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de'));
    if (!printData.length) { toast.info('Lade erst Details, dann drucken'); return; }
    printFehlendeKinder('Alle fehlenden Kinder — OHNE Buchung', printData, 'Alle Blöcke');
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">dashboard</span>
            Dashboard
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Übersicht aller Ferienblöcke und aktueller Status</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl text-primary hover:bg-primary/10 transition-colors" onClick={onReload}>
          <span className="material-symbols-outlined text-base">refresh</span>Aktualisieren
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
          <div className="text-xs text-on-surface-variant font-medium mb-1">Ferienblöcke</div>
          <div className="text-3xl font-bold text-primary">{blocks.length}</div>
          <div className="text-xs text-on-surface-variant mt-0.5">gesamt angelegt</div>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
          <div className="text-xs text-on-surface-variant font-medium mb-1">Kinder in A</div>
          <div className="text-3xl font-bold text-primary">{gesamtKinderA}</div>
          <div className="text-xs text-on-surface-variant mt-0.5">verschiedene Kinder angemeldet</div>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
          <div className="text-xs text-on-surface-variant font-medium mb-1">Kinder in B</div>
          <div className="text-3xl font-bold text-green-700">{gesamtKinderB}</div>
          <div className="text-xs text-on-surface-variant mt-0.5">verschiedene Kinder gebucht</div>
        </div>
        {hatAbgleich ? (<>
          <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
            <div className="text-xs text-on-surface-variant font-medium mb-1">Übereinstimmung</div>
            <div className="text-3xl font-bold text-green-700">{gesamtMatches}</div>
            <div className="text-xs text-on-surface-variant mt-0.5">Kinder mit Buchung</div>
          </div>
          <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
            <div className="text-xs text-on-surface-variant font-medium mb-1">Fehlt in B</div>
            <div className={`text-3xl font-bold ${gesamtFehltInB > 0 ? 'text-error' : 'text-green-700'}`}>{gesamtFehltInB}</div>
            <div className="text-xs text-on-surface-variant mt-0.5">{gesamtFehltInB > 0 ? 'Kinder ohne Buchung' : 'alle gebucht'}</div>
          </div>
        </>) : (
          <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
            <div className="text-xs text-on-surface-variant font-medium mb-1">Abgleich</div>
            <div className="text-3xl font-bold text-on-surface-variant">–</div>
            <div className="text-xs text-on-surface-variant mt-0.5">noch keiner durchgeführt</div>
          </div>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-sm border border-outline-variant/10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">calendar_month</span>
          <p className="text-on-surface-variant mb-4">Noch kein Ferienblock angelegt.</p>
          <button className="px-5 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors" onClick={() => onNavigate('ferienblock')}>
            Ersten Block anlegen
          </button>
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
            <span className="font-semibold text-on-surface">Alle Ferienblöcke</span>
            <div className="flex gap-2">
              {hatAbgleich && gesamtFehltInB > 0 && <>
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={printAllFehlende}>
                  <span className="material-symbols-outlined text-sm">print</span>Drucken
                </button>
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={exportFehlende}>
                  <span className="material-symbols-outlined text-sm">download</span>Excel
                </button>
              </>}
              <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-primary hover:bg-primary/10 transition-colors" onClick={() => onNavigate('ferienblock')}>
                <span className="material-symbols-outlined text-sm">add</span>Neu / Verwalten
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Zeitraum</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">€/Tag</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Angemeldet (A)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Gebucht (B)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">OK</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Fehlt in B</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Nur in B</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Abgleiche</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {blocks.map(b => {
                  const d = blockDetail[b.id];
                  const loading = loadingDetail[b.id];
                  const hatErgebnis = d?.letzter_abgleich != null;
                  return (
                    <React.Fragment key={b.id}>
                      <tr className="hover:bg-surface-container/30 transition-colors">
                        <td className="px-4 py-3 font-semibold text-on-surface">{b.name}</td>
                        <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{parseFloat(b.preis_pro_tag).toFixed(2)} €</td>
                        <td className="px-4 py-3">
                          {loading ? '…' : <><span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{d?.kinder_a ?? 0}</span>
                            <span className="text-[0.65rem] text-on-surface-variant ml-1">({d?.eintraege_a ?? 0} Tage)</span></>}
                        </td>
                        <td className="px-4 py-3">
                          {loading ? '…' : <><span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{d?.kinder_b ?? 0}</span>
                            <span className="text-[0.65rem] text-on-surface-variant ml-1">({d?.eintraege_b ?? 0} Tage)</span></>}
                        </td>
                        <td className="px-4 py-3">
                          {loading ? '…' : hatErgebnis
                            ? <><span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.matches}</span>
                              <span className="text-[0.65rem] text-on-surface-variant ml-1">({d.matches_zeilen} Tage)</span></>
                            : <span className="text-on-surface-variant">–</span>}
                        </td>
                        <td className="px-4 py-3">
                          {loading ? '…' : hatErgebnis
                            ? <><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${d.nur_in_a > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{d.nur_in_a}</span>
                              {d.nur_in_a > 0 && <span className="text-[0.65rem] text-on-surface-variant ml-1">({d.nur_in_a_zeilen} Tage)</span>}</>
                            : <span className="text-on-surface-variant">–</span>}
                        </td>
                        <td className="px-4 py-3">
                          {loading ? '…' : hatErgebnis
                            ? <><span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.nur_in_b}</span>
                              {d.nur_in_b > 0 && <span className="text-[0.65rem] text-on-surface-variant ml-1">({d.nur_in_b_zeilen} Tage)</span>}</>
                            : <span className="text-on-surface-variant">–</span>}
                        </td>
                        <td className="px-4 py-3">{loading ? '…' : <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{d?.abgleich_count ?? 0}</span>}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5 flex-wrap justify-end">
                            {hatErgebnis && d.nur_in_a > 0 && (
                              <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors" onClick={() => {
                                if (expandedBlock === b.id) { setExpandedBlock(null); return; }
                                setExpandedBlock(b.id);
                                if (!abgleichDetail[b.id] && d.letzter_abgleich) {
                                  setLoadingAbgleich(prev => ({ ...prev, [b.id]: true }));
                                  API.get('abgleich', { abgleich_id: d.letzter_abgleich.id }).then(res => {
                                    setAbgleichDetail(prev => ({ ...prev, [b.id]: res }));
                                    setLoadingAbgleich(prev => ({ ...prev, [b.id]: false }));
                                  });
                                }
                              }}>
                                Fehlende anzeigen
                              </button>
                            )}
                            <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors" onClick={() => onNavigate('abgleich', b.id)}>
                              Abgleich starten
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedBlock === b.id && (
                        <tr key={b.id + '-detail'}>
                          <td colSpan="10" className="px-4 py-4 bg-surface-container/30">
                            {loadingAbgleich[b.id] ? <Spinner /> : abgleichDetail[b.id]?.matches ? (() => {
                              const am = abgleichDetail[b.id].matches;
                              const fehlende = am.filter(m => m.match_typ === 'nur_in_a');
                              const nurInB = am.filter(m => m.match_typ === 'nur_in_b');
                              const matched = am.filter(m => m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted');

                              const groupEntries = (entries, prefix) => {
                                const map = {};
                                entries.forEach(m => {
                                  const key = ((m[prefix + '_nachname'] || '') + '|' + (m[prefix + '_vorname'] || '')).toLowerCase();
                                  if (!map[key]) map[key] = { nachname: m[prefix + '_nachname'], vorname: m[prefix + '_vorname'], klasse: m[prefix + '_klasse'] || '', dateSet: new Set() };
                                  map[key].dateSet.add(m[prefix + '_datum']);
                                });
                                return Object.values(map).map(k => ({ nachname: k.nachname, vorname: k.vorname, klasse: k.klasse, dates: [...k.dateSet] })).sort((a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de'));
                              };
                              const fehlendeGrp = groupEntries(fehlende, 'a');
                              const nurInBGrp = groupEntries(nurInB, 'b');

                              return (
                                <div className="space-y-4">
                                  {fehlendeGrp.length > 0 && (() => {
                                    const sorted = sortDetailList(fehlendeGrp);
                                    const thCls = "cursor-pointer select-none whitespace-nowrap text-left px-3 py-2 text-xs font-semibold text-on-surface-variant uppercase tracking-wide";
                                    return <div>
                                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <h4 className="font-semibold text-error flex items-center gap-1 text-sm">
                                          <span className="material-symbols-outlined text-base">warning</span>
                                          {fehlendeGrp.length} Kinder OHNE Buchung ({fehlende.length} Tage)
                                        </h4>
                                        <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1"
                                          onClick={() => printFehlendeKinder('Fehlende Kinder — OHNE Buchung', sorted, b.name)}>
                                          <span className="material-symbols-outlined text-sm">print</span>Drucken
                                        </button>
                                      </div>
                                      <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                                        <table className="w-full text-sm">
                                          <thead><tr className="bg-red-50">
                                            <th className={thCls}>#</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('nachname')}>Nachname{sortIcon('nachname')}</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('vorname')}>Vorname{sortIcon('vorname')}</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('klasse')}>Klasse{sortIcon('klasse')}</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('tage')}>Tage{sortIcon('tage')}</th>
                                            <th className={thCls}>Daten</th>
                                          </tr></thead>
                                          <tbody className="divide-y divide-outline-variant/10">
                                            {sorted.map((k, i) => (<tr key={i} className="bg-red-50/50">
                                              <td className="px-3 py-2 text-on-surface-variant">{i + 1}</td>
                                              <td className="px-3 py-2 font-semibold text-on-surface">{k.nachname}</td>
                                              <td className="px-3 py-2 text-on-surface">{k.vorname}</td>
                                              <td className="px-3 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                                              <td className="px-3 py-2"><span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                                              <td className="px-3 py-2 text-xs text-on-surface-variant">{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                                            </tr>))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>;
                                  })()}
                                  {nurInBGrp.length > 0 && (() => {
                                    const sorted = sortDetailList(nurInBGrp);
                                    const thCls = "cursor-pointer select-none whitespace-nowrap text-left px-3 py-2 text-xs font-semibold text-on-surface-variant uppercase tracking-wide";
                                    return <div>
                                      <h4 className="font-semibold text-amber-700 flex items-center gap-1 text-sm mb-2">
                                        <span className="material-symbols-outlined text-base">info</span>
                                        {nurInBGrp.length} Kinder NUR in Liste B ({nurInB.length} Tage)
                                      </h4>
                                      <div className="overflow-x-auto rounded-xl border border-outline-variant/10">
                                        <table className="w-full text-sm">
                                          <thead><tr className="bg-amber-50">
                                            <th className={thCls}>#</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('nachname')}>Nachname{sortIcon('nachname')}</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('vorname')}>Vorname{sortIcon('vorname')}</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('klasse')}>Klasse{sortIcon('klasse')}</th>
                                            <th className={thCls} onClick={() => toggleDetailSort('tage')}>Tage{sortIcon('tage')}</th>
                                            <th className={thCls}>Daten</th>
                                          </tr></thead>
                                          <tbody className="divide-y divide-outline-variant/10">
                                            {sorted.map((k, i) => (<tr key={i} className="bg-amber-50/50">
                                              <td className="px-3 py-2 text-on-surface-variant">{i + 1}</td>
                                              <td className="px-3 py-2 font-semibold text-on-surface">{k.nachname}</td>
                                              <td className="px-3 py-2 text-on-surface">{k.vorname}</td>
                                              <td className="px-3 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                                              <td className="px-3 py-2"><span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                                              <td className="px-3 py-2 text-xs text-on-surface-variant">{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                                            </tr>))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>;
                                  })()}
                                  {matched.length > 0 && (
                                    <div>
                                      <h4 className="font-semibold text-green-700 flex items-center gap-1 text-sm mb-1">
                                        <span className="material-symbols-outlined text-base">check_circle</span>
                                        {new Set(matched.map(m => (m.a_nachname + '|' + m.a_vorname).toLowerCase())).size} Kinder übereinstimmend ({matched.length} Tage)
                                      </h4>
                                      <p className="text-xs text-on-surface-variant">Alle Kinder mit Anmeldung und Buchung stimmen überein.</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })() : <p className="text-on-surface-variant text-sm">Keine Abgleich-Daten verfügbar</p>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
