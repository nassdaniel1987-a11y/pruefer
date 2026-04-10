import { fmtDate } from './helpers';

const printFehlendeKinder = (title, kinder, blockName) => {
  // kinder = Array von { nachname, vorname, klasse, dates: ['2025-07-01',...] }
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const totalTage = kinder.reduce((s, k) => s + (k.dates ? k.dates.length : 0), 0);

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10pt; margin: 1.5cm; color: #222; }
  h1 { font-size: 14pt; margin-bottom: 4px; }
  .meta { font-size: 9pt; color: #666; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f0f0f0; font-weight: bold; text-align: left; padding: 5px 6px; border: 1px solid #ccc; font-size: 9pt; }
  td { padding: 4px 6px; border: 1px solid #ddd; font-size: 9pt; }
  tr:nth-child(even) { background: #fafafa; }
  .badge-red { background: #fee; color: #c00; padding: 1px 6px; border-radius: 3px; font-weight: bold; }
  .summary { margin-top: 12px; font-size: 9pt; color: #666; border-top: 1px solid #ddd; padding-top: 6px; }
  .legende { margin-top: 16px; font-size: 8.5pt; color: #555; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; background: #f9f9f9; }
  @media print { @page { margin: 1.5cm; } }
</style></head><body>
<h1>${title}</h1>
<div class="meta">${blockName ? 'Ferienblock: ' + blockName + ' · ' : ''}Erstellt: ${dateStr} ${timeStr} · ${kinder.length} Kinder · ${totalTage} Tage</div>
<table><thead><tr><th>#</th><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Tage</th><th>Daten</th></tr></thead><tbody>`;

  kinder.forEach((k, i) => {
    html += `<tr><td>${i + 1}</td><td><b>${k.nachname || ''}</b></td><td>${k.vorname || ''}</td><td>${k.klasse || '–'}</td>`;
    html += `<td><span class="badge-red">${k.dates ? k.dates.length : 0}</span></td>`;
    html += `<td>${k.dates ? k.dates.sort().map(d => fmtDate(d)).join(', ') : ''}</td></tr>`;
  });

  const isNurB = title.toLowerCase().includes('nicht angemeldet');
  const legendeText = isNurB
    ? `<b>Essen gebucht — nicht angemeldet:</b> Diese Kinder haben eine Essens-Buchung beim Caterer (Liste B), sind aber <b>nicht</b> in der Ferienanmeldungsliste (Liste A) eingetragen. Bitte prüfen, ob eine Anmeldung fehlt oder ob die Buchung storniert werden muss.`
    : `<b>Kein Essen gebucht:</b> Diese Kinder sind in der Ferienanmeldungsliste (Liste A) eingetragen, haben aber <b>keine</b> Essens-Buchung beim Caterer (Liste B). Bitte prüfen, ob die Buchung noch nachgeholt werden muss.`;

  html += `</tbody></table>
<div class="summary">Gesamtzahl: ${kinder.length} Kinder · ${totalTage} Tage</div>
<div class="legende"><b>Legende:</b> ${legendeText}<br><br>
  <b>#</b> = Laufende Nummer &nbsp;|&nbsp;
  <b>Klasse</b> = Schulklasse des Kindes &nbsp;|&nbsp;
  <b>Tage</b> = Anzahl betroffener Tage &nbsp;|&nbsp;
  <b>Daten</b> = Genaue Termine
</div>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
};

export { printFehlendeKinder };
