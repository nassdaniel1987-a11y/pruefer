import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { fmtDate, fmtDateTime } from '../utils/helpers';
import { printFehlendeKinder } from '../utils/print';
import Spinner from './Spinner';
import { DashboardSkeleton, Skel } from './Skeleton';

// DASHBOARD
const Dashboard = ({ blocks, onNavigate, onReload }) => {
  const [blockDetail, setBlockDetail] = useState({});
  const [loadingDetail, setLoadingDetail] = useState({});
  const [expandedBlock, setExpandedBlock] = useState(null);
  const [expandedNurB, setExpandedNurB] = useState(null);
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
    <div className="space-y-8 pb-20">
      {/* Hero Welcome */}
      <section>
        <div className="relative p-8 rounded-3xl bg-gradient-to-br from-primary to-primary-container text-white overflow-hidden">
          <div className="relative z-10">
            <h3 className="text-3xl font-extrabold tracking-tight mb-2">Willkommen zurück.</h3>
            <p className="text-white/80 max-w-md font-medium">
              {blocks.length > 0
                ? `${blocks.length} Ferienblöcke angelegt. ${hatAbgleich && gesamtFehltInB > 0 ? `${gesamtFehltInB} Kinder ohne Buchung.` : 'Alle Systeme laufen stabil.'}`
                : 'Noch kein Ferienblock angelegt. Erstelle jetzt deinen ersten Block.'}
            </p>
          </div>
          <span className="material-symbols-outlined absolute -right-8 -bottom-8 text-[180px] text-white/5 opacity-20 rotate-12">shield</span>
        </div>
      </section>

      {/* Stat Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low cursor-default">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary-container/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-3xl">calendar_today</span>
            </div>
            {blocks.length > 0 && <span className="text-[10px] font-bold text-primary px-2 py-1 bg-primary/10 rounded-full">LIVE</span>}
          </div>
          <p className="text-sm font-medium text-on-surface-variant">Ferienblöcke</p>
          <h4 className="text-3xl font-extrabold text-on-surface mt-1">{blocks.length}</h4>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low cursor-default">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-xl bg-tertiary-container/10 flex items-center justify-center text-tertiary">
              <span className="material-symbols-outlined text-3xl">diversity_3</span>
            </div>
          </div>
          <p className="text-sm font-medium text-on-surface-variant">Kinder in A</p>
          <h4 className="text-3xl font-extrabold text-on-surface mt-1">{gesamtKinderA}</h4>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low cursor-default">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <span className="material-symbols-outlined text-3xl">check_circle</span>
            </div>
          </div>
          <p className="text-sm font-medium text-on-surface-variant">{hatAbgleich ? 'Übereinstimmung' : 'Kinder in B'}</p>
          <h4 className="text-3xl font-extrabold text-on-surface mt-1">{hatAbgleich ? gesamtMatches : gesamtKinderB}</h4>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low cursor-default relative overflow-hidden">
          {hatAbgleich && gesamtFehltInB > 0 && <div className="absolute top-0 right-0 w-1.5 h-full bg-error"></div>}
          <div className="flex justify-between items-start mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${hatAbgleich && gesamtFehltInB > 0 ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'}`}>
              <span className="material-symbols-outlined text-3xl">{hatAbgleich ? 'warning' : 'account_balance_wallet'}</span>
            </div>
          </div>
          <p className="text-sm font-medium text-on-surface-variant">{hatAbgleich ? 'Fehlt in B' : 'Abgleich'}</p>
          <h4 className={`text-3xl font-extrabold mt-1 ${hatAbgleich && gesamtFehltInB > 0 ? 'text-error' : 'text-on-surface'}`}>{hatAbgleich ? gesamtFehltInB : '–'}</h4>
        </div>
      </section>

      {/* Block Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
        <div className="xl:col-span-2 space-y-6">
          <div className="flex justify-between items-end px-2">
            <div>
              <h3 className="text-xl font-extrabold text-on-surface">Aktuelle Ferienblöcke</h3>
              <p className="text-sm text-on-surface-variant">Status der laufenden Buchungszeiträume</p>
            </div>
            <div className="flex gap-2">
              {hatAbgleich && gesamtFehltInB > 0 && <>
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={printAllFehlende}>
                  <span className="material-symbols-outlined text-sm">print</span>Drucken
                </button>
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={exportFehlende}>
                  <span className="material-symbols-outlined text-sm">download</span>Excel
                </button>
              </>}
            </div>
          </div>

          {blocks.length === 0 ? (
            <div className="border-2 border-dashed border-outline-variant/30 p-12 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-surface-container-low transition-colors" onClick={() => onNavigate('ferienblock')}>
              <span className="material-symbols-outlined text-5xl text-outline-variant">add_circle</span>
              <span className="text-sm font-bold text-on-surface-variant">Ersten Block anlegen</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {blocks.map(b => {
                const d = blockDetail[b.id];
                const loading = loadingDetail[b.id];
                const hatErgebnis = d?.letzter_abgleich != null;
                return (
                  <div key={b.id} className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-5">
                      <div>
                        <h5 className="text-lg font-bold text-on-surface">{b.name}</h5>
                        <p className="text-sm text-on-surface-variant flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">calendar_month</span>
                          {fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-3 py-1 rounded-full">{parseFloat(b.preis_pro_tag).toFixed(2)} €/Tag</span>
                    </div>
                    {loading ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Skel className="h-16 rounded-xl" />
                          <Skel className="h-16 rounded-xl" />
                        </div>
                        <div className="flex gap-2">
                          <Skel className="h-8 w-24 rounded-lg" />
                          <Skel className="h-8 w-20 rounded-lg" />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-surface-container-low p-3 rounded-xl">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Angemeldet</div>
                            <div className="text-lg font-extrabold text-primary">{d?.kinder_a ?? 0} <span className="text-xs font-medium text-on-surface-variant">Kinder</span></div>
                          </div>
                          <div className="bg-surface-container-low p-3 rounded-xl">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Gebucht</div>
                            <div className="text-lg font-extrabold text-emerald-500">{d?.kinder_b ?? 0} <span className="text-xs font-medium text-on-surface-variant">Kinder</span></div>
                          </div>
                        </div>
                        {hatErgebnis && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ {d.matches} OK</span>
                            {d.nur_in_a > 0 && <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full">↓ {d.nur_in_a} ohne Buchung</span>}
                            {d.nur_in_b > 0 && <span className="bg-tertiary-container text-on-tertiary-container text-[10px] font-bold px-2 py-0.5 rounded-full">↑ {d.nur_in_b} ohne Anmeldung</span>}
                            {d.letzter_abgleich?.veraltet && <span className="bg-amber-400/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><span className="material-symbols-outlined text-[10px]">sync_problem</span>veraltet</span>}
                          </div>
                        )}
                        {d?.eintraege_b > 0 && b.preis_pro_tag && (
                          <div className="bg-surface-container-low px-3 py-2 rounded-xl">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-0.5">Geschätzte Kosten</div>
                            <div className="text-sm font-extrabold text-primary">
                              {(d.eintraege_b * parseFloat(b.preis_pro_tag)).toFixed(2)} €
                              <span className="text-[10px] font-medium text-on-surface-variant ml-1">({d.eintraege_b} × {parseFloat(b.preis_pro_tag).toFixed(2)} €)</span>
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2 pt-1 flex-wrap">
                          {hatErgebnis && d.letzter_abgleich?.veraltet && (
                            <p className="w-full text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[10px]">sync_problem</span>
                              Abgleich veraltet — neu durchführen
                            </p>
                          )}
                          {hatErgebnis && d.nur_in_a > 0 && (
                            <button className="px-3 py-1.5 text-xs font-bold rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors" onClick={() => {
                              setExpandedNurB(null);
                              if (expandedBlock === b.id) { setExpandedBlock(null); return; }
                              setExpandedBlock(b.id);
                              if (!abgleichDetail[b.id] && d.letzter_abgleich) {
                                setLoadingAbgleich(prev => ({ ...prev, [b.id]: true }));
                                API.get('abgleich', { abgleich_id: d.letzter_abgleich.id }).then(res => {
                                  setAbgleichDetail(prev => ({ ...prev, [b.id]: res }));
                                  setLoadingAbgleich(prev => ({ ...prev, [b.id]: false }));
                                });
                              }
                            }}>Keine Buchung</button>
                          )}
                          {hatErgebnis && d.nur_in_b > 0 && (
                            <button className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-400/20 text-amber-700 dark:text-amber-400 hover:bg-amber-400/30 transition-colors" onClick={() => {
                              setExpandedBlock(null);
                              if (expandedNurB === b.id) { setExpandedNurB(null); return; }
                              setExpandedNurB(b.id);
                              if (!abgleichDetail[b.id] && d.letzter_abgleich) {
                                setLoadingAbgleich(prev => ({ ...prev, [b.id]: true }));
                                API.get('abgleich', { abgleich_id: d.letzter_abgleich.id }).then(res => {
                                  setAbgleichDetail(prev => ({ ...prev, [b.id]: res }));
                                  setLoadingAbgleich(prev => ({ ...prev, [b.id]: false }));
                                });
                              }
                            }}>Keine Anmeldung</button>
                          )}
                          <button className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors" onClick={() => onNavigate('abgleich', b.id)}>Abgleich</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="border-2 border-dashed border-outline-variant/30 p-6 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-surface-container-low transition-colors" onClick={() => onNavigate('ferienblock')}>
                <span className="material-symbols-outlined text-4xl text-outline-variant hover:text-primary transition-colors">add_circle</span>
                <span className="text-sm font-bold text-on-surface-variant">Neuen Block</span>
              </div>
            </div>
          )}
        </div>

        {/* Expanded Detail (right column or below) */}
        <div className="space-y-6">
          {expandedBlock && abgleichDetail[expandedBlock]?.matches ? (() => {
            const am = abgleichDetail[expandedBlock].matches;
            const fehlende = am.filter(m => m.match_typ === 'nur_in_a');
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

            return fehlendeGrp.length > 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
                <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between">
                  <h4 className="font-bold text-error flex items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-base">warning</span>
                    {fehlendeGrp.length} Kinder ohne Buchung
                  </h4>
                  <div className="flex gap-1">
                    <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1"
                      onClick={() => printFehlendeKinder('Keine Essensbuchung', sortDetailList(fehlendeGrp), blocks.find(blk => blk.id === expandedBlock)?.name)}>
                      <span className="material-symbols-outlined text-sm">print</span>
                    </button>
                    <button className="p-1 text-on-surface-variant hover:text-error transition-colors" onClick={() => setExpandedBlock(null)}>
                      <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-error-container/10 border-b border-outline-variant/10">
                      <th className="text-left px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase cursor-pointer" onClick={() => toggleDetailSort('nachname')}>Name{sortIcon('nachname')}</th>
                      <th className="text-left px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase cursor-pointer" onClick={() => toggleDetailSort('klasse')}>Klasse{sortIcon('klasse')}</th>
                      <th className="text-left px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase cursor-pointer" onClick={() => toggleDetailSort('tage')}>Tage{sortIcon('tage')}</th>
                    </tr></thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {sortDetailList(fehlendeGrp).map((k, i) => (
                        <tr key={i} className="hover:bg-error-container/5 transition-colors">
                          <td className="px-3 py-2"><span className="font-bold text-on-surface">{k.nachname}</span>, <span className="text-on-surface-variant">{k.vorname}</span></td>
                          <td className="px-3 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                          <td className="px-3 py-2"><span className="bg-error-container text-on-error-container text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null;
          })() : loadingAbgleich[expandedBlock] ? (
            <div className="bg-surface-container-lowest rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-outline-variant/10">
                <Skel className="h-4 w-40" />
              </div>
              <div className="p-4 space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <Skel className="h-4 flex-1" />
                    <Skel className="h-4 w-12" />
                    <Skel className="h-4 w-8" />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Nur-in-B Panel */}
          {expandedNurB && abgleichDetail[expandedNurB]?.matches ? (() => {
            const am = abgleichDetail[expandedNurB].matches;
            const nurB = am.filter(m => m.match_typ === 'nur_in_b');
            const grouped = {};
            nurB.forEach(m => {
              const key = ((m.b_nachname || '') + '|' + (m.b_vorname || '')).toLowerCase();
              if (!grouped[key]) grouped[key] = { nachname: m.b_nachname, vorname: m.b_vorname, klasse: m.b_klasse || '', dateSet: new Set() };
              grouped[key].dateSet.add(m.b_datum);
            });
            const list = Object.values(grouped).map(k => ({ ...k, dates: [...k.dateSet] })).sort((a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de'));
            return list.length > 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-amber-400/40 overflow-hidden">
                <div className="px-5 py-4 border-b border-amber-400/20 flex items-center justify-between bg-amber-400/5">
                  <h4 className="font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-base">warning</span>
                    {list.length} Kinder — Keine Ferienanmeldung, Essen gebucht
                  </h4>
                  <div className="flex gap-1">
                    <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1"
                      onClick={() => printFehlendeKinder('Keine Ferienanmeldung — Essen gebucht', list, blocks.find(blk => blk.id === expandedNurB)?.name)}>
                      <span className="material-symbols-outlined text-sm">print</span>
                    </button>
                    <button className="p-1 text-on-surface-variant hover:text-amber-600 transition-colors" onClick={() => setExpandedNurB(null)}>
                      <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-amber-400/5 border-b border-amber-400/20">
                      <th className="text-left px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase">Name</th>
                      <th className="text-left px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase">Klasse</th>
                      <th className="text-left px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase">Tage</th>
                    </tr></thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {list.map((k, i) => (
                        <tr key={i} className="hover:bg-amber-400/5 transition-colors">
                          <td className="px-3 py-2"><span className="font-bold text-on-surface">{k.nachname}</span>, <span className="text-on-surface-variant">{k.vorname}</span></td>
                          <td className="px-3 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                          <td className="px-3 py-2"><span className="bg-amber-400/20 text-amber-700 dark:text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">{k.dates.length}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null;
          })() : null}

          {!expandedBlock && !expandedNurB && !loadingAbgleich[expandedBlock] && (
            <div className="bg-surface-container-low/50 rounded-3xl p-6">
              <h3 className="text-xl font-extrabold text-on-surface mb-2">Quick Info</h3>
              <p className="text-sm text-on-surface-variant mb-4">Wähle "Keine Buchung" oder "Keine Anmeldung" bei einem Block, um die Details hier zu sehen.</p>
              <button className="w-full py-3 bg-surface-container-highest rounded-xl text-xs font-extrabold uppercase tracking-widest text-on-surface-variant hover:bg-outline-variant/20 transition-colors" onClick={onReload}>
                Daten aktualisieren
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
