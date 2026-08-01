// Einheitliche Datumsbehandlung für die Netlify Functions.
//
// Hintergrund: node-postgres liefert DATE-Spalten als JS-Date-Objekt zu
// *lokaler* Mitternacht. Beide bisher im Code verwendeten Varianten sind
// deshalb falsch:
//
//   String(datum).split('T')[0]
//     -> "" , weil String(date) mit "Tue May 26 2026 …" beginnt und schon
//        das erste Zeichen ein 'T' ist
//
//   datum.toISOString().split('T')[0]
//     -> ein Tag zu früh, weil toISOString nach UTC umrechnet und
//        Deutschland +1/+2 liegt: aus dem 26.05. wird der 25.05.
//
// toYmd() liest deshalb die *lokalen* Datumsteile aus und verkraftet
// zusätzlich Strings (z.B. ISO-Werte aus dem Request-Body).

const ymdAusDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Liefert 'YYYY-MM-DD' oder null, wenn sich nichts Sinnvolles ergibt.
const toYmd = (wert) => {
  if (wert === null || wert === undefined || wert === '') return null;
  if (wert instanceof Date) return isNaN(wert) ? null : ymdAusDate(wert);

  const s = String(wert);
  // Bereits 'YYYY-MM-DD' oder ein ISO-Zeitstempel: vorderen Teil übernehmen,
  // ohne über eine Zeitzonen-Umrechnung zu gehen.
  const treffer = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (treffer) return treffer[0];

  const geparst = new Date(s);
  return isNaN(geparst) ? null : ymdAusDate(geparst);
};

module.exports = { toYmd };
