import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from '../utils/toast';
import { fmtDate } from '../utils/helpers';
import { computeDiff } from '../utils/diff';

// ─── VERGLEICHSANSICHT ────────────────────────────────
const VergleichView = ({ matchesOld, matchesNew, abgleichOld, abgleichNew }) => {
  const diff = useMemo(() => computeDiff(matchesOld, matchesNew), [matchesOld, matchesNew]);
  const [groupBy, setGroupBy] = useState('kind'); // 'kind' oder 'tag'

  if (!diff) return <p style={{ color: 'var(--text2)' }}>Keine Daten</p>;

  // Nach Kind gruppieren (mit Status-Tracking)
  const groupByKindFn = (entries, getMatch) => {
    const map = {};
    entries.forEach(e => {
      const m = getMatch(e);
      const key = ((m.a_nachname || '') + '|' + (m.a_vorname || '')).toLowerCase();
      if (!map[key]) map[key] = { nachname: m.a_nachname || '', vorname: m.a_vorname || '', klasse: m.a_klasse || '', dateSet: new Set(), statusSet: new Set() };
      map[key].dateSet.add(String(m.a_datum || '').split('T')[0]);
      if (e.status) map[key].statusSet.add(e.status);
    });
    return Object.values(map).map(k => ({ ...k, dates: [...k.dateSet], statuses: [...k.statusSet] })).sort((a, b) => (a.nachname).localeCompare(b.nachname, 'de'));
  };

  // Nach Tag gruppieren (mit Status-Tracking)
  const groupByTagFn = (entries, getMatch) => {
    const map = {};
    entries.forEach(e => {
      const m = getMatch(e);
      const date = String(m.a_datum || '').split('T')[0];
      if (!map[date]) map[date] = { date, kinderSet: new Set(), statusSet: new Set() };
      map[date].kinderSet.add(((m.a_vorname || '') + ' ' + (m.a_nachname || '')).trim());
      if (e.status) map[date].statusSet.add(e.status);
    });
    return Object.values(map).map(d => ({ ...d, kinder: [...d.kinderSet], statuses: [...d.statusSet] })).sort((a, b) => a.date.localeCompare(b.date));
  };

  // Status-Badge Hilfsfunktion
  const StatusBadge = ({ statuses }) => {
    if (!statuses || statuses.length === 0) return null;
    if (statuses.includes('matched') && statuses.includes('missing')) {
      return <span style={{ fontSize: '0.75rem' }}><span className="badge badge-green" style={{ marginRight: '0.25rem' }}>✓ OK</span><span className="badge badge-orange">✗ Fehlt</span></span>;
    }
    if (statuses.includes('matched')) return <span className="badge badge-green">✓ OK</span>;
    if (statuses.includes('missing')) return <span className="badge badge-orange">✗ Fehlt in B</span>;
    return null;
  };

  const fmtDelta = (val) => {
    if (val > 0) return <span className="delta-positive">+{val}</span>;
    if (val < 0) return <span className="delta-negative">{val}</span>;
    return <span className="delta-zero">±0</span>;
  };

  // Entfallene nach Status aufteilen
  const entfallenOk = diff.entfallen.filter(e => e.status === 'matched');
  const entfallenFehlend = diff.entfallen.filter(e => e.status === 'missing');

  // Nur identifizierte Verluste anzeigen (keine errechneten Fantasie-Zahlen)

  // Sektionen: nur echte ÄNDERUNGEN bekommen Farbe
  const sections = [
    {
      key: 'neuGeloest', title: 'Neu gelöst (jetzt gebucht)', icon: '✅', badge: 'badge-green',
      changed: true, border: 'rgba(34,197,94,0.5)',
      items: diff.neuGeloest, getMatch: e => e.neu, desc: 'Waren vorher ohne Buchung, sind jetzt korrekt zugeordnet.'
    },
    {
      key: 'neuFehlend', title: 'Buchung verloren (noch angemeldet)', icon: '💔', badge: 'badge-red',
      changed: true, border: 'rgba(220,53,69,0.5)',
      items: diff.neuFehlend, getMatch: e => e.neu, desc: 'Waren vorher Treffer, aber die Buchung in Liste B fehlt jetzt.'
    },
    {
      key: 'entfallenOk', title: 'Nicht mehr angemeldet (waren Treffer)', icon: '🔴', badge: 'badge-red',
      changed: true, border: 'rgba(220,53,69,0.5)',
      items: entfallenOk, getMatch: e => e.match, desc: 'Hatten vorher einen Treffer, sind in den neuen Daten komplett entfallen.'
    },
    {
      key: 'neueEintraege', title: 'Neue Einträge', icon: '🆕', badge: 'badge-blue',
      changed: true, border: 'rgba(0,90,156,0.5)', showStatus: true,
      items: diff.neueEintraege, getMatch: e => e.match, desc: 'Im älteren Abgleich nicht vorhanden.'
    },
    {
      key: 'nurBWeg', title: 'Essen gebucht — jetzt weggefallen', icon: '🍽️', badge: 'badge-red',
      changed: true, border: 'rgba(220,53,69,0.5)',
      items: (diff.nurBWeg || []).map(m => ({ match: m })), getMatch: e => ({ a_nachname: e.match.b_nachname, a_vorname: e.match.b_vorname, a_datum: e.match.b_datum, a_klasse: e.match.b_klasse }),
      desc: 'Waren im alten Abgleich als "Essen gebucht — nicht angemeldet" gelistet, fehlen jetzt komplett.'
    },
    {
      key: 'nurBNeu', title: 'Essen neu gebucht (nicht angemeldet)', icon: '🍽️', badge: 'badge-orange',
      changed: true, border: 'rgba(251,146,60,0.5)',
      items: (diff.nurBNeu || []).map(m => ({ match: m })), getMatch: e => ({ a_nachname: e.match.b_nachname, a_vorname: e.match.b_vorname, a_datum: e.match.b_datum, a_klasse: e.match.b_klasse }),
      desc: 'Neu in Liste B aufgetaucht, aber keine Ferienanmeldung vorhanden.'
    },
    {
      key: 'unveraendertFehlend', title: 'Weiterhin fehlend', icon: '⚠', badge: 'badge-orange',
      changed: false,
      items: diff.unveraendertFehlend, getMatch: e => e.neu, desc: 'Fehlten vorher und fehlen weiterhin — keine Änderung.'
    },
    {
      key: 'entfallenFehlend', title: 'Nicht mehr angemeldet (waren bereits fehlend)', icon: '🗑', badge: 'badge-grey',
      changed: false,
      items: entfallenFehlend, getMatch: e => e.match, desc: 'Waren schon vorher ohne Buchung und sind jetzt entfallen — keine Auswirkung.'
    },
  ];

  // Excel-Export
  const exportDiffExcel = () => {
    const wb = XLSX.utils.book_new();
    sections.forEach(sec => {
      if (!sec.items.length) return;
      const grouped = groupByKindFn(sec.items, sec.getMatch);
      const rows = grouped.map(k => ({
        Nachname: k.nachname, Vorname: k.vorname, Klasse: k.klasse,
        Tage: k.dates.length, Daten: k.dates.sort().map(d => fmtDate(d)).join(', ')
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sec.title.slice(0, 31));
    });
    if (wb.SheetNames.length) {
      XLSX.writeFile(wb, 'Vergleich_Abgleiche.xlsx');
      toast.success('Vergleich exportiert');
    } else {
      toast.info('Keine Veränderungen zum Exportieren');
    }
  };

  return (
    <div>
      {/* Delta-Summary — 4 Karten */}
      <div className="stat-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat-card accent-green" style={{ padding: '0.75rem 1rem' }}>
          <div className="stat-label" style={{ fontSize: '0.7rem' }}>✓ Treffer</div>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{diff.newCounts.matched}</div>
          <div className="stat-sub">{fmtDelta(diff.delta.matched)} vs. vorher ({diff.oldCounts.matched})</div>
        </div>
        <div className="stat-card accent-red" style={{ padding: '0.75rem 1rem' }}>
          <div className="stat-label" style={{ fontSize: '0.7rem' }}>✗ Kein Essen gebucht</div>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{diff.newCounts.nur_in_a}</div>
          <div className="stat-sub">{fmtDelta(diff.delta.nur_in_a)} vs. vorher ({diff.oldCounts.nur_in_a})</div>
        </div>
        <div className="stat-card accent-orange" style={{ padding: '0.75rem 1rem' }}>
          <div className="stat-label" style={{ fontSize: '0.7rem' }}>⚠ Nicht angemeldet</div>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{diff.newCounts.nur_in_b}</div>
          <div className="stat-sub">{fmtDelta(diff.delta.nur_in_b)} vs. vorher ({diff.oldCounts.nur_in_b})</div>
        </div>
        <div className="stat-card" style={{ padding: '0.75rem 1rem' }}>
          <div className="stat-label" style={{ fontSize: '0.7rem' }}>✅ Neu gelöst</div>
          <div className="stat-value" style={{ fontSize: '1.5rem', color: 'var(--success)' }}>{diff.neuGeloest.length}</div>
          <div className="stat-sub">Vorher fehlend, jetzt OK</div>
        </div>
      </div>

      {/* Hinweis wenn Detail-Zuordnung unvollständig (fehlende Namen im alten Abgleich) */}
      {diff.oldOhneNamen > 0 && (
        <div style={{
          background: 'rgba(230,168,23,0.08)', borderRadius: '0.5rem', padding: '0.6rem 1rem',
          fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '1rem',
          borderLeft: '3px solid var(--warning)'
        }}>
          ⚠ Der ältere Abgleich hat <strong>{diff.oldOhneNamen} Einträge ohne gespeicherte Namen</strong> — die Detail-Zuordnung (wer genau gewonnen/verloren hat) ist daher unvollständig.
          <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.78rem' }}>
            Tipp: Vergleiche nur Abgleiche die nach der letzten Migration erstellt wurden.
          </span>
        </div>
      )}

      {/* Steuerung */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn btn-sm ${groupBy === 'kind' ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }}
          onClick={() => setGroupBy('kind')}>Nach Kind</button>
        <button className={`btn btn-sm ${groupBy === 'tag' ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }}
          onClick={() => setGroupBy('tag')}>Nach Tag</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={exportDiffExcel}>📊 Excel exportieren</button>
      </div>

      {/* Detail-Sektionen */}
      {sections.map(sec => {
        if (!sec.items.length) return null;

        const cardStyle = sec.changed
          ? { marginBottom: '1rem', borderLeft: `4px solid ${sec.border}` }
          : { marginBottom: '1rem', opacity: 0.75 };

        if (groupBy === 'kind') {
          const grouped = groupByKindFn(sec.items, sec.getMatch);
          return (
            <div key={sec.key} className="card" style={cardStyle}>
              <div className="card-title">{sec.icon} {sec.title} <span className={`badge ${sec.badge}`} style={{ marginLeft: '0.5rem' }}>{grouped.length} Kinder · {sec.items.length} Tage</span></div>
              {sec.changed && <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>{sec.desc}</p>}
              <div className="table-wrap"><table>
                <thead><tr><th>#</th><th>Nachname</th><th>Vorname</th><th>Klasse</th>{sec.showStatus && <th>Status</th>}<th>Tage</th><th>Daten</th></tr></thead>
                <tbody>{grouped.map((k, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><strong>{k.nachname}</strong></td><td>{k.vorname}</td><td>{k.klasse || '–'}</td>
                    {sec.showStatus && <td><StatusBadge statuses={k.statuses} /></td>}
                    <td><span className={`badge ${sec.badge}`}>{k.dates.length}</span></td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          );
        } else {
          const grouped = groupByTagFn(sec.items, sec.getMatch);
          return (
            <div key={sec.key} className="card" style={cardStyle}>
              <div className="card-title">{sec.icon} {sec.title} <span className={`badge ${sec.badge}`} style={{ marginLeft: '0.5rem' }}>{grouped.length} Tage · {sec.items.length} Einträge</span></div>
              {sec.changed && <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>{sec.desc}</p>}
              <div className="table-wrap"><table>
                <thead><tr><th>Tag</th><th>Datum</th>{sec.showStatus && <th>Status</th>}<th>Kinder</th><th>Namen</th></tr></thead>
                <tbody>{grouped.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{(() => { try { return new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short' }); } catch { return ''; } })()}</strong>
                    </td>
                    <td>{fmtDate(d.date)}</td>
                    {sec.showStatus && <td><StatusBadge statuses={d.statuses} /></td>}
                    <td><span className={`badge ${sec.badge}`}>{d.kinder.length}</span></td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{d.kinder.sort().join(', ')}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          );
        }
      })}

      {/* Keine Änderungen */}
      {diff.neuGeloest.length === 0 && diff.neuFehlend.length === 0
        && diff.neueEintraege.length === 0 && diff.unveraendertFehlend.length === 0
        && diff.entfallen.length === 0 && diff.delta.matched === 0
        && diff.delta.nur_in_a === 0 && diff.delta.nur_in_b === 0 && (
          <div className="card"><div className="empty-state">
            <div className="icon">✅</div><p>Keine Veränderungen zwischen den beiden Abgleichen.</p>
          </div></div>
        )}
    </div>
  );
};

export default VergleichView;
