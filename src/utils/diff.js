// computeDiff extracted from App.jsx

const computeDiff = (matchesOld, matchesNew) => {
  if (!matchesOld || !matchesNew) return null;

  // Normalisierung: Kommas, Punkte, Extra-Leerzeichen entfernen
  // damit "Elif, Acar" und "Elif Acar" denselben Key ergeben
  const norm = (s) => (s || '').replace(/[,.\-;:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const makeKeyA = (m) => (norm(m.a_vorname) + '|' + norm(m.a_nachname) + '|' + String(m.a_datum || '').split('T')[0]);
  const hasName = (m) => !!(m.a_nachname || m.a_vorname || m.b_nachname || m.b_vorname);

  // Ein Durchlauf pro Array: Maps + Zähler gleichzeitig
  const oldMapA = new Map();
  const oldCounts = { matched: 0, nur_in_a: 0, nur_in_b: 0 };
  let oldOhneNamen = 0;
  for (const m of matchesOld) {
    const typ = m.match_typ;
    if (typ === 'exact' || typ === 'fuzzy_accepted') oldCounts.matched++;
    else if (typ === 'nur_in_a') oldCounts.nur_in_a++;
    else if (typ === 'nur_in_b') oldCounts.nur_in_b++;
    if (typ !== 'nur_in_b' && hasName(m)) oldMapA.set(makeKeyA(m), m);
    if (typ !== 'nur_in_b' && !hasName(m)) oldOhneNamen++;
  }

  const newMapA = new Map();
  const newCounts = { matched: 0, nur_in_a: 0, nur_in_b: 0 };
  let newOhneNamen = 0;
  for (const m of matchesNew) {
    const typ = m.match_typ;
    if (typ === 'exact' || typ === 'fuzzy_accepted') newCounts.matched++;
    else if (typ === 'nur_in_a') newCounts.nur_in_a++;
    else if (typ === 'nur_in_b') newCounts.nur_in_b++;
    if (typ !== 'nur_in_b' && hasName(m)) newMapA.set(makeKeyA(m), m);
    if (typ !== 'nur_in_b' && !hasName(m)) newOhneNamen++;
  }

  const isMatched = (m) => m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted';
  const isMissing = (m) => m.match_typ === 'nur_in_a';

  const neuGeloest = [], neuFehlend = [], unveraendertFehlend = [], unveraendertOk = [];
  const neueEintraege = [], entfallen = [];

  // Vorwärts: neue Einträge prüfen gegen alte
  for (const [key, nw] of newMapA) {
    const old = oldMapA.get(key);
    if (!old) {
      neueEintraege.push({ match: nw, status: isMatched(nw) ? 'matched' : isMissing(nw) ? 'missing' : 'other' });
    } else if (isMissing(old) && isMatched(nw)) {
      neuGeloest.push({ old, neu: nw });
    } else if (isMatched(old) && isMissing(nw)) {
      neuFehlend.push({ old, neu: nw });
    } else if (isMissing(old) && isMissing(nw)) {
      unveraendertFehlend.push({ old, neu: nw });
    } else if (isMatched(old) && isMatched(nw)) {
      unveraendertOk.push({ old, neu: nw });
    }
  }

  // Rückwärts: alte Einträge die im neuen fehlen
  for (const [key, old] of oldMapA) {
    if (!newMapA.has(key)) {
      entfallen.push({ match: old, status: isMatched(old) ? 'matched' : isMissing(old) ? 'missing' : 'other' });
    }
  }

  const delta = {
    matched: newCounts.matched - oldCounts.matched,
    nur_in_a: newCounts.nur_in_a - oldCounts.nur_in_a,
    nur_in_b: newCounts.nur_in_b - oldCounts.nur_in_b,
  };

  return {
    neuGeloest, neuFehlend, unveraendertFehlend, unveraendertOk, neueEintraege, entfallen,
    oldCounts, newCounts, delta, oldOhneNamen, newOhneNamen,
  };
};

export { computeDiff };
