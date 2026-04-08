import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { fmtDate } from '../utils/helpers';
import Spinner from './Spinner';

// FINANZEN
const FinanzenPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (id) => {
    if (!id) return;
    setLoading(true);
    const res = await API.get('finanzen', { ferienblock_id: id });
    setData(res);
    setLoading(false);
  };

  useEffect(() => { if (blockId) load(blockId); }, [blockId]);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Kostenkalkulation & Buchungen</span>
          <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Finanzen</h2>
        </div>
        <div className="flex items-center bg-surface-container-lowest px-4 py-1.5 rounded-xl border border-outline-variant/20 gap-4">
          <select className="bg-transparent text-sm border-none focus:ring-0 outline-none font-bold text-on-surface py-2" value={blockId} onChange={e => setBlockId(e.target.value)}>
            <option value="">– Block wählen –</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="py-12 flex justify-center"><Spinner /></div>}

      {!loading && data && data.statistik && (() => {
        const exportFinanzen = () => {
          const wb = XLSX.utils.book_new();
          if (data.buchungen?.length) {
            const rows = data.buchungen.map(k => ({
              Nachname: k.nachname, Vorname: k.vorname, Klasse: k.klasse || '',
              'Tage gebucht': parseInt(k.tage_gebucht), 'Gesamtbetrag (€)': parseFloat(k.gesamtbetrag).toFixed(2),
              Kontostand: k.kontostand ? parseFloat(k.kontostand).toFixed(2) : ''
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Buchungen');
          }
          if (data.fehlende_buchungen?.length) {
            const rows = data.fehlende_buchungen.map(k => ({
              Nachname: k.nachname, Vorname: k.vorname, Klasse: k.klasse || '', 'Tage angemeldet': parseInt(k.tage_angemeldet)
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Ohne Buchung');
          }
          if (wb.SheetNames.length) {
            XLSX.writeFile(wb, `Finanzen_${data.block.name.replace(/\s+/g, '_')}.xlsx`);
            toast.success('Finanzen exportiert');
          }
        };

        return <>
          {/* Stat Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-3xl">child_care</span>
                </div>
              </div>
              <p className="text-sm font-medium text-on-surface-variant">Kinder mit Buchung</p>
              <h4 className="text-3xl font-extrabold text-on-surface mt-1">{data.statistik.kinder_mit_buchung}</h4>
            </div>
            <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                  <span className="material-symbols-outlined text-3xl">restaurant</span>
                </div>
              </div>
              <p className="text-sm font-medium text-on-surface-variant">Gesamt Mahlzeiten</p>
              <h4 className="text-3xl font-extrabold text-emerald-500 mt-1">{data.statistik.gesamt_buchungen}</h4>
            </div>
            <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 rounded-xl bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
                  <span className="material-symbols-outlined text-3xl">account_balance_wallet</span>
                </div>
              </div>
              <p className="text-sm font-medium text-on-surface-variant">Gesamtbetrag</p>
              <h4 className="text-3xl font-extrabold text-tertiary mt-1">{data.statistik.gesamt_betrag.toFixed(2)} €</h4>
            </div>
            <div className="bg-surface-container-lowest p-6 rounded-2xl transition-all hover:bg-surface-container-low relative overflow-hidden">
              {data.statistik.kinder_ohne_buchung > 0 && <div className="absolute top-0 right-0 w-1.5 h-full bg-error"></div>}
              <div className="flex justify-between items-start mb-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${data.statistik.kinder_ohne_buchung > 0 ? 'bg-error/10 text-error' : 'bg-surface-container-high text-on-surface-variant'}`}>
                  <span className="material-symbols-outlined text-3xl">person_off</span>
                </div>
              </div>
              <p className="text-sm font-medium text-on-surface-variant">Ohne Buchung</p>
              <h4 className={`text-3xl font-extrabold mt-1 ${data.statistik.kinder_ohne_buchung > 0 ? 'text-error' : 'text-on-surface'}`}>{data.statistik.kinder_ohne_buchung}</h4>
            </div>
          </section>

          <div className="flex justify-end">
            <button className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl text-on-surface-variant hover:bg-surface-container-low border border-outline-variant/20 transition-colors" onClick={exportFinanzen}>
              <span className="material-symbols-outlined text-base">download</span>Als Excel exportieren
            </button>
          </div>

          {/* Fehlende Buchungen */}
          {data.fehlende_buchungen?.length > 0 && (
            <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
              <div className="flex items-center gap-2 px-6 py-4 border-b border-outline-variant/10 bg-error-container/10">
                <span className="material-symbols-outlined text-error">warning</span>
                <span className="font-bold text-error text-sm">{data.fehlende_buchungen.length} Kinder ohne Buchung</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-surface-container-low">
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Klasse</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Tage</th>
                  </tr></thead>
                  <tbody className="divide-y divide-outline-variant/5">
                    {data.fehlende_buchungen.map((k, i) => (
                      <tr key={i} className="hover:bg-error-container/5 transition-colors">
                        <td className="px-4 py-3 font-bold text-on-surface">{k.nachname}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{k.vorname}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{k.klasse || '–'}</td>
                        <td className="px-4 py-3"><span className="bg-error-container text-on-error-container text-xs font-bold px-2 py-0.5 rounded-full">{k.tage_angemeldet}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Buchungen pro Kind */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">receipt_long</span>
              <span className="font-bold text-on-surface text-sm">Buchungen pro Kind</span>
              <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-full ml-auto">{data.block?.preis_pro_tag || '3.50'} €/Tag</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-surface-container-low">
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Nachname</th>
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Vorname</th>
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Klasse</th>
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Tage</th>
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Betrag</th>
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-outline">Kontostand</th>
                </tr></thead>
                <tbody className="divide-y divide-outline-variant/5">
                  {data.buchungen.map((k, i) => (
                    <tr key={i} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-4 py-3 font-bold text-on-surface">{k.nachname}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{k.vorname}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{k.klasse || '–'}</td>
                      <td className="px-4 py-3 text-on-surface">{k.tage_gebucht}</td>
                      <td className="px-4 py-3 font-bold text-on-surface">{parseFloat(k.gesamtbetrag).toFixed(2)} €</td>
                      <td className="px-4 py-3 text-on-surface-variant">{k.kontostand ? `${parseFloat(k.kontostand).toFixed(2)} €` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>;
      })()}
    </div>
  );
};

export default FinanzenPage;
