// Baut den täglichen Abgleich-Bericht als HTML und als Text.
//
// Der Bericht geht auch dann raus, wenn es nichts zu melden gibt — sonst lässt
// sich "heute war alles in Ordnung" nicht von "die Automatik läuft seit drei
// Wochen nicht mehr" unterscheiden.

const { proKind } = require('./vergleich');

const fmtDatum = (ymd) => {
  if (!ymd) return '';
  const [j, m, t] = String(ymd).split('-');
  return `${t}.${m}.${j}`;
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const tabelle = (kinder) => {
  if (kinder.length === 0) return '<p style="color:#666;margin:4px 0 16px">Keine.</p>';
  const zeilen = kinder.map(k => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(k.name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666">${esc(k.klasse || '—')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666">${k.tage.map(fmtDatum).join(', ')}</td>
    </tr>`).join('');
  return `
  <table style="border-collapse:collapse;width:100%;margin:4px 0 20px;font-size:14px">
    <thead>
      <tr style="text-align:left;background:#f5f5f7">
        <th style="padding:6px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#555">Name</th>
        <th style="padding:6px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#555">Klasse</th>
        <th style="padding:6px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#555">Tage</th>
      </tr>
    </thead>
    <tbody>${zeilen}</tbody>
  </table>`;
};

const textListe = (kinder) => {
  if (kinder.length === 0) return '  Keine.\n';
  return kinder.map(k =>
    `  - ${k.name}${k.klasse ? ` (Kl. ${k.klasse})` : ''}: ${k.tage.map(fmtDatum).join(', ')}\n`
  ).join('');
};

/**
 * @param {{block:Object, ergebnis:Object, appUrl:string, fokus?:string}} opts
 *   fokus — Tag, auf den sich der Bericht beschränkt (Standard: ergebnis.heute).
 *   Der Abgleich umfasst immer den ganzen Block; die Mail zeigt bewusst nur
 *   diesen einen Tag, sonst stünden dieselben Einträge wochenlang darin.
 * @returns {{betreff:string, html:string, text:string}}
 */
const baueBericht = ({ block, ergebnis, appUrl, fokus }) => {
  const k = ergebnis.kennzahlen;
  const tag = fokus || ergebnis.heute;

  const nurHeute = (eintraege) => eintraege.filter(e => e.date === tag);

  const fehltEssen = proKind(nurHeute(ergebnis.nurInA));
  const nichtAngemeldet = proKind(nurHeute(ergebnis.nurInB));
  const unsicher = (ergebnis.unsicher || []).filter(u => u.tage.includes(tag));

  // Gesamtstand des Blocks als Einordnung — sonst sieht man nicht, ob es
  // insgesamt viele offene Fälle gibt oder nur heute zufällig keine.
  const restBlock = {
    ohneEssen: proKind(ergebnis.nurInA).length,
    nichtAngemeldet: proKind(ergebnis.nurInB).length,
  };

  const ohneBefund = fehltEssen.length === 0 && nichtAngemeldet.length === 0 && unsicher.length === 0;

  const betreff = ohneBefund
    ? `Prüfer ${fmtDatum(tag)}: keine Abweichungen`
    : `Prüfer ${fmtDatum(tag)}: ${fehltEssen.length} ohne Essen, ${nichtAngemeldet.length} nicht angemeldet`;

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;color:#1c1b1f">
  <h2 style="margin:0 0 4px">${fmtDatum(tag)} — ${esc(block.name)}</h2>
  <p style="margin:0 0 16px;color:#666;font-size:14px">
    Abweichungen für diesen Tag. Der Abgleich umfasst den ganzen Block
    (${fmtDatum(ergebnis.von)} – ${fmtDatum(ergebnis.bis)}).
  </p>

  <div style="background:#f5f5f7;border-radius:10px;padding:12px 16px;margin-bottom:24px;font-size:14px">
    <strong>Ganzer Block:</strong>
    ${k.kinderA} Kinder angemeldet · ${k.kinderB} mit Essen ·
    ${restBlock.ohneEssen} offene Fälle ohne Essen · ${restBlock.nichtAngemeldet} nicht angemeldet
  </div>

  ${ohneBefund ? `<p style="font-size:15px">Für den ${fmtDatum(tag)} gibt es keine Abweichungen. Alle Anmeldungen haben eine passende Essensbuchung.</p>` : ''}

  <h3 style="margin:0 0 2px;font-size:15px">Angemeldet, aber kein Essen gebucht (${fehltEssen.length})</h3>
  ${tabelle(fehltEssen)}

  <h3 style="margin:0 0 2px;font-size:15px">Essen gebucht, aber nicht angemeldet (${nichtAngemeldet.length})</h3>
  ${tabelle(nichtAngemeldet)}

  ${unsicher.length > 0 ? `
  <h3 style="margin:0 0 2px;font-size:15px">Unsicher — bitte prüfen (${unsicher.length})</h3>
  <p style="color:#666;font-size:13px;margin:0 0 8px">
    Diese Namenspaare ähneln sich, wurden aber nicht automatisch zugeordnet.
    Sie erscheinen deshalb oben in beiden Listen.
  </p>
  <table style="border-collapse:collapse;width:100%;margin:4px 0 20px;font-size:14px">
    <thead><tr style="text-align:left;background:#fff4e5">
      <th style="padding:6px 10px;font-size:12px;color:#8a5a00">Liste A</th>
      <th style="padding:6px 10px;font-size:12px;color:#8a5a00">Liste B</th>
      <th style="padding:6px 10px;font-size:12px;color:#8a5a00">Punkte</th>
      <th style="padding:6px 10px;font-size:12px;color:#8a5a00">Tage</th>
    </tr></thead>
    <tbody>${unsicher.map(u => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(u.nameA)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(u.nameB)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${u.score}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666">${u.tage.map(fmtDatum).join(', ')}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}

  <p style="margin-top:28px">
    <a href="${esc(appUrl)}/abgleich" style="background:#5a598b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;display:inline-block">Im Abgleich-Tool öffnen</a>
  </p>
  <p style="color:#999;font-size:12px;margin-top:24px">
    Automatisch erstellt von Prüfer. Abschaltbar unter Einstellungen → Automatischer Abgleich.
  </p>
</div>`.trim();

  const text = [
    `${fmtDatum(tag)} - ${block.name}`,
    `Abweichungen fuer diesen Tag. Abgleich umfasst ${fmtDatum(ergebnis.von)} - ${fmtDatum(ergebnis.bis)}.`,
    '',
    `Ganzer Block: ${k.kinderA} Kinder angemeldet, ${k.kinderB} mit Essen, ${restBlock.ohneEssen} offene Faelle ohne Essen, ${restBlock.nichtAngemeldet} nicht angemeldet`,
    '',
    `ANGEMELDET, ABER KEIN ESSEN GEBUCHT (${fehltEssen.length})`,
    textListe(fehltEssen),
    `ESSEN GEBUCHT, ABER NICHT ANGEMELDET (${nichtAngemeldet.length})`,
    textListe(nichtAngemeldet),
    ...(unsicher.length > 0 ? [
      `UNSICHER - BITTE PRUEFEN (${unsicher.length})`,
      unsicher.map(u => `  - "${u.nameA}" <-> "${u.nameB}" (${u.score} Punkte): ${u.tage.map(fmtDatum).join(', ')}\n`).join(''),
    ] : []),
    `${appUrl}/abgleich`,
  ].join('\n');

  return { betreff, html, text };
};

module.exports = { baueBericht };
