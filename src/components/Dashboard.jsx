import React, { useState, useEffect, useMemo } from 'react';
import { ladeXLSX } from '../utils/xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { fmtDate } from '../utils/helpers';
import { printFehlendeKinder } from '../utils/print';
import { Skel } from './Skeleton';

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
  const gesamtFehltInB = vals.reduce((s, d) => s + (d?.nur_in_a ?? 0), 0);
  const hatAbgleich = vals.some(d => d?.letzter_abgleich);

  // ── "Heute" ──────────────────────────────────────────
  // Zeigt, was heute zu tun ist. Der gespeicherte Abgleich umfasst immer den
  // ganzen Block; hier wird auf den heutigen Tag eingegrenzt — dieselbe
  // Eingrenzung, die der tägliche Bericht serverseitig vornimmt.
  const heute = new Date().toISOString().split('T')[0];
  const ymd = (v) => String(v || '').split('T')[0];

  const laufenderBlock = useMemo(
    () => blocks.find(b => ymd(b.startdatum) <= heute && heute <= ymd(b.enddatum)) || null,
    [blocks, heute]
  );

  // Details des laufenden Blocks von sich aus laden — für "Heute" darf der
  // Nutzer nicht erst irgendwo klicken müssen.
  useEffect(() => {
    if (!laufenderBlock) return;
    const d = blockDetail[laufenderBlock.id];
    if (!d?.letzter_abgleich) return;
    if (abgleichDetail[laufenderBlock.id]) return;
    API.get('abgleich', { abgleich_id: d.letzter_abgleich.id }).then(res => {
      setAbgleichDetail(prev => ({ ...prev, [laufenderBlock.id]: res }));
    });
  }, [laufenderBlock, blockDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  const heuteFaelle = useMemo(() => {
    if (!laufenderBlock) return null;
    const matches = abgleichDetail[laufenderBlock.id]?.matches;
    if (!matches) return null;
    const sammle = (typ, prefix) => {
      const map = new Map();
      matches
        .filter(m => m.match_typ === typ && ymd(m[prefix + '_datum']) === heute)
        .forEach(m => {
          const key = ((m[prefix + '_nachname'] || '') + '|' + (m[prefix + '_vorname'] || '')).toLowerCase();
          if (!map.has(key)) map.set(key, {
            nachname: m[prefix + '_nachname'], vorname: m[prefix + '_vorname'], klasse: m[prefix + '_klasse'] || ''
          });
        });
      return [...map.values()].sort((a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de'));
    };
    return { ohneEssen: sammle('nur_in_a', 'a'), nichtAngemeldet: sammle('nur_in_b', 'b') };
  }, [laufenderBlock, abgleichDetail, heute]);

  // Steuert die Spaltenaufteilung: ohne aufgeklapptes Detail bekommen die
  // Blockkarten die volle Breite statt zwei Dritteln.
  const detailOffen = Boolean(expandedBlock || expandedNurB);

  // Excel-Export: Fehlende Kinder
  const exportFehlende = async () => {
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
    const XLSX = await ladeXLSX();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allFehlende), 'Kein Essen gebucht');
    XLSX.writeFile(wb, 'Kein_Essen_gebucht.xlsx');
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
      {/* Heute */}
      <section>
        {!laufenderBlock ? (
          <div className="p-6 rounded-3xl bg-surface-container-low/50">
            <h3 className="text-xl font-extrabold text-on-surface mb-1">Heute läuft keine Ferienbetreuung.</h3>
            <p className="text-sm text-on-surface-variant">
              {blocks.length > 0
                ? 'Kein Ferienblock deckt den heutigen Tag ab. Die Übersicht unten zeigt alle Blöcke.'
                : 'Noch kein Ferienblock angelegt. Lege den ersten an, um loszulegen.'}
            </p>
          </div>
        ) : (
          <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-br from-primary to-primary-container text-white">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
              <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight">Heute — {laufenderBlock.name}</h3>
              <span className="text-white/70 text-sm font-medium">{fmtDate(heute)}</span>
            </div>

            {heuteFaelle === null ? (
              <p className="text-white/80 font-medium">
                {blockDetail[laufenderBlock.id]?.letzter_abgleich
                  ? 'Lade die heutigen Fälle …'
                  : 'Für diesen Block gibt es noch keinen Abgleich.'}
              </p>
            ) : heuteFaelle.ohneEssen.length === 0 && heuteFaelle.nichtAngemeldet.length === 0 ? (
              <p className="text-white/90 font-medium">
                Keine Abweichungen für heute. Alle Anmeldungen haben eine passende Essensbuchung.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { titel: 'Kein Essen gebucht', liste: heuteFaelle.ohneEssen },
                  { titel: 'Essen gebucht, nicht angemeldet', liste: heuteFaelle.nichtAngemeldet },
                ].filter(g => g.liste.length > 0).map(g => (
                  <div key={g.titel} className="bg-white/10 rounded-2xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/70 mb-2">
                      {g.titel} ({g.liste.length})
                    </div>
                    <ul className="space-y-1">
                      {g.liste.slice(0, 6).map((k, i) => (
                        <li key={i} className="text-sm font-medium">
                          {k.nachname}, {k.vorname}
                          {k.klasse && <span className="text-white/60 ml-1">· {k.klasse}</span>}
                        </li>
                      ))}
                      {g.liste.length > 6 && (
                        <li className="text-xs text-white/70 pt-1">und {g.liste.length - 6} weitere</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <button
              className="mt-5 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 transition-colors text-sm font-bold"
              onClick={() => onNavigate('tagesansicht')}
            >
              Zur Tagesansicht
            </button>
          </div>
        )}
      </section>

      {/* Kennzahlen über alle Blöcke */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest p-6 rounded-2xl">
          <div className="w-12 h-12 rounded-xl bg-tertiary-container/10 flex items-center justify-center text-tertiary mb-4">
            <span className="material-symbols-outlined text-3xl">diversity_3</span>
          </div>
          <p className="text-sm font-medium text-on-surface-variant">Angemeldete Kinder</p>
          <h4 className="text-3xl font-extrabold text-on-surface mt-1">{gesamtKinderA}</h4>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl relative overflow-hidden">
          {hatAbgleich && gesamtFehltInB > 0 && <div className="absolute top-0 right-0 w-1.5 h-full bg-error"></div>}
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${hatAbgleich && gesamtFehltInB > 0 ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'}`}>
            <span className="material-symbols-outlined text-3xl">{hatAbgleich ? 'warning' : 'sync_alt'}</span>
          </div>
          <p className="text-sm font-medium text-on-surface-variant">{hatAbgleich ? 'Kein Essen gebucht' : 'Noch kein Abgleich'}</p>
          <h4 className={`text-3xl font-extrabold mt-1 ${hatAbgleich && gesamtFehltInB > 0 ? 'text-error' : 'text-on-surface'}`}>{hatAbgleich ? gesamtFehltInB : '–'}</h4>
        </div>
      </section>

      {/* Block Cards */}
      <div className={`grid gap-8 items-start ${detailOffen ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1'}`}>
        <div className={`space-y-6 ${detailOffen ? 'xl:col-span-2' : ''}`}>
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
              <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" onClick={onReload}>
                <span className="material-symbols-outlined text-sm">refresh</span>Aktualisieren
              </button>
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
                            {d.nur_in_a > 0 && <span className="bg-error/10 text-error text-[10px] font-bold px-2 py-0.5 rounded-full">↓ {d.nur_in_a} kein Essen</span>}
                            {d.nur_in_b > 0 && <span className="bg-tertiary-container text-on-tertiary-container text-[10px] font-bold px-2 py-0.5 rounded-full">↑ {d.nur_in_b} nicht angemeldet</span>}
                            {d.letzter_abgleich?.veraltet && <span className="bg-amber-400/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><span className="material-symbols-outlined text-[10px]">sync_problem</span>veraltet</span>}
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
                            }}>Kein Essen gebucht</button>
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
                            }}>Nicht angemeldet</button>
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

        {/* Aufgeklapptes Detail — nur vorhanden, wenn wirklich etwas offen ist */}
        <div className={`space-y-6 ${detailOffen ? '' : 'hidden'}`}>
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
                    {fehlendeGrp.length} Kinder — kein Essen gebucht
                  </h4>
                  <div className="flex gap-1">
                    <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1"
                      onClick={() => printFehlendeKinder('Kein Essen gebucht', sortDetailList(fehlendeGrp), blocks.find(blk => blk.id === expandedBlock)?.name)}>
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
                    {list.length} Kinder — Essen gebucht, aber nicht angemeldet
                  </h4>
                  <div className="flex gap-1">
                    <button className="px-2.5 py-1 text-xs font-medium rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1"
                      onClick={() => printFehlendeKinder('Essen gebucht — nicht angemeldet', list, blocks.find(blk => blk.id === expandedNurB)?.name)}>
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

        </div>
      </div>
    </div>
  );
};

export default Dashboard;
