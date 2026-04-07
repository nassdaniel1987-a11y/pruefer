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
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">account_balance</span>
            Finanzen
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Kostenkalkulation: {data?.block?.preis_pro_tag || '3.50'} € pro Kind pro Tag</p>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10 mb-4">
        <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Ferienblock</label>
        <select className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
          value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {loading && <Spinner />}

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
              <div className="text-xs text-on-surface-variant mb-1">Kinder mit Buchung</div>
              <div className="text-2xl font-bold text-primary">{data.statistik.kinder_mit_buchung}</div>
            </div>
            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
              <div className="text-xs text-on-surface-variant mb-1">Gesamt Mahlzeiten</div>
              <div className="text-2xl font-bold text-green-700">{data.statistik.gesamt_buchungen}</div>
            </div>
            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
              <div className="text-xs text-on-surface-variant mb-1">Gesamtbetrag</div>
              <div className="text-2xl font-bold text-amber-700">{data.statistik.gesamt_betrag.toFixed(2)} €</div>
            </div>
            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/10">
              <div className="text-xs text-on-surface-variant mb-1">Ohne Buchung</div>
              <div className="text-2xl font-bold text-error">{data.statistik.kinder_ohne_buchung}</div>
              <div className="text-xs text-on-surface-variant mt-0.5">in A, nicht in B</div>
            </div>
          </div>

          <div className="flex justify-end mb-4">
            <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container-low border border-outline-variant/20 transition-colors" onClick={exportFinanzen}>
              <span className="material-symbols-outlined text-base">download</span>Als Excel exportieren
            </button>
          </div>

          {data.fehlende_buchungen?.length > 0 && (
            <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 mb-3 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-outline-variant/10">
                <span className="material-symbols-outlined text-error text-base">person_off</span>
                <span className="font-semibold text-error">Fehlende Buchungen</span>
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{data.fehlende_buchungen.length}</span>
              </div>
              <p className="text-sm text-on-surface-variant px-5 py-3">Diese Kinder sind angemeldet, haben aber keine Buchung beim Caterer.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-surface-container/50">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Nachname</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Vorname</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Klasse</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Tage angemeldet</th>
                  </tr></thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {data.fehlende_buchungen.map((k, i) => (
                      <tr key={i} className="hover:bg-surface-container/30">
                        <td className="px-4 py-2 text-on-surface">{k.nachname}</td>
                        <td className="px-4 py-2 text-on-surface">{k.vorname}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                        <td className="px-4 py-2">{k.tage_angemeldet}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-outline-variant/10">
              <span className="font-semibold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-primary">receipt_long</span>
                Buchungen pro Kind
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-surface-container/50">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Nachname</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Vorname</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Klasse</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Tage</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Gesamtbetrag</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-on-surface-variant">Kontostand</th>
                </tr></thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {data.buchungen.map((k, i) => (
                    <tr key={i} className="hover:bg-surface-container/30">
                      <td className="px-4 py-2 text-on-surface">{k.nachname}</td>
                      <td className="px-4 py-2 text-on-surface">{k.vorname}</td>
                      <td className="px-4 py-2 text-on-surface-variant">{k.klasse || '–'}</td>
                      <td className="px-4 py-2 text-on-surface">{k.tage_gebucht}</td>
                      <td className="px-4 py-2 font-semibold text-on-surface">{parseFloat(k.gesamtbetrag).toFixed(2)} €</td>
                      <td className="px-4 py-2 text-on-surface-variant">{k.kontostand ? `${parseFloat(k.kontostand).toFixed(2)} €` : '–'}</td>
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
