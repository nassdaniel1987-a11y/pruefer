// Serverseitiger Abgleich von Liste A gegen Liste B.
//
// Nachbau von runComparison und dem Zeilenbau aus saveAbgleich in
// src/components/AbgleichTool.jsx. Die Oberfläche bleibt der Ort, an dem ein
// Mensch unsichere Paare entscheidet — dieses Modul ist für den automatischen
// Lauf, der genau das nicht kann.
//
// Entscheidende Festlegung: automatisch zugeordnet wird nur ab
// STRONG_MATCH_THRESHOLD (75). Paare zwischen 60 und 74 werden *nicht*
// zugeordnet, sondern als "unsicher" zurückgegeben, damit der Bericht sie
// gesondert ausweisen kann. So wird niemand fälschlich als fehlend gemeldet,
// ohne dass zwei verschiedene Kinder zusammengelegt werden.

const { calcScore, tokenizeName } = require('./nameMatch');
const { toYmd } = require('./datum');

const STRONG_MATCH_THRESHOLD = 75;
const REVIEW_MATCH_THRESHOLD = 60;

const firstNameToken = (name) => tokenizeName(name)[0] || '';

const hasSameFirstName = (nameA, nameB) => {
  const a = firstNameToken(nameA);
  const b = firstNameToken(nameB);
  return a.length >= 3 && a === b;
};

// Datenbankzeile -> Vergleichseintrag. Der Name wird wie im Frontend als
// "Vorname Nachname" zusammengesetzt, weil darauf die Exakttreffer beruhen.
const zuEintrag = (zeile) => ({
  dbId: zeile.id,
  name: [zeile.vorname, zeile.nachname].filter(Boolean).join(' ').trim(),
  nachname: zeile.nachname,
  vorname: zeile.vorname || '',
  klasse: zeile.klasse || '',
  date: toYmd(zeile.datum),
});

/**
 * Vergleicht zwei Listen.
 *
 * @param {Array} zeilenA — Zeilen aus liste_a
 * @param {Array} zeilenB — Zeilen aus liste_b
 * @returns {{matchRows:Array, nurInA:Array, nurInB:Array, unsicher:Array, kennzahlen:Object}}
 */
const vergleiche = (zeilenA, zeilenB) => {
  const listA = zeilenA.map(zuEintrag);
  const listB = zeilenB.map(zuEintrag);

  const schluessel = (e) => `${e.name}|${e.date}`;

  // ── Exakttreffer ──
  const mapB = new Map(listB.map(i => [schluessel(i), i]));
  const mapA = new Map(listA.map(i => [schluessel(i), i]));
  const exactA = listA.filter(e => mapB.has(schluessel(e)));
  const nonA = listA.filter(e => !mapB.has(schluessel(e)));
  const nonB = listB.filter(e => !mapA.has(schluessel(e)));

  // ── Fuzzy-Kandidaten, nur innerhalb desselben Tages ──
  const byDate = nonB.reduce((acc, i) => { (acc[i.date] = acc[i.date] || []).push(i); return acc; }, {});
  const gruppen = {};

  for (const eA of nonA) {
    for (const eB of (byDate[eA.date] || [])) {
      const { score, reason } = calcScore(eA.name, eB.name);

      // Auch den vertauschten B-Namen testen, falls Vor- und Nachname in
      // Liste B in umgekehrter Reihenfolge stehen.
      const tB = tokenizeName(eB.name);
      const eBswapped = tB.length >= 2 ? tB.slice().reverse().join(' ') : eB.name;
      const { score: scoreSwapped, reason: reasonSwapped } = calcScore(eA.name, eBswapped);

      const swappedIsBetter = scoreSwapped > score;
      const bestScore = Math.max(score, scoreSwapped);
      const sameFirstName = hasSameFirstName(eA.name, eB.name)
        || (swappedIsBetter && hasSameFirstName(eA.name, eBswapped));
      const isStrong = bestScore >= STRONG_MATCH_THRESHOLD;
      const isReview = sameFirstName && bestScore >= REVIEW_MATCH_THRESHOLD;

      const grundBasis = swappedIsBetter ? reasonSwapped : reason;
      const grund = isReview && !isStrong
        ? `${grundBasis}; gleicher Vorname - bitte manuell prüfen`
        : grundBasis;

      if (isStrong || isReview) {
        const key = `${eA.name.toLowerCase()}|||${eB.name.toLowerCase()}`;
        if (!gruppen[key]) {
          gruppen[key] = { nameA: eA.name, nameB: eB.name, score: bestScore, grund, stark: isStrong, paare: [] };
        }
        gruppen[key].paare.push({ a: eA, b: eB });
      }
    }
  }

  const alleGruppen = Object.values(gruppen).sort((x, y) => y.score - x.score);
  const starke = alleGruppen.filter(g => g.stark);
  const unsichere = alleGruppen.filter(g => !g.stark);

  // ── Zeilen für abgleich_matches ──
  const matchRows = [];
  const zugeordnetA = new Set();
  const zugeordnetB = new Set();

  for (const eA of exactA) {
    const eB = mapB.get(schluessel(eA));
    matchRows.push({
      liste_a_id: eA.dbId, liste_b_id: eB.dbId,
      match_typ: 'exact', score: 100, grund: 'Exakte Übereinstimmung'
    });
    zugeordnetA.add(eA.dbId);
    zugeordnetB.add(eB.dbId);
  }

  // Nur starke Treffer werden automatisch übernommen. Ein Eintrag darf dabei
  // nur einmal zugeordnet werden — sonst zählt ein Kind doppelt, wenn zwei
  // Gruppen auf denselben Eintrag zeigen.
  for (const g of starke) {
    for (const paar of g.paare) {
      if (zugeordnetA.has(paar.a.dbId) || zugeordnetB.has(paar.b.dbId)) continue;
      matchRows.push({
        liste_a_id: paar.a.dbId, liste_b_id: paar.b.dbId,
        match_typ: 'fuzzy_accepted', score: g.score, grund: g.grund
      });
      zugeordnetA.add(paar.a.dbId);
      zugeordnetB.add(paar.b.dbId);
    }
  }

  const nurInA = listA.filter(e => !zugeordnetA.has(e.dbId));
  const nurInB = listB.filter(e => !zugeordnetB.has(e.dbId));

  for (const e of nurInA) {
    matchRows.push({
      liste_a_id: e.dbId, liste_b_id: null,
      match_typ: 'nur_in_a', score: null, grund: 'Keine Entsprechung in Liste B gefunden'
    });
  }
  for (const e of nurInB) {
    matchRows.push({
      liste_a_id: null, liste_b_id: e.dbId,
      match_typ: 'nur_in_b', score: null, grund: 'Nicht in Liste A vorhanden'
    });
  }

  // Unsichere Paare für den Bericht — bewusst nur die, deren Einträge
  // tatsächlich unzugeordnet geblieben sind.
  const unsicher = [];
  for (const g of unsichere) {
    const offen = g.paare.filter(p => !zugeordnetA.has(p.a.dbId) && !zugeordnetB.has(p.b.dbId));
    if (offen.length === 0) continue;
    unsicher.push({
      nameA: g.nameA,
      nameB: g.nameB,
      score: g.score,
      grund: g.grund,
      tage: [...new Set(offen.map(p => p.a.date))].sort(),
    });
  }

  const eindeutig = (liste) => new Set(liste.map(e => e.name.toLowerCase())).size;

  return {
    matchRows,
    nurInA,
    nurInB,
    unsicher,
    kennzahlen: {
      eintraegeA: listA.length,
      eintraegeB: listB.length,
      kinderA: eindeutig(listA),
      kinderB: eindeutig(listB),
      exakt: exactA.length,
      automatisch: matchRows.filter(m => m.match_typ === 'fuzzy_accepted').length,
      nurInA: nurInA.length,
      nurInB: nurInB.length,
      unsicher: unsicher.length,
    },
  };
};

// Fasst Einträge pro Kind zusammen, damit der Bericht nicht jede Zeile
// einzeln auflistet, sondern "Hans Müller — 11.08., 12.08.".
const proKind = (eintraege) => {
  const map = new Map();
  for (const e of eintraege) {
    const key = e.name.toLowerCase();
    if (!map.has(key)) map.set(key, { name: e.name, klasse: e.klasse, tage: [] });
    map.get(key).tage.push(e.date);
    if (!map.get(key).klasse && e.klasse) map.get(key).klasse = e.klasse;
  }
  return [...map.values()]
    .map(k => ({ ...k, tage: [...new Set(k.tage)].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
};

module.exports = { vergleiche, proKind, STRONG_MATCH_THRESHOLD, REVIEW_MATCH_THRESHOLD };
