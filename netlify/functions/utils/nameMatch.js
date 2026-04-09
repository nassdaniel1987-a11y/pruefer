// CommonJS-Version der Matching-Funktionen (identisch zu src/utils/matching.js)
// Wird von netlify/functions/kinder.js für Fuzzy-Sync verwendet.

const nicknames = { 'alex': 'alexander', 'sandra': 'alexandra', 'max': 'maximilian', 'hans': 'johannes', 'chris': 'christoph', 'sepp': 'josef', 'joe': 'josef', 'jörg': 'georg', 'joerg': 'georg' };

const tokenizeName = (name) => {
  if (typeof name !== 'string') return [];
  const stop = ['dr', 'von', 'van', 'de', 'und'];
  let n = name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ');
  return n.split(/\s+/).map(p => nicknames[p] || p).filter(t => t && !stop.includes(t));
};

const koelnerPhonetik = (word) => {
  if (!word) return '';
  const map = { a: 0, e: 0, i: 0, j: 0, o: 0, u: 0, y: 0, b: 1, p: 1, d: 2, t: 2, f: 3, v: 3, w: 3, g: 4, k: 4, q: 4, c: 4, x: 48, l: 5, m: 6, n: 6, r: 7, s: 8, z: 8, ß: 8, h: '.' };
  word = word.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
  let last = null, res = '';
  for (let i = 0; i < word.length; i++) {
    let ch = word[i], code;
    if (ch === 'c' && i === 0 && 'ahkloqrux'.includes(word[i + 1])) code = 4;
    else if (ch === 'c' && 'sz'.includes(word[i - 1])) code = 8;
    else if ('dt'.includes(ch) && 'csz'.includes(word[i + 1])) code = 8;
    else code = map[ch];
    if (code && code !== last && code !== '.') res += code;
    last = code === '.' ? last : code;
  }
  return res;
};

const jaroWinkler = (s1, s2) => {
  if (s1 === s2) return 1;
  let m = 0, range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  let m1 = new Array(s1.length).fill(false), m2 = new Array(s2.length).fill(false);
  for (let i = 0; i < s1.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(i + range + 1, s2.length); j++) {
      if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let k = 0, t = 0;
  for (let i = 0; i < s1.length; i++) { if (m1[i]) { while (!m2[k]) k++; if (s1[i] !== s2[k]) t++; k++; } }
  t /= 2;
  let jaro = (m / s1.length + m / s2.length + (m - t) / m) / 3;
  let l = 0; while (l < 4 && s1[l] === s2[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
};

const calcScore = (nameA, nameB) => {
  const tA = tokenizeName(nameA), tB = tokenizeName(nameB);
  if (!tA.length || !tB.length) return { score: 0, reason: 'Leerer Name' };
  const lastA = tA[tA.length - 1], lastB = tB[tB.length - 1];
  const lastJW = jaroWinkler(lastA, lastB);
  const lastPH = koelnerPhonetik(lastA) === koelnerPhonetik(lastB) && koelnerPhonetik(lastA).length > 1;
  const nachnameOk = lastJW >= 0.82 || lastPH;
  let matches = [], avail = [...tB];
  for (const a of tA) {
    let best = { score: 0, partner: null, idx: -1 };
    for (let i = 0; i < avail.length; i++) {
      const jw = jaroWinkler(a, avail[i]) * 100;
      const phMatch = koelnerPhonetik(a) === koelnerPhonetik(avail[i]) && koelnerPhonetik(a).length > 1;
      const ph = (phMatch && jw >= 65) ? 70 : 0;
      const s = Math.max(jw > 85 ? jw : 0, ph);
      if (s > best.score) best = { score: s, partner: avail[i], idx: i };
    }
    if (best.partner) { matches.push(best.score); avail.splice(best.idx, 1); }
  }
  if (!matches.length) return { score: 0, reason: 'Keine Übereinstimmung' };
  const avg = matches.reduce((a, b) => a + b, 0) / matches.length;
  const minTokens = Math.min(tA.length, tB.length);
  const maxTokens = Math.max(tA.length, tB.length);
  const missingInShorter = minTokens - matches.length;
  const extraInLonger = maxTokens - matches.length - missingInShorter;
  const penalty = (missingInShorter * 40) + (extraInLonger * 10);
  const coverageRatio = matches.length / maxTokens;
  const coveragePenalty = coverageRatio < 0.5 ? 0.5 : 1;
  let score = Math.max(0, Math.round((avg - penalty) * coveragePenalty));
  if (!nachnameOk) { score = Math.min(score, 40); }
  return { score };
};

module.exports = { tokenizeName, koelnerPhonetik, jaroWinkler, calcScore };
