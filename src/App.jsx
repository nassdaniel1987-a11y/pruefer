import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';

// ─── TOAST SYSTEM ─────────────────────────────────────
let _toastListeners = [];
const toast = {
  _list: [],
  _notify() { _toastListeners.forEach(fn => fn([...this._list])); },
  show(msg, type = 'info', duration = 4000) {
    const id = Date.now() + Math.random();
    this._list.push({ id, msg, type });
    this._notify();
    setTimeout(() => { this._list = this._list.filter(t => t.id !== id); this._notify(); }, duration);
  },
  error(msg) { this.show(msg, 'error', 6000); },
  success(msg) { this.show(msg, 'success', 3000); },
  info(msg) { this.show(msg, 'info', 4000); },
  warn(msg) { this.show(msg, 'warning', 5000); },
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);
  useEffect(() => { _toastListeners.push(setToasts); return () => { _toastListeners = _toastListeners.filter(f => f !== setToasts); }; }, []);
  if (!toasts.length) return null;
  return React.createElement('div', { className: 'toast-container' },
    toasts.map(t => React.createElement('div', { key: t.id, className: `toast toast-${t.type}` }, t.msg))
  );
};

// ─── CONFIRM DIALOG ───────────────────────────────────
let _confirmResolver = null;
let _confirmState = null;
let _confirmListeners = [];
const confirmDialog = (title, message, dangerLabel = 'Löschen') => {
  return new Promise(resolve => {
    _confirmResolver = resolve;
    _confirmState = { title, message, dangerLabel };
    _confirmListeners.forEach(fn => fn({ ..._confirmState }));
  });
};
const ConfirmDialog = () => {
  const [state, setState] = useState(null);
  useEffect(() => { _confirmListeners.push(setState); return () => { _confirmListeners = _confirmListeners.filter(f => f !== setState); }; }, []);
  if (!state) return null;
  const close = (val) => { setState(null); _confirmState = null; if (_confirmResolver) { _confirmResolver(val); _confirmResolver = null; } };
  return (
    <div className="confirm-overlay" onClick={() => close(false)}>
      <div className="confirm-box" onClick={e => e.stopPropagation()}>
        <h3>{state.title}</h3>
        <p>{state.message}</p>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={() => close(false)}>Abbrechen</button>
          <button className="btn btn-danger" style={{ width: 'auto' }} onClick={() => close(true)}>{state.dangerLabel}</button>
        </div>
      </div>
    </div>
  );
};

// ─── API ───────────────────────────────────────────────
const API = {
  base: '/.netlify/functions',
  token: () => localStorage.getItem('token'),

  headers() {
    const h = { 'Content-Type': 'application/json' };
    const t = this.token();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  },

  async _fetch(url, opts) {
    try {
      const r = await fetch(url, opts);
      const data = await r.json();
      if (!r.ok) {
        const msg = data.error || `Fehler ${r.status}`;
        if (r.status === 401) {
          localStorage.removeItem('token');
          window.location.reload();
          return data;
        }
        toast.error(msg);
        return data;
      }
      return data;
    } catch (err) {
      toast.error('Verbindungsfehler — bitte prüfe deine Internetverbindung');
      console.error('API Error:', err);
      return { error: err.message };
    }
  },

  async post(fn, body) {
    return this._fetch(`${this.base}/${fn}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
  },
  async get(fn, params = {}) {
    const q = new URLSearchParams(params).toString();
    return this._fetch(`${this.base}/${fn}${q ? '?' + q : ''}`, { headers: this.headers() });
  },
  async put(fn, body) {
    return this._fetch(`${this.base}/${fn}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) });
  }
};

// ─── DRUCKANSICHT ─────────────────────────────────────
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

  html += `</tbody></table>
<div class="summary">Gesamtzahl fehlender Kinder: ${kinder.length} · Gesamtzahl fehlender Tage: ${totalTage}</div>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
};

// ─── MATCHING-ALGORITHMEN (aus Originalversion) ────────
const nicknames = { 'alex': 'alexander', 'sandra': 'alexandra', 'max': 'maximilian', 'hans': 'johannes', 'chris': 'christoph', 'sepp': 'josef', 'joe': 'josef', 'jörg': 'georg', 'joerg': 'georg' };
const tokenizeName = (name) => {
  if (typeof name !== 'string') return [];
  const stop = ['dr', 'von', 'van', 'de', 'und'];
  let n = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ');
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

  // Nachname ist der letzte Token — dieser MUSS gut passen
  const lastA = tA[tA.length - 1], lastB = tB[tB.length - 1];
  const lastJW = jaroWinkler(lastA, lastB);
  const lastPH = koelnerPhonetik(lastA) === koelnerPhonetik(lastB) && koelnerPhonetik(lastA).length > 1;
  const nachnameOk = lastJW >= 0.82 || lastPH;

  let matches = [], avail = [...tB];
  for (const a of tA) {
    let best = { score: 0, partner: null, idx: -1 };
    for (let i = 0; i < avail.length; i++) {
      const jw = jaroWinkler(a, avail[i]) * 100;
      // Phonetik nur als Bonus wenn die Strings auch textlich einigermaßen ähnlich sind (JW >= 65%)
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
  // Stärkere Bestrafung für ungematchte Teile (40 statt 30)
  const penalty = (missingInShorter * 40) + (extraInLonger * 10);
  // Wenn weniger als die Hälfte der Tokens gematcht → Score halbieren
  const coverageRatio = matches.length / maxTokens;
  const coveragePenalty = coverageRatio < 0.5 ? 0.5 : 1;
  let score = Math.max(0, Math.round((avg - penalty) * coveragePenalty));

  // Wenn Nachname nicht passt → Score auf max 40 deckeln (wird nie zum Vorschlag)
  if (!nachnameOk) {
    score = Math.min(score, 40);
  }

  const reasons = [];
  if (avail.length > 0) reasons.push(`${avail.length} Teil(e) ohne Partner`);
  if (!nachnameOk) reasons.push('Nachname unterschiedlich');
  const reason = reasons.length > 0 ? reasons.join(', ') : 'Alle Teile zugeordnet';
  return { score, reason };
};
const analyzeMatch = (nameA, nameB) => {
  const tA = tokenizeName(nameA), tB = tokenizeName(nameB);
  const origA = nameA.split(/\s+/).filter(Boolean), origB = nameB.split(/\s+/).filter(Boolean);
  let matchedA = new Set(), matchedB = new Set(), avail = [...tB];
  for (let i = 0; i < tA.length; i++) {
    let best = { score: 0, idx: -1 };
    for (let j = 0; j < avail.length; j++) {
      const jw = jaroWinkler(tA[i], avail[j]);
      const ph = koelnerPhonetik(tA[i]) === koelnerPhonetik(avail[j]) && koelnerPhonetik(tA[i]).length > 1;
      if ((jw > 0.8 || ph) && jw > best.score) best = { score: jw, idx: j };
    }
    if (best.idx !== -1) {
      matchedA.add(i);
      matchedB.add(tB.indexOf(avail[best.idx]));
      avail.splice(best.idx, 1);
    }
  }
  return {
    tokensA: origA.map((t, i) => ({ token: t, matched: matchedA.has(i) })),
    tokensB: origB.map((t, i) => ({ token: t, matched: matchedB.has(i) }))
  };
};
const normalizeDate = (d) => {
  if (d === null || d === undefined || d === '') return null;
  // Excel Serial Number (Zahl oder String der nur aus Ziffern besteht, z.B. "46069")
  const asNum = typeof d === 'number' ? d : (String(d).match(/^\d{5}$/) ? parseInt(d) : null);
  if (asNum && asNum > 40000 && asNum < 60000) {
    return new Date((asNum - 25569) * 86400 * 1000).toISOString().split('T')[0];
  }
  // ISO Format: 2026-02-16
  if (String(d).match(/^\d{4}-\d{2}-\d{2}/)) return String(d).slice(0, 10);
  // DD.MM.YYYY oder DD/MM/YY etc.
  const m = String(d).match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!m) return null;
  let [, day, mon, yr] = m;
  if (yr.length === 2) yr = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
  return `${yr}-${mon.padStart(2, '0')}-${day.padStart(2, '0')}`;
};
const fmtDate = (d) => { if (!d) return ''; const p = String(d).split('T')[0].split('-'); return `${p[2]}.${p[1]}.${p[0]}`; };
const fmtDateTime = (d) => {
  if (!d) return '';
  try {
    const dt = new Date(d);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yy} ${hh}:${mi}`;
  } catch { return fmtDate(d); }
};
const scoreClass = (s) => s >= 90 ? 'high' : s >= 75 ? 'medium' : 'low';

// ─── ABGLEICH-DIFF ────────────────────────────────────
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

// ─── KOMPONENTEN ──────────────────────────────────────

const Spinner = () => <div className="spinner" />;

// LOGIN
const LoginPage = ({ onLogin }) => {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setErr('');
    const res = await API.post('auth', { action: 'login', username: user, password: pass });
    setLoading(false);
    if (res.success) {
      localStorage.setItem('token', res.token);
      onLogin(res.user);
    } else {
      setErr(res.error || 'Login fehlgeschlagen');
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <h1>Prüfer</h1>
          <p>Ferienversorgung Abgleich-System</p>
        </div>
        {err && <div className="error-msg">{err}</div>}
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Benutzername</label>
            <input className="form-input" value={user} onChange={e => setUser(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Passwort</label>
            <input className="form-input" type="password" value={pass} onChange={e => setPass(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={loading || !user || !pass}>
            {loading ? 'Anmelden...' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
};

// DASHBOARD
const Dashboard = ({ blocks, onNavigate, onReload }) => {
  const [blockDetail, setBlockDetail] = useState({});
  const [loadingDetail, setLoadingDetail] = useState({});
  const [expandedBlock, setExpandedBlock] = useState(null);
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
  const gesamtKinderB = vals.reduce((s, d) => s + (d?.kinder_b || 0), 0);
  const gesamtMatches = vals.reduce((s, d) => s + (d?.matches ?? 0), 0);
  const gesamtFehltInB = vals.reduce((s, d) => s + (d?.nur_in_a ?? 0), 0);
  const hatAbgleich = vals.some(d => d?.letzter_abgleich);

  // Excel-Export: Fehlende Kinder
  const exportFehlende = () => {
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
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allFehlende), 'Fehlende Buchungen');
    XLSX.writeFile(wb, 'Fehlende_Buchungen.xlsx');
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
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Dashboard</h1>
          <p>Übersicht aller Ferienblöcke und aktueller Status</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onReload}>↻ Aktualisieren</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent-blue">
          <div className="stat-label">Ferienblöcke</div>
          <div className="stat-value">{blocks.length}</div>
          <div className="stat-sub">gesamt angelegt</div>
        </div>
        <div className="stat-card accent-blue">
          <div className="stat-label">Kinder in A</div>
          <div className="stat-value">{gesamtKinderA}</div>
          <div className="stat-sub">verschiedene Kinder angemeldet</div>
        </div>
        <div className="stat-card accent-green">
          <div className="stat-label">Kinder in B</div>
          <div className="stat-value">{gesamtKinderB}</div>
          <div className="stat-sub">verschiedene Kinder gebucht</div>
        </div>
        {hatAbgleich ? (<>
          <div className="stat-card accent-green">
            <div className="stat-label">✓ Übereinstimmung</div>
            <div className="stat-value">{gesamtMatches}</div>
            <div className="stat-sub">Kinder mit Buchung</div>
          </div>
          <div className={`stat-card ${gesamtFehltInB > 0 ? 'accent-red' : 'accent-green'}`}>
            <div className="stat-label">✗ Fehlt in B</div>
            <div className="stat-value">{gesamtFehltInB}</div>
            <div className="stat-sub">{gesamtFehltInB > 0 ? 'Kinder ohne Buchung' : 'alle gebucht ✓'}</div>
          </div>
        </>) : (
          <div className="stat-card">
            <div className="stat-label">Abgleich</div>
            <div className="stat-value">–</div>
            <div className="stat-sub">noch keiner durchgeführt</div>
          </div>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>Noch kein Ferienblock angelegt.</p>
            <br />
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => onNavigate('ferienblock')}>
              Ersten Block anlegen
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">
            Alle Ferienblöcke
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {hatAbgleich && gesamtFehltInB > 0 && <>
                <button className="btn btn-ghost btn-sm" onClick={printAllFehlende}>🖨️ Drucken</button>
                <button className="btn btn-ghost btn-sm" onClick={exportFehlende}>📥 Excel</button>
              </>}
              <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('ferienblock')}>+ Neu / Verwalten</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Zeitraum</th>
                  <th>€/Tag</th>
                  <th>Angemeldet (A)</th>
                  <th>Gebucht (B)</th>
                  <th>✓ OK</th>
                  <th>✗ Fehlt in B</th>
                  <th>⚠ Nur in B</th>
                  <th>Abgleiche</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {blocks.map(b => {
                  const d = blockDetail[b.id];
                  const loading = loadingDetail[b.id];
                  const hatErgebnis = d?.letzter_abgleich != null;
                  return (
                    <React.Fragment key={b.id}>
                      <tr>
                        <td><strong>{b.name}</strong></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</td>
                        <td>{parseFloat(b.preis_pro_tag).toFixed(2)} €</td>
                        <td>
                          {loading ? '…' : <><span className="badge badge-blue">{d?.kinder_a ?? 0}</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text2)', marginLeft: 4 }}>({d?.eintraege_a ?? 0} Tage)</span></>}
                        </td>
                        <td>
                          {loading ? '…' : <><span className="badge badge-blue">{d?.kinder_b ?? 0}</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text2)', marginLeft: 4 }}>({d?.eintraege_b ?? 0} Tage)</span></>}
                        </td>
                        <td>
                          {loading ? '…' : hatErgebnis
                            ? <><span className="badge badge-green">{d.matches}</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text2)', marginLeft: 3 }}>({d.matches_zeilen} Tage)</span></>
                            : <span style={{ color: 'var(--text2)' }}>–</span>}
                        </td>
                        <td>
                          {loading ? '…' : hatErgebnis
                            ? <><span className={`badge ${d.nur_in_a > 0 ? 'badge-red' : 'badge-green'}`}>{d.nur_in_a}</span>
                              {d.nur_in_a > 0 && <span style={{ fontSize: '0.65rem', color: 'var(--text2)', marginLeft: 3 }}>({d.nur_in_a_zeilen} Tage)</span>}</>
                            : <span style={{ color: 'var(--text2)' }}>–</span>}
                        </td>
                        <td>
                          {loading ? '…' : hatErgebnis
                            ? <><span className="badge badge-orange">{d.nur_in_b}</span>
                              {d.nur_in_b > 0 && <span style={{ fontSize: '0.65rem', color: 'var(--text2)', marginLeft: 3 }}>({d.nur_in_b_zeilen} Tage)</span>}</>
                            : <span style={{ color: 'var(--text2)' }}>–</span>}
                        </td>
                        <td>{loading ? '…' : <span className="badge badge-blue">{d?.abgleich_count ?? 0}</span>}</td>
                        <td style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {hatErgebnis && d.nur_in_a > 0 && (
                            <button className="btn btn-danger btn-sm" style={{ width: 'auto' }} onClick={() => {
                              if (expandedBlock === b.id) { setExpandedBlock(null); return; }
                              setExpandedBlock(b.id);
                              if (!abgleichDetail[b.id] && d.letzter_abgleich) {
                                setLoadingAbgleich(prev => ({ ...prev, [b.id]: true }));
                                API.get('abgleich', { abgleich_id: d.letzter_abgleich.id }).then(res => {
                                  setAbgleichDetail(prev => ({ ...prev, [b.id]: res }));
                                  setLoadingAbgleich(prev => ({ ...prev, [b.id]: false }));
                                });
                              }
                            }}>
                              ⚠ Fehlende anzeigen
                            </button>
                          )}
                          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => onNavigate('abgleich', b.id)}>
                            Abgleich starten
                          </button>
                        </td>
                      </tr>
                      {expandedBlock === b.id && (
                        <tr key={b.id + '-detail'}>
                          <td colSpan="10" style={{ padding: '1rem', background: 'var(--surface2)' }}>
                            {loadingAbgleich[b.id] ? <Spinner /> : abgleichDetail[b.id]?.matches ? (() => {
                              const am = abgleichDetail[b.id].matches;
                              const fehlende = am.filter(m => m.match_typ === 'nur_in_a');
                              const nurInB = am.filter(m => m.match_typ === 'nur_in_b');
                              const matched = am.filter(m => m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted');

                              // Nach Kind gruppieren
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
                              const nurInBGrp = groupEntries(nurInB, 'b');

                              return (
                                <div>
                                  {fehlendeGrp.length > 0 && (() => {
                                    const sorted = sortDetailList(fehlendeGrp);
                                    const thStyle = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
                                    return <div style={{ marginBottom: '1rem' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                        <h4 style={{ color: 'var(--danger)', margin: 0 }}>⚠ {fehlendeGrp.length} Kinder OHNE Buchung ({fehlende.length} Tage)</h4>
                                        <button className="btn btn-ghost btn-sm" style={{ width: 'auto', fontSize: '0.75rem' }}
                                          onClick={() => printFehlendeKinder('Fehlende Kinder — OHNE Buchung', sorted, b.name)}>
                                          🖨️ Drucken
                                        </button>
                                      </div>
                                      <div className="table-wrap"><table><thead><tr>
                                        <th>#</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('nachname')}>Nachname{sortIcon('nachname')}</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('vorname')}>Vorname{sortIcon('vorname')}</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('klasse')}>Klasse{sortIcon('klasse')}</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('tage')}>Tage{sortIcon('tage')}</th>
                                        <th>Daten</th>
                                      </tr></thead>
                                        <tbody>{sorted.map((k, i) => (<tr key={i} style={{ background: 'rgba(220,53,69,0.06)' }}>
                                          <td>{i + 1}</td><td><strong>{k.nachname}</strong></td><td>{k.vorname}</td><td>{k.klasse || '–'}</td>
                                          <td><span className="badge badge-red">{k.dates.length}</span></td>
                                          <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                                        </tr>))}</tbody></table></div>
                                    </div>;
                                  })()}
                                  {nurInBGrp.length > 0 && (() => {
                                    const sorted = sortDetailList(nurInBGrp);
                                    const thStyle = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
                                    return <div style={{ marginBottom: '1rem' }}>
                                      <h4 style={{ color: 'var(--warning)', marginBottom: '0.5rem' }}>ℹ {nurInBGrp.length} Kinder NUR in Liste B ({nurInB.length} Tage)</h4>
                                      <div className="table-wrap"><table><thead><tr>
                                        <th>#</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('nachname')}>Nachname{sortIcon('nachname')}</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('vorname')}>Vorname{sortIcon('vorname')}</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('klasse')}>Klasse{sortIcon('klasse')}</th>
                                        <th style={thStyle} onClick={() => toggleDetailSort('tage')}>Tage{sortIcon('tage')}</th>
                                        <th>Daten</th>
                                      </tr></thead>
                                        <tbody>{sorted.map((k, i) => (<tr key={i} style={{ background: 'rgba(230,168,23,0.06)' }}>
                                          <td>{i + 1}</td><td><strong>{k.nachname}</strong></td><td>{k.vorname}</td><td>{k.klasse || '–'}</td>
                                          <td><span className="badge badge-orange">{k.dates.length}</span></td>
                                          <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                                        </tr>))}</tbody></table></div>
                                    </div>;
                                  })()}
                                  {matched.length > 0 && (
                                    <div>
                                      <h4 style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>✓ {new Set(matched.map(m => (m.a_nachname + '|' + m.a_vorname).toLowerCase())).size} Kinder übereinstimmend ({matched.length} Tage)</h4>
                                      <p style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Alle Kinder mit Anmeldung und Buchung stimmen überein.</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })() : <p style={{ color: 'var(--text2)' }}>Keine Abgleich-Daten verfügbar</p>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// FERIENBLOCK VERWALTUNG
const FerienblockPage = ({ blocks, onReload }) => {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', startdatum: '', enddatum: '', preis_pro_tag: '3.50' });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null); // welcher Block ist aufgeklappt
  const [detail, setDetail] = useState({});   // { blockId: { a: [...], b: [...] } }
  const [detailLoading, setDetailLoading] = useState({});

  const openNew = () => { setEditing(null); setForm({ name: '', startdatum: '', enddatum: '', preis_pro_tag: '3.50' }); setShowModal(true); };
  const openEdit = (b) => {
    setEditing(b);
    setForm({ name: b.name, startdatum: String(b.startdatum).split('T')[0], enddatum: String(b.enddatum).split('T')[0], preis_pro_tag: String(b.preis_pro_tag) });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    if (editing) await API.put('ferienblock', { ...form, id: editing.id });
    else await API.post('ferienblock', form);
    setSaving(false);
    setShowModal(false);
    onReload();
  };

  const remove = async (id) => {
    if (!window.confirm('Ferienblock und ALLE zugehörigen Daten (Listen A+B, Abgleiche) löschen?')) return;
    await API.post('ferienblock', { action: 'delete', id });
    onReload();
  };

  // Block aufklappen & Daten laden
  const toggleExpand = async (blockId) => {
    if (expanded === blockId) { setExpanded(null); return; }
    setExpanded(blockId);
    if (detail[blockId]) return; // schon geladen
    setDetailLoading(prev => ({ ...prev, [blockId]: true }));
    const [a, b] = await Promise.all([
      API.get('listen', { ferienblock_id: blockId, liste: 'A' }),
      API.get('listen', { ferienblock_id: blockId, liste: 'B' })
    ]);
    setDetail(prev => ({
      ...prev, [blockId]: {
        a: Array.isArray(a) ? a : [],
        b: Array.isArray(b) ? b : []
      }
    }));
    setDetailLoading(prev => ({ ...prev, [blockId]: false }));
  };

  // Alle Einträge einer Liste löschen
  const clearListe = async (blockId, liste) => {
    if (!window.confirm(`Alle Einträge in Liste ${liste} für diesen Block löschen?`)) return;
    await API.post('listen', { action: 'delete', ferienblock_id: blockId, liste });
    // Detail-Cache leeren und neu laden
    setDetail(prev => { const n = { ...prev }; delete n[blockId]; return n; });
    setExpanded(null);
    setTimeout(() => toggleExpand(blockId), 100);
    onReload();
  };

  // Einzelnen Eintrag löschen (nicht direkt in API, aber wir können über listen.js erweitern - vorerst ganze Liste neu laden)
  const reloadDetail = async (blockId) => {
    setDetailLoading(prev => ({ ...prev, [blockId]: true }));
    const [a, b] = await Promise.all([
      API.get('listen', { ferienblock_id: blockId, liste: 'A' }),
      API.get('listen', { ferienblock_id: blockId, liste: 'B' })
    ]);
    setDetail(prev => ({
      ...prev, [blockId]: {
        a: Array.isArray(a) ? a : [],
        b: Array.isArray(b) ? b : []
      }
    }));
    setDetailLoading(prev => ({ ...prev, [blockId]: false }));
    onReload();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Ferienblöcke</h1>
        <p>Verwalte Ferienblöcke, Daten und Einträge</p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Neuer Ferienblock</button>
      </div>

      {blocks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>Noch kein Ferienblock vorhanden.</p>
          </div>
        </div>
      ) : blocks.map(b => {
        const isOpen = expanded === b.id;
        const d = detail[b.id];
        const loading = detailLoading[b.id];
        return (
          <div key={b.id} className="card" style={{ marginBottom: '1rem' }}>
            {/* Block-Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{b.name}</strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>
                    {fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}
                  </span>
                  <span className="badge badge-orange">{parseFloat(b.preis_pro_tag).toFixed(2)} €/Tag</span>
                </div>
                {d && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <span className="badge badge-blue">📋 {d.a.length} Anmeldungen</span>
                    <span className="badge badge-green">🍽 {d.b.length} Buchungen</span>
                    {d.a.length > d.b.length && (
                      <span className="badge badge-red">⚠️ {d.a.length - d.b.length} fehlend</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleExpand(b.id)}>
                  {isOpen ? '▲ Zuklappen' : '▼ Details'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(b)}>✏️ Bearbeiten</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>🗑 Löschen</button>
              </div>
            </div>

            {/* Aufgeklappte Details */}
            {isOpen && (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                {loading ? <Spinner /> : (
                  <div className="two-col" style={{ gap: '1rem' }}>
                    {/* Liste A */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>📋 Liste A – Anmeldungen ({d?.a.length || 0})</strong>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => reloadDetail(b.id)}>↻</button>
                          {d?.a.length > 0 && (
                            <button className="btn btn-danger btn-sm" onClick={() => clearListe(b.id, 'A')}>
                              Alle löschen
                            </button>
                          )}
                        </div>
                      </div>
                      {!d?.a.length ? (
                        <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>Keine Einträge vorhanden.</p>
                      ) : (
                        <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <table style={{ margin: 0 }}>
                            <thead>
                              <tr><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Datum</th></tr>
                            </thead>
                            <tbody>
                              {d.a.map(e => (
                                <tr key={e.id}>
                                  <td>{e.nachname}</td>
                                  <td>{e.vorname}</td>
                                  <td>{e.klasse || '–'}</td>
                                  <td>{fmtDate(e.datum)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Liste B */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>🍽 Liste B – Buchungen ({d?.b.length || 0})</strong>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => reloadDetail(b.id)}>↻</button>
                          {d?.b.length > 0 && (
                            <button className="btn btn-danger btn-sm" onClick={() => clearListe(b.id, 'B')}>
                              Alle löschen
                            </button>
                          )}
                        </div>
                      </div>
                      {!d?.b.length ? (
                        <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>Keine Einträge vorhanden.</p>
                      ) : (
                        <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <table style={{ margin: 0 }}>
                            <thead>
                              <tr><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Datum</th><th>Menü</th></tr>
                            </thead>
                            <tbody>
                              {d.b.map(e => (
                                <tr key={e.id}>
                                  <td>{e.nachname}</td>
                                  <td>{e.vorname}</td>
                                  <td>{e.klasse || '–'}</td>
                                  <td>{fmtDate(e.datum)}</td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{e.menu || '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? 'Ferienblock bearbeiten' : 'Neuer Ferienblock'}</h3>
            <div className="form-group">
              <label>Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Winterferien 2026" autoFocus />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Startdatum</label>
                <input className="form-input" type="date" value={form.startdatum} onChange={e => setForm({ ...form, startdatum: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Enddatum</label>
                <input className="form-input" type="date" value={form.enddatum} onChange={e => setForm({ ...form, enddatum: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Preis pro Tag (€)</label>
              <input className="form-input" type="number" step="0.01" value={form.preis_pro_tag} onChange={e => setForm({ ...form, preis_pro_tag: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Abbrechen</button>
              <button className="btn btn-primary" style={{ width: 'auto' }} disabled={saving || !form.name || !form.startdatum || !form.enddatum} onClick={save}>
                {saving ? 'Speichern...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// MINI-EXCEL KOMPONENTE (Interaktive Tabelle für Copy/Paste)
const MiniExcel = ({ onImport, label }) => {
  const defaultCols = 5;
  const defaultRows = 12;
  const [data, setData] = useState(Array.from({ length: defaultRows }, () => Array(defaultCols).fill('')));

  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const rawRows = text.trim().split('\n').map(row => row.split('\t').map(c => c.trim()));

    // Excel kopiert oft tausende leere Zellen, wenn man ganze Zeilen markiert. Wir kürzen diese weg!
    let maxContentCols = defaultCols;
    const validRows = rawRows.map(row => {
      let lastFilled = row.length - 1;
      while (lastFilled >= 0 && row[lastFilled] === '') lastFilled--;
      const cleanRow = row.slice(0, Math.max(0, lastFilled + 1));
      if (cleanRow.length > maxContentCols) maxContentCols = cleanRow.length;
      return cleanRow;
    });

    let lastFilledRow = validRows.length - 1;
    while (lastFilledRow >= 0 && validRows[lastFilledRow].length === 0) lastFilledRow--;
    const finalRows = validRows.slice(0, Math.max(0, lastFilledRow + 1));

    // Begrenze auf sinnvolle Max-Größen (z.B. max 50 Spalten, falls doch was schiefgeht)
    const newRows = Math.max(data.length, finalRows.length + 2); // 2 Leerzeilen Puffer
    const newCols = Math.min(30, Math.max(data[0].length, maxContentCols + 1));

    const newData = Array.from({ length: newRows }, () => Array(newCols).fill(''));
    finalRows.forEach((r, i) => {
      r.forEach((c, j) => {
        if (i < newRows && j < newCols) newData[i][j] = c;
      });
    });
    setData(newData);
  };

  const handleChange = (r, c, val) => {
    const newData = [...data];
    newData[r] = [...newData[r]];
    newData[r][c] = val;
    setData(newData);
  };

  const submit = () => {
    // Leere Zeilen ignorieren
    const validRows = data.filter(row => row.some(cell => String(cell).trim() !== ''));
    if (validRows.length < 2) {
      toast.error('Gefühlt zu wenig Daten (Kopfzeile + Zeilen).');
      return;
    }
    // Erstelle JSON-Array für den Import, trimme whitespace
    const jsonArrays = validRows.map(r => r.map(c => String(c).trim()));
    onImport(jsonArrays);
  };

  return (
    <div style={{ minWidth: 0, border: '2px solid var(--border)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: 'var(--bg2)', padding: '0.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text2)', textAlign: 'center' }}>
        Strg+V drücken, um Zellen direkt als Tabelle einzufügen
      </div>
      <div style={{ minWidth: 0, overflowX: 'auto', overflowY: 'auto', minHeight: '180px', maxHeight: '280px', width: '100%' }} onPaste={handlePaste}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              <th style={{ background: 'var(--bg2)', width: '35px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}></th>
              {data[0].map((_, i) => (
                <th key={i} style={{ background: 'var(--bg2)', width: '100px', padding: '0.2rem', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text2)' }}>
                  {String.fromCharCode(65 + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, r) => (
              <tr key={r}>
                <td style={{ background: 'var(--bg2)', textAlign: 'center', fontSize: '0.7rem', color: 'var(--text2)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', position: 'sticky', left: 0, zIndex: 1 }}>{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: 0, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <input
                      style={{ width: '100%', height: '100%', border: 'none', outline: 'none', padding: '0.3rem 0.5rem', fontSize: '0.82rem', background: cell ? 'rgba(var(--primary-rgb),0.06)' : 'transparent', color: 'var(--text)' }}
                      value={cell}
                      onChange={e => handleChange(r, c, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '0.6rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg2)' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{data.filter(r => r.some(c => String(c).trim())).length} Zeilen erkannt</span>
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={submit}>✔️ Daten übernehmen</button>
      </div>
    </div>
  );
};


// ABGLEICH-TOOL
const AbgleichTool = ({ blocks, initialBlockId, onReload }) => {
  const [blockId, setBlockId] = useState(initialBlockId || (blocks[0]?.id || ''));
  const [step, setStep] = useState(1);
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [rawA, setRawA] = useState(null);
  const [rawB, setRawB] = useState(null);
  const [colMapA, setColMapA] = useState({ nachname: '', vorname: '', date: '', klasse: '' });
  const [colMapB, setColMapB] = useState({ nachname: '', vorname: '', date: '', klasse: '' });
  const [potentialMatches, setPotentialMatches] = useState([]);
  const [reviewed, setReviewed] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listADb, setListADb] = useState([]);
  const [listBDb, setListBDb] = useState([]);
  const [comparisonSummary, setComparisonSummary] = useState(null); // { exact, fuzzy, onlyA, onlyB }
  const [usedDbForA, setUsedDbForA] = useState(false);
  const [usedDbForB, setUsedDbForB] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(null); // 'A', 'B' oder null

  // Listen aus DB laden wenn Block gewählt
  useEffect(() => {
    if (!blockId) return;
    setListA([]); setListB([]); setRawA(null); setRawB(null);
    setStep(1); setPotentialMatches([]); setReviewed({});
    setComparisonSummary(null); setUsedDbForA(false); setUsedDbForB(false);
    API.get('listen', { ferienblock_id: blockId, liste: 'A' }).then(d => {
      setListADb(Array.isArray(d) ? d : []);
    });
    API.get('listen', { ferienblock_id: blockId, liste: 'B' }).then(d => {
      setListBDb(Array.isArray(d) ? d : []);
    });
  }, [blockId]);

  const processImportArray = (json, which) => {
    // Prüfen ob erste Zeile ein echter Header ist (Texte) oder schon Daten (Zahlen/bekannte Namen)
    const firstRow = json[0] || [];
    const hasTextHeader = firstRow.every(cell =>
      typeof cell === 'string' && !/^\d+$/.test(String(cell).trim()) && isNaN(cell)
    );

    let headers, dataRows;
    if (hasTextHeader) {
      headers = firstRow.map(h => String(h).trim());
      dataRows = json.slice(1);
    } else {
      headers = firstRow.map((_, i) => `Spalte ${String.fromCharCode(65 + i)}`);
      dataRows = json;
    }

    const raw = { headers, data: dataRows, hasTextHeader };
    const autoKlasse = hasTextHeader ? headers.find(h => /klasse/i.test(h)) || '' : '';
    if (which === 'A') { setRawA(raw); setColMapA({ nachname: '', vorname: '', date: '', klasse: autoKlasse }); }
    else { setRawB(raw); setColMapB({ nachname: '', vorname: '', date: '', klasse: autoKlasse }); }
    setIsLoading(false);
  };

  const handleExcelUpload = (file, which) => {
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      if (!json || json.length === 0) { setIsLoading(false); return; }
      processImportArray(json, which);
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePasteData = (e, which) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    setIsLoading(true);
    const rawRows = text.trim().split('\n');
    if (rawRows.length < 2) { toast.error('Mindestens 2 Zeilen (Kopfzeile + Daten) benötigt.'); setIsLoading(false); return; }

    // Tabulator-getrennte Tabelle parsen
    const json = rawRows.map(row => row.split('\t').map(c => c.trim()));
    processImportArray(json, which);
  };

  const processAndUpload = async () => {
    setIsLoading(true);
    // Immer frisch starten — keine alten Entscheidungen behalten
    setPotentialMatches([]);
    setReviewed({});
    setComparisonSummary(null);
    // Merken welche Listen neu hochgeladen und welche aus DB kommen
    setUsedDbForA(!rawA || !colMapA.nachname);
    setUsedDbForB(!rawB || !colMapB.nachname);

    // Hilfsfunktion: Zeile -> { nachname, vorname, datum, ... }
    const buildEntry = (row, headers, cm, extraCols = {}) => {
      const ni = cm.nachname ? headers.indexOf(cm.nachname) : -1;
      const vi = cm.vorname ? headers.indexOf(cm.vorname) : -1;
      const di = cm.date ? headers.indexOf(cm.date) : -1;
      const nachname = ni >= 0 ? String(row[ni] || '').trim() : '';
      const vorname = vi >= 0 ? String(row[vi] || '').trim() : '';
      const datum = di >= 0 ? normalizeDate(row[di]) : null;
      if (!nachname && !vorname) return null;
      if (!datum) return null;
      const entry = { nachname, vorname, datum };
      for (const [key, idx] of Object.entries(extraCols)) {
        entry[key] = idx >= 0 ? row[idx] : null;
      }
      return entry;
    };

    // Block-Zeitraum für Validierung
    const block = blocks.find(b => String(b.id) === String(blockId));
    const blockStart = block ? String(block.startdatum).split('T')[0] : null;
    const blockEnd = block ? String(block.enddatum).split('T')[0] : null;
    const warnings = [];

    // Validierung: Einträge prüfen
    const validateEntries = (entries, label) => {
      let emptyNames = 0, outsideDates = 0, invalidDates = 0;
      entries.forEach(e => {
        if (!e.nachname || !e.vorname) emptyNames++;
        if (!e.datum || e.datum === 'Invalid Date' || e.datum === 'NaN-NaN-NaN') invalidDates++;
        else if (blockStart && blockEnd && (e.datum < blockStart || e.datum > blockEnd)) outsideDates++;
      });
      if (emptyNames > 0) warnings.push(`${label}: ${emptyNames} Zeilen ohne Name übersprungen`);
      if (invalidDates > 0) warnings.push(`${label}: ${invalidDates} Zeilen mit ungültigem Datum übersprungen`);
      if (outsideDates > 0) warnings.push(`${label}: ${outsideDates} Einträge liegen außerhalb des Block-Zeitraums (${fmtDate(blockStart)} – ${fmtDate(blockEnd)})`);
    };

    // Liste A verarbeiten (mit optionaler Klasse)
    let newA = [];
    if (rawA && colMapA.nachname) {
      const hA = rawA.headers;
      const extraColsA = {
        klasse: colMapA.klasse ? hA.indexOf(colMapA.klasse) : hA.findIndex(x => /klasse/i.test(x)),
      };
      newA = rawA.data.map(row => buildEntry(row, hA, colMapA, extraColsA)).filter(Boolean);
      validateEntries(newA, 'Liste A');
      await API.post('listen', { ferienblock_id: blockId, liste: 'A', eintraege: newA });
    }

    // Liste B verarbeiten (mit extra Spalten: Klasse, Menü, Kontostand)
    let newB = [];
    if (rawB && colMapB.nachname) {
      const h = rawB.headers;
      const extraCols = {
        klasse: colMapB.klasse ? h.indexOf(colMapB.klasse) : h.findIndex(x => /klasse/i.test(x)),
        menu: h.findIndex(x => /men[uü]/i.test(x)),
        kontostand: h.findIndex(x => /konto/i.test(x)),
      };
      newB = rawB.data.map(row => buildEntry(row, h, colMapB, extraCols)).filter(Boolean);
      validateEntries(newB, 'Liste B');
      await API.post('listen', { ferienblock_id: blockId, liste: 'B', eintraege: newB });
    }

    // Warnungen anzeigen
    if (warnings.length > 0) {
      warnings.forEach(w => toast.warn(w));
    }

    // Interne Listen für Abgleich aufbauen
    const toMatchList = (entries) => entries.map((e, i) => ({
      id: `${i}`, name: `${e.vorname} ${e.nachname}`.trim(), date: e.datum, dbId: e.id
    }));

    // DB neu laden
    const [freshA, freshB] = await Promise.all([
      API.get('listen', { ferienblock_id: blockId, liste: 'A' }),
      API.get('listen', { ferienblock_id: blockId, liste: 'B' })
    ]);
    setListADb(Array.isArray(freshA) ? freshA : []);
    setListBDb(Array.isArray(freshB) ? freshB : []);

    const mA = (Array.isArray(freshA) ? freshA : []).map((e, i) => ({ id: `a${e.id}`, dbId: e.id, name: `${e.vorname} ${e.nachname}`.trim(), date: String(e.datum).split('T')[0] }));
    const mB = (Array.isArray(freshB) ? freshB : []).map((e, i) => ({ id: `b${e.id}`, dbId: e.id, name: `${e.vorname} ${e.nachname}`.trim(), date: String(e.datum).split('T')[0] }));
    setListA(mA); setListB(mB);

    // Automatisch neue Kinder aus Liste A ins Kinder-Verzeichnis synchronisieren
    try {
      const syncRes = await API.post('kinder', { action: 'sync' });
      if (syncRes.inserted > 0) {
        toast.success(`${syncRes.inserted} neue Kinder ins Verzeichnis übernommen`);
      }
    } catch (e) { /* Sync-Fehler ignorieren — Listen-Import war erfolgreich */ }

    setIsLoading(false);
    setStep(3);
    runComparison(mA, mB);
  };

  const runComparison = (lA, lB) => {
    setIsLoading(true);
    requestAnimationFrame(() => {
      const mapB = new Map((lB).map(i => [`${i.name}|${i.date}`, i]));
      const exactA = (lA).filter(e => mapB.has(`${e.name}|${e.date}`));
      const nonA = (lA).filter(e => !mapB.has(`${e.name}|${e.date}`));
      const mapA = new Map((lA).map(i => [`${i.name}|${i.date}`, i]));
      const nonB = (lB).filter(e => !mapA.has(`${e.name}|${e.date}`));
      const byDate = nonB.reduce((acc, i) => { (acc[i.date] = acc[i.date] || []).push(i); return acc; }, {});
      const groups = {};
      for (const eA of nonA) {
        for (const eB of (byDate[eA.date] || [])) {
          const { score, reason } = calcScore(eA.name, eB.name);
          if (score >= 75) {
            const key = `${tokenizeName(eA.name).sort().join('')}|${tokenizeName(eB.name).sort().join('')}`;
            if (!groups[key]) groups[key] = { nameA: eA.name, nameB: eB.name, score, reason, entries: [] };
            groups[key].entries.push({ entryA: eA, entryB: eB });
          }
        }
      }
      const fuzzyGroups = Object.values(groups).sort((a, b) => b.score - a.score);
      setPotentialMatches(fuzzyGroups);

      // Zusammenfassung für Transparenz
      const fuzzyEntries = fuzzyGroups.reduce((sum, g) => sum + g.entries.length, 0);
      const onlyACount = nonA.length - fuzzyEntries;
      setComparisonSummary({
        totalA: lA.length,
        totalB: lB.length,
        exact: exactA.length,
        exactKinder: new Set(exactA.map(e => e.name.toLowerCase())).size,
        fuzzyGroups: fuzzyGroups.length,
        fuzzyEntries,
        onlyA: Math.max(0, onlyACount),
        onlyB: Math.max(0, nonB.length - fuzzyEntries),
      });

      setIsLoading(false);
    });
  };

  const startComparisonFromDb = () => {
    const mA = listADb.map(e => ({ id: `a${e.id}`, dbId: e.id, name: `${e.vorname} ${e.nachname}`.trim(), date: String(e.datum).split('T')[0] }));
    const mB = listBDb.map(e => ({ id: `b${e.id}`, dbId: e.id, name: `${e.vorname} ${e.nachname}`.trim(), date: String(e.datum).split('T')[0] }));
    setListA(mA); setListB(mB);
    setPotentialMatches([]); setReviewed({}); setComparisonSummary(null);
    setUsedDbForA(true); setUsedDbForB(true);
    runComparison(mA, mB);
    setStep(3);
  };

  const handleGroupAction = (group, action) => {
    const nr = { ...reviewed };
    group.entries.forEach(p => { nr[`${p.entryA.id}-${p.entryB.id}`] = action; });
    setReviewed(nr);
  };

  const bulkAction = (action, threshold = 0) => {
    const nr = { ...reviewed };
    potentialMatches.filter(g => g.entries.some(e => !reviewed[`${e.entryA.id}-${e.entryB.id}`])).forEach(g => {
      if (action === 'accept' && g.score < threshold) return;
      g.entries.forEach(p => { nr[`${p.entryA.id}-${p.entryB.id}`] = action; });
    });
    setReviewed(nr);
  };

  const finalResults = useMemo(() => {
    if (!listA.length || !listB.length) return { matches: [], onlyInA: [], onlyInB: [] };
    const mapB = new Map(listB.map(i => [`${i.name}|${i.date}`, i.id]));
    const exactAIds = new Set();
    const exactBIds = new Set();
    listA.forEach(i => {
      const bId = mapB.get(`${i.name}|${i.date}`);
      if (bId !== undefined) { exactAIds.add(i.id); exactBIds.add(bId); }
    });
    const accA = new Set(), accB = new Set();
    potentialMatches.forEach(g => g.entries.forEach(p => {
      if (reviewed[`${p.entryA.id}-${p.entryB.id}`] === 'accept') { accA.add(p.entryA.id); accB.add(p.entryB.id); }
    }));
    return {
      matches: listA.filter(i => exactAIds.has(i.id) || accA.has(i.id)),
      onlyInA: listA.filter(i => !exactAIds.has(i.id) && !accA.has(i.id)),
      onlyInB: listB.filter(i => !exactBIds.has(i.id) && !accB.has(i.id))
    };
  }, [listA, listB, potentialMatches, reviewed]);

  const saveAbgleich = async () => {
    setSaving(true);
    const matchRows = [];

    // Exact matches
    const mapB = new Map(listB.map(i => [`${i.name}|${i.date}`, i]));
    listA.forEach(eA => {
      const eB = mapB.get(`${eA.name}|${eA.date}`);
      if (eB) matchRows.push({ liste_a_id: eA.dbId, liste_b_id: eB.dbId, match_typ: 'exact', score: 100, grund: 'Exakte Übereinstimmung' });
    });

    // Fuzzy matches
    potentialMatches.forEach(g => g.entries.forEach(p => {
      const st = reviewed[`${p.entryA.id}-${p.entryB.id}`];
      if (st === 'accept') matchRows.push({ liste_a_id: p.entryA.dbId, liste_b_id: p.entryB.dbId, match_typ: 'fuzzy_accepted', score: g.score, grund: g.reason });
      if (st === 'reject') matchRows.push({ liste_a_id: p.entryA.dbId, liste_b_id: p.entryB.dbId, match_typ: 'fuzzy_rejected', score: g.score, grund: g.reason });
    }));

    // Nur in A
    finalResults.onlyInA.forEach(e => matchRows.push({ liste_a_id: e.dbId, liste_b_id: null, match_typ: 'nur_in_a', score: null, grund: 'Keine Entsprechung in Liste B gefunden' }));

    // Nur in B
    finalResults.onlyInB.forEach(e => matchRows.push({ liste_a_id: null, liste_b_id: e.dbId, match_typ: 'nur_in_b', score: null, grund: 'Nicht in Liste A vorhanden' }));

    const res = await API.post('abgleich', { ferienblock_id: blockId, matches: matchRows });
    setSaving(false);
    if (res.success) {
      alert(`Abgleich gespeichert! ID: ${res.abgleich_id}`);
      setStep(4);
      if (onReload) onReload(); // Dashboard-Daten aktualisieren
    } else {
      alert('Fehler beim Speichern: ' + res.error);
    }
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const fmt = (d) => fmtDate(d);
    // Nur-in-A Sheet
    if (finalResults.onlyInA.length > 0) {
      const data = finalResults.onlyInA.map(i => {
        const parts = i.name.split(/\s+/);
        return { Vorname: parts.slice(0, -1).join(' '), Nachname: parts.pop() || '', Datum: fmt(i.date) };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Fehlt in Liste B');
    }
    // Nur-in-B Sheet
    if (finalResults.onlyInB.length > 0) {
      const data = finalResults.onlyInB.map(i => {
        const parts = i.name.split(/\s+/);
        return { Vorname: parts.slice(0, -1).join(' '), Nachname: parts.pop() || '', Datum: fmt(i.date) };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Nur in Liste B');
    }
    // Matches
    const matchData = finalResults.matches.map(i => {
      const parts = i.name.split(/\s+/);
      return { Vorname: parts.slice(0, -1).join(' '), Nachname: parts.pop() || '', Datum: fmt(i.date), Status: 'Bestätigt' };
    });
    if (matchData.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchData), 'Übereinstimmungen');

    if (wb.SheetNames.length) XLSX.writeFile(wb, 'Abgleich_Ergebnis.xlsx');
    else alert('Keine Daten zum Exportieren');
  };

  const openGroups = potentialMatches.filter(g => g.entries.some(e => !reviewed[`${e.entryA.id}-${e.entryB.id}`]));

  const ColMapper = ({ raw, colMap, onChange, label }) => {
    if (!raw) return (
      <div className="upload-zone">
        <div className="icon">📂</div>
        <p>Noch keine Datei für Liste {label}</p>
      </div>
    );

    // Zellwert für Vorschau lesbar machen (Datum konvertieren)
    const previewCell = (val, colName) => {
      if (val === null || val === undefined || val === '') return '–';
      // Ist es die Datumsspalte?
      if (colName === colMap.date && typeof val === 'number' && val > 40000 && val < 60000) {
        return fmtDate(normalizeDate(val)) + ' ✓';
      }
      return String(val);
    };

    return (
      <div>
        <p style={{ marginBottom: '0.5rem', fontSize: '0.88rem', color: 'var(--text2)' }}>
          <strong>{raw.data.length}</strong> Zeilen gefunden
        </p>
        {!raw.hasTextHeader && (
          <div style={{ background: 'rgba(220,53,69,0.1)', border: '1px solid var(--danger)', borderRadius: '8px', padding: '0.6rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
            ⚠️ <strong>Keine Headerzeile erkannt!</strong> Die Spalten wurden automatisch benannt (Spalte A, B, C...).
            Am besten füge in deiner Excel-Datei eine erste Zeile mit Spaltenüberschriften ein (z.B. <em>Vorname | Nachname | Datum</em>).
          </div>
        )}


        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
              Nachname-Spalte *
            </label>
            <select className="select-input" style={{ width: '100%' }} value={colMap.nachname}
              onChange={e => onChange({ ...colMap, nachname: e.target.value })}>
              <option value="">– wählen –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
              Vorname-Spalte
            </label>
            <select className="select-input" style={{ width: '100%' }} value={colMap.vorname}
              onChange={e => onChange({ ...colMap, vorname: e.target.value })}>
              <option value="">– optional –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
              Datums-Spalte *
            </label>
            <select className="select-input" style={{ width: '100%' }} value={colMap.date}
              onChange={e => onChange({ ...colMap, date: e.target.value })}>
              <option value="">– wählen –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
              Klasse
            </label>
            <select className="select-input" style={{ width: '100%' }} value={colMap.klasse}
              onChange={e => onChange({ ...colMap, klasse: e.target.value })}>
              <option value="">– optional –</option>
              {raw.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: '0.5rem' }}>Vorschau (erste 3 Zeilen):</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{raw.headers.map(h => (
                <th key={h} style={{
                  color: (h === colMap.nachname || h === colMap.vorname) ? 'var(--success)' : h === colMap.date ? 'var(--primary)' : h === colMap.klasse ? 'var(--warning)' : undefined
                }}>
                  {h}
                  {h === colMap.nachname && ' 👤'}
                  {h === colMap.vorname && ' 👤'}
                  {h === colMap.date && ' 📅'}
                  {h === colMap.klasse && ' 🏫'}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {raw.data.slice(0, 3).map((row, i) => (
                <tr key={i}>{raw.headers.map((h, j) => (
                  <td key={j} style={{
                    fontWeight: (h === colMap.nachname || h === colMap.vorname || h === colMap.date || h === colMap.klasse) ? 700 : undefined,
                    color: (h === colMap.nachname || h === colMap.vorname) ? 'var(--success)' : h === colMap.date ? 'var(--primary)' : h === colMap.klasse ? 'var(--warning)' : undefined
                  }}>
                    {previewCell(row[j], h)}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1>Abgleich-Tool</h1>
        <p>Vergleiche Anmeldungen (A) mit Essensbuchungen (B)</p>
      </div>

      {/* Ferienblock Auswahl */}
      <div className="card">
        <div className="card-title">Ferienblock</div>
        <select className="ferienblock-select" value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
        </select>
      </div>

      {blockId && (
        <>
          {/* Wizard */}
          <div className="wizard-bar">
            {['Daten laden', 'Spalten zuordnen', 'Prüfen', 'Ergebnis'].map((n, i) => (
              <div key={i} className={`wiz-step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>
                <span className="wiz-num">{i + 1}</span>{n}
              </div>
            ))}
          </div>

          {isLoading && <Spinner />}

          {/* SCHRITT 1: Daten laden */}
          {!isLoading && step === 1 && (
            <div>
              {(listADb.length > 0 || listBDb.length > 0) && (() => {
                const uniqueA = new Set(listADb.map(e => (e.nachname + '|' + e.vorname).toLowerCase())).size;
                const uniqueB = new Set(listBDb.map(e => (e.nachname + '|' + e.vorname).toLowerCase())).size;
                return <div className="info-box" style={{ marginBottom: '1rem' }}>
                  In der Datenbank vorhanden:
                  {listADb.length > 0 && <> <strong>{uniqueA} Kinder</strong> <span style={{ opacity: 0.7 }}>· {listADb.length} Tage</span> (Liste A)</>}
                  {listADb.length > 0 && listBDb.length > 0 && ', '}
                  {listBDb.length > 0 && <> <strong>{uniqueB} Kinder</strong> <span style={{ opacity: 0.7 }}>· {listBDb.length} Tage</span> (Liste B)</>}
                  {listADb.length > 0 && listBDb.length > 0 && (
                    <> – <button className="btn btn-primary btn-sm" style={{ marginLeft: '0.75rem' }} onClick={startComparisonFromDb}>Direkt vergleichen</button></>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: '0.5rem', color: 'var(--danger)' }} onClick={async () => {
                    const ok = await confirmDialog(
                      'Alle Daten löschen',
                      `Alle Listen (${listADb.length} A + ${listBDb.length} B) und gespeicherte Abgleiche für diesen Block löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
                      'Alles löschen'
                    );
                    if (!ok) return;
                    await Promise.all([
                      API.post('listen', { action: 'delete', ferienblock_id: blockId, liste: 'A' }),
                      API.post('listen', { action: 'delete', ferienblock_id: blockId, liste: 'B' }),
                      API.post('abgleich', { action: 'delete_all', ferienblock_id: blockId })
                    ]);
                    toast.success('Listen und Abgleiche gelöscht');
                    setListADb([]); setListBDb([]);
                    setListA([]); setListB([]);
                    setRawA(null); setRawB(null);
                    setPotentialMatches([]); setReviewed({});
                    setStep(1);
                  }}>🗑 Listen löschen</button>
                </div>;
              })()}
              <div className="two-col">
                <div className="card">
                  <div className="card-title">Liste A – Anmeldungen</div>
                  {rawA ? (
                    <div className="upload-zone has-data" style={{ cursor: 'default' }}>
                      <div className="icon">✅</div>
                      <p>{rawA.data.length} Zeilen geladen</p>
                      <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => { setRawA(null); setColMapA({ nachname: '', vorname: '', date: '', klasse: '' }); }}>Ändern / Löschen</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <label className="upload-zone" style={{ borderBottomRightRadius: 0, borderBottomLeftRadius: 0, marginBottom: 0, padding: '1rem', flex: 1 }}>
                        <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => handleExcelUpload(e.target.files[0], 'A')} />
                        <div className="icon" style={{ fontSize: '2rem', marginBottom: '0.2rem' }}>📂</div>
                        <p style={{ fontSize: '0.85rem' }}>Excel-Datei hochladen (.xlsx)</p>
                      </label>
                      <button 
                        className="btn btn-secondary" 
                        style={{ borderTopRightRadius: 0, borderTopLeftRadius: 0, width: '100%', padding: '0.75rem', fontWeight: 'bold' }}
                        onClick={() => setShowPasteModal('A')}
                      >
                        oder Tabelle einfügen (Strg+V)
                      </button>
                    </div>
                  )}
                </div>
                <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="card-title">Liste B – Essensbuchungen</div>
                  {rawB ? (
                    <div className="upload-zone has-data" style={{ cursor: 'default' }}>
                      <div className="icon">✅</div>
                      <p>{rawB.data.length} Zeilen geladen</p>
                      <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => { setRawB(null); setColMapB({ nachname: '', vorname: '', date: '', klasse: '' }); }}>Ändern / Löschen</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <label className="upload-zone" style={{ borderBottomRightRadius: 0, borderBottomLeftRadius: 0, marginBottom: 0, padding: '1rem', flex: 1 }}>
                        <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => handleExcelUpload(e.target.files[0], 'B')} />
                        <div className="icon" style={{ fontSize: '2rem', marginBottom: '0.2rem' }}>📂</div>
                        <p style={{ fontSize: '0.85rem' }}>Excel-Datei hochladen (.xlsx)</p>
                      </label>
                      <button 
                        className="btn btn-secondary" 
                        style={{ borderTopRightRadius: 0, borderTopLeftRadius: 0, width: '100%', padding: '0.75rem', fontWeight: 'bold' }}
                        onClick={() => setShowPasteModal('B')}
                      >
                        oder Tabelle einfügen (Strg+V)
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {(rawA || rawB) && (
                <div className="action-row">
                  <span />
                  <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!rawA && !rawB}>
                    Weiter: Spalten zuordnen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* SCHRITT 2: Spalten zuordnen */}
          {!isLoading && step === 2 && (
            <div>
              <div className="two-col">
                <div className="card">
                  <div className="card-title">Liste A – Spalten</div>
                  <ColMapper raw={rawA} colMap={colMapA} onChange={setColMapA} label="A" />
                </div>
                <div className="card">
                  <div className="card-title">Liste B – Spalten</div>
                  <ColMapper raw={rawB} colMap={colMapB} onChange={setColMapB} label="B" />
                </div>
              </div>
              <div className="action-row">
                <button className="btn btn-ghost" onClick={() => setStep(1)}>Zurück</button>
                <button className="btn btn-primary" onClick={processAndUpload}
                  disabled={!(rawA && colMapA.nachname && colMapA.date) && !(rawB && colMapB.nachname && colMapB.date)}>
                  Verarbeiten & Vergleichen
                </button>
              </div>
            </div>
          )}

          {/* SCHRITT 3: Prüfen */}
          {!isLoading && step === 3 && (
            <div>
              {/* Datenquelle-Warnung: DB statt Upload */}
              {(usedDbForA || usedDbForB) && (
                <div className="info-box" style={{ marginBottom: '1rem', background: 'rgba(230,168,23,0.1)', border: '1px solid var(--warning)' }}>
                  ⚠️ <strong>Hinweis:</strong>{' '}
                  {usedDbForA && usedDbForB
                    ? 'Beide Listen stammen aus der Datenbank (kein neuer Upload).'
                    : usedDbForA
                      ? 'Liste A stammt aus der Datenbank — nur Liste B wurde neu hochgeladen.'
                      : 'Liste B stammt aus der Datenbank — nur Liste A wurde neu hochgeladen.'}
                  {' '}Für einen komplett frischen Vergleich beide Listen hochladen.
                </div>
              )}

              {/* Zusammenfassung: Was wurde automatisch zugeordnet */}
              {comparisonSummary && (
                <div className="stat-grid" style={{ marginBottom: '1rem' }}>
                  <div className="stat-card accent-green" style={{ padding: '0.75rem 1rem' }}>
                    <div className="stat-label" style={{ fontSize: '0.7rem' }}>Exakte Treffer</div>
                    <div className="stat-value" style={{ fontSize: '1.5rem' }}>{comparisonSummary.exact}</div>
                    <div className="stat-sub">{comparisonSummary.exactKinder} Kinder · automatisch zugeordnet</div>
                  </div>
                  <div className="stat-card accent-orange" style={{ padding: '0.75rem 1rem' }}>
                    <div className="stat-label" style={{ fontSize: '0.7rem' }}>Ähnliche Namen</div>
                    <div className="stat-value" style={{ fontSize: '1.5rem' }}>{potentialMatches.length}</div>
                    <div className="stat-sub">{potentialMatches.length === 1 ? 'Vorschlag' : 'Vorschläge'} zur Prüfung</div>
                  </div>
                  <div className="stat-card accent-blue" style={{ padding: '0.75rem 1rem' }}>
                    <div className="stat-label" style={{ fontSize: '0.7rem' }}>Gesamt geladen</div>
                    <div className="stat-value" style={{ fontSize: '1.5rem' }}>{comparisonSummary.totalA}</div>
                    <div className="stat-sub">Einträge A · {comparisonSummary.totalB} Einträge B</div>
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-title">
                  Mögliche Übereinstimmungen
                  <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>
                    {openGroups.length} offen
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => bulkAction('accept', 90)}>Alle &gt;90% akzeptieren</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => bulkAction('reject')}>Alle übrigen ablehnen</button>
                </div>

                {openGroups.length === 0 && potentialMatches.length === 0 && (
                  <p style={{ color: 'var(--text2)' }}>Keine ähnlichen Namen gefunden — alle Einträge wurden exakt zugeordnet oder haben keine Entsprechung.</p>
                )}
                {openGroups.length === 0 && potentialMatches.length > 0 && (
                  <p style={{ color: 'var(--text2)' }}>Alle Vorschläge überprüft.</p>
                )}

                {openGroups.map(group => {
                  const cls = scoreClass(group.score);
                  const analysis = analyzeMatch(group.nameA, group.nameB);
                  return (
                    <div key={group.nameA + group.nameB} className={`match-card ${cls}`}>
                      <div className="match-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, flexWrap: 'wrap' }}>
                          <span className={`score-pill ${cls}`}>{group.score}%</span>
                          <div>
                            <div className="name-tokens">
                              <strong>A:</strong>
                              {analysis.tokensA.map((t, i) => <span key={i} className={`token ${t.matched ? 'matched' : 'unmatched'}`}>{t.token}</span>)}
                              <span style={{ color: 'var(--text2)', margin: '0 0.25rem' }}>↔</span>
                              <strong>B:</strong>
                              {analysis.tokensB.map((t, i) => <span key={i} className={`token ${t.matched ? 'matched' : 'unmatched'}`}>{t.token}</span>)}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: '0.3rem' }}>
                              {group.reason} · {group.entries.length} Einträge · {fmtDate(group.entries[0]?.entryA.date)}
                            </div>
                          </div>
                        </div>
                        <div className="match-actions">
                          <button className="btn btn-success btn-sm" onClick={() => handleGroupAction(group, 'accept')}>✓</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleGroupAction(group, 'reject')}>✗</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="action-row">
                <button className="btn btn-ghost" onClick={() => setStep(1)}>Zurück</button>
                <button className="btn btn-primary" onClick={() => setStep(4)}>Ergebnisse anzeigen</button>
              </div>
            </div>
          )}

          {/* SCHRITT 4: Ergebnis */}
          {!isLoading && step === 4 && (() => {
            // Einträge nach Kind gruppieren
            const groupByKind = (entries) => {
              const map = {};
              entries.forEach(e => {
                if (!map[e.name]) map[e.name] = { name: e.name, dateSet: new Set() };
                map[e.name].dateSet.add(e.date);
              });
              return Object.values(map).map(k => ({ name: k.name, dates: [...k.dateSet] })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
            };
            const matchedKinder = groupByKind(finalResults.matches);
            const fehlendeKinder = groupByKind(finalResults.onlyInA);
            const nurInBKinder = groupByKind(finalResults.onlyInB);

            return (
              <div>
                <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
                  <div className="stat-card accent-green">
                    <div className="stat-label">Übereinstimmung</div>
                    <div className="stat-value">{matchedKinder.length}</div>
                    <div className="stat-sub">{matchedKinder.length === 1 ? 'Kind' : 'Kinder'} · {finalResults.matches.length} Tage</div>
                  </div>
                  <div className="stat-card accent-red">
                    <div className="stat-label">Fehlt in B</div>
                    <div className="stat-value">{fehlendeKinder.length}</div>
                    <div className="stat-sub">{fehlendeKinder.length === 1 ? 'Kind' : 'Kinder'} · {finalResults.onlyInA.length} Tage ohne Buchung</div>
                  </div>
                  <div className="stat-card accent-orange">
                    <div className="stat-label">Nur in B</div>
                    <div className="stat-value">{nurInBKinder.length}</div>
                    <div className="stat-sub">{nurInBKinder.length === 1 ? 'Kind' : 'Kinder'} · {finalResults.onlyInB.length} Tage ohne Anmeldung</div>
                  </div>
                </div>

                {fehlendeKinder.length > 0 && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <div className="card-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      Fehlt in Liste B <span className="badge badge-red" style={{ marginLeft: '0.5rem' }}>{fehlendeKinder.length} Kinder · {finalResults.onlyInA.length} Tage</span>
                      <button className="btn btn-ghost btn-sm" style={{ width: 'auto', fontSize: '0.75rem', marginLeft: 'auto' }}
                        onClick={() => {
                          const bName = blocks.find(bl => String(bl.id) === String(blockId))?.name || '';
                          const printData = fehlendeKinder.map(k => {
                            const parts = k.name.split(' ');
                            return { vorname: parts[0] || '', nachname: parts.slice(1).join(' ') || k.name, klasse: '', dates: k.dates };
                          });
                          printFehlendeKinder('Fehlende Kinder — OHNE Buchung', printData, bName);
                        }}>🖨️ Drucken</button>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Name</th><th>Tage</th><th>Daten</th></tr></thead>
                        <tbody>
                          {fehlendeKinder.map(k => (
                            <tr key={k.name}>
                              <td><strong>{k.name}</strong></td>
                              <td><span className="badge badge-red">{k.dates.length}</span></td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {matchedKinder.length > 0 && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <div className="card-title" style={{ color: 'var(--success)' }}>
                      Übereinstimmungen <span className="badge badge-green" style={{ marginLeft: '0.5rem' }}>{matchedKinder.length} Kinder · {finalResults.matches.length} Tage</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Name</th><th>Tage</th><th>Daten</th></tr></thead>
                        <tbody>
                          {matchedKinder.map(k => (
                            <tr key={k.name}>
                              <td><strong>{k.name}</strong></td>
                              <td><span className="badge badge-green">{k.dates.length}</span></td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {nurInBKinder.length > 0 && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <div className="card-title" style={{ color: 'var(--warning)' }}>
                      Nur in Liste B <span className="badge badge-orange" style={{ marginLeft: '0.5rem' }}>{nurInBKinder.length} Kinder · {finalResults.onlyInB.length} Tage</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Name</th><th>Tage</th><th>Daten</th></tr></thead>
                        <tbody>
                          {nurInBKinder.map(k => (
                            <tr key={k.name}>
                              <td><strong>{k.name}</strong></td>
                              <td><span className="badge badge-orange">{k.dates.length}</span></td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{k.dates.sort().map(d => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="action-row">
                  <button className="btn btn-ghost" onClick={() => setStep(3)}>Zurück</button>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-ghost" onClick={exportExcel}>Excel exportieren</button>
                    <button className="btn btn-primary" disabled={saving} onClick={saveAbgleich}>
                      {saving ? 'Speichern...' : 'In Datenbank speichern'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {showPasteModal && (
        <div className="modal-overlay" onClick={() => setShowPasteModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px', width: '90%' }}>
            <h2>Daten für Liste {showPasteModal} einfügen</h2>
            <p className="text-muted" style={{ marginBottom: '1rem' }}>Kopiere deine Daten aus Excel/Word und füge sie hier mit Strg+V ein.</p>
            <MiniExcel 
              onImport={(json) => { 
                setIsLoading(true); 
                processImportArray(json, showPasteModal); 
                setShowPasteModal(null);
              }} 
              label={showPasteModal} 
            />
            <div className="action-row" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowPasteModal(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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
      <div className="page-header">
        <h1>Finanzen</h1>
        <p>Kostenkalkulation: {data?.block?.preis_pro_tag || '3.50'} € pro Kind pro Tag</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <select className="ferienblock-select" value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {loading && <Spinner />}

      {!loading && data && data.statistik && (() => {
        // Excel-Export Funktion für Finanzen
        const exportFinanzen = () => {
          const wb = XLSX.utils.book_new();
          // Buchungen pro Kind
          if (data.buchungen?.length) {
            const rows = data.buchungen.map(k => ({
              Nachname: k.nachname, Vorname: k.vorname, Klasse: k.klasse || '',
              'Tage gebucht': parseInt(k.tage_gebucht), 'Gesamtbetrag (€)': parseFloat(k.gesamtbetrag).toFixed(2),
              Kontostand: k.kontostand ? parseFloat(k.kontostand).toFixed(2) : ''
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Buchungen');
          }
          // Fehlende
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
          <div className="stat-grid">
            <div className="stat-card accent-blue">
              <div className="stat-label">Kinder mit Buchung</div>
              <div className="stat-value">{data.statistik.kinder_mit_buchung}</div>
            </div>
            <div className="stat-card accent-green">
              <div className="stat-label">Gesamt gebuchte Mahlzeiten</div>
              <div className="stat-value">{data.statistik.gesamt_buchungen}</div>
            </div>
            <div className="stat-card accent-orange">
              <div className="stat-label">Gesamtbetrag</div>
              <div className="stat-value">{data.statistik.gesamt_betrag.toFixed(2)} €</div>
            </div>
            <div className="stat-card accent-red">
              <div className="stat-label">Ohne Buchung</div>
              <div className="stat-value">{data.statistik.kinder_ohne_buchung}</div>
              <div className="stat-sub">in A, nicht in B</div>
            </div>
          </div>

          <div className="toolbar">
            <button className="btn btn-ghost btn-sm" onClick={exportFinanzen}>📥 Als Excel exportieren</button>
          </div>

          {data.fehlende_buchungen?.length > 0 && (
            <div className="card">
              <div className="card-title" style={{ color: 'var(--danger)' }}>
                Fehlende Buchungen
                <span className="count-badge red">{data.fehlende_buchungen.length}</span>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
                Diese Kinder sind bei uns angemeldet, haben aber keine Buchung beim Caterer.
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Tage angemeldet</th></tr></thead>
                  <tbody>
                    {data.fehlende_buchungen.map((k, i) => (
                      <tr key={i}>
                        <td>{k.nachname}</td><td>{k.vorname}</td><td>{k.klasse || '–'}</td><td>{k.tage_angemeldet}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">Buchungen pro Kind</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Tage</th><th>Gesamtbetrag</th><th>Kontostand</th></tr>
                </thead>
                <tbody>
                  {data.buchungen.map((k, i) => (
                    <tr key={i}>
                      <td>{k.nachname}</td>
                      <td>{k.vorname}</td>
                      <td>{k.klasse || '–'}</td>
                      <td>{k.tage_gebucht}</td>
                      <td><strong>{parseFloat(k.gesamtbetrag).toFixed(2)} €</strong></td>
                      <td>{k.kontostand ? `${parseFloat(k.kontostand).toFixed(2)} €` : '–'}</td>
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
          <div className="stat-label" style={{ fontSize: '0.7rem' }}>✗ Fehlend in B</div>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{diff.newCounts.nur_in_a}</div>
          <div className="stat-sub">{fmtDelta(diff.delta.nur_in_a)} vs. vorher ({diff.oldCounts.nur_in_a})</div>
        </div>
        <div className="stat-card accent-orange" style={{ padding: '0.75rem 1rem' }}>
          <div className="stat-label" style={{ fontSize: '0.7rem' }}>⚠ Nur in B</div>
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

// VERLAUF
const VerlaufPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [verlauf, setVerlauf] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  // Vergleichsmodus
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareData, setCompareData] = useState({ a: null, b: null });
  const [compareLoading, setCompareLoading] = useState(false);

  const loadVerlauf = (id) => {
    if (!id) return;
    setLoading(true);
    setOpenId(null);
    setCompareMode(false); setCompareA(''); setCompareB(''); setCompareData({ a: null, b: null });
    API.get('abgleich', { ferienblock_id: id }).then(d => {
      setVerlauf(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  const loadComparison = async () => {
    if (!compareA || !compareB || compareA === compareB) return;
    setCompareLoading(true);
    const [resA, resB] = await Promise.all([
      API.get('abgleich', { abgleich_id: compareA }),
      API.get('abgleich', { abgleich_id: compareB })
    ]);
    setCompareData({ a: resA, b: resB });
    setCompareLoading(false);
  };

  useEffect(() => { loadVerlauf(blockId); }, [blockId]);

  const toggleDetail = async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (detail[id]) return;
    setDetailLoading(prev => ({ ...prev, [id]: true }));
    const res = await API.get('abgleich', { abgleich_id: id });
    setDetail(prev => ({ ...prev, [id]: res }));
    setDetailLoading(prev => ({ ...prev, [id]: false }));
  };

  const typConfig = [
    { key: 'exact', label: '✅ Exakte Treffer', badge: 'badge-green' },
    { key: 'fuzzy_accepted', label: '🟡 Angenommene Treffer', badge: 'badge-orange' },
    { key: 'fuzzy_rejected', label: '❌ Abgelehnte Vorschläge', badge: 'badge-red' },
    { key: 'nur_in_a', label: '⚠️ Nur in Liste A', badge: 'badge-red' },
    { key: 'nur_in_b', label: '📋 Nur in Liste B', badge: 'badge-blue' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Verlauf</h1>
        <p>Gespeicherte Abgleiche einsehen</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <select className="ferienblock-select" value={blockId}
            onChange={e => { setBlockId(e.target.value); setVerlauf([]); }}>
            <option value="">– Block wählen –</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
          </select>
          {blockId && <button className="btn btn-ghost btn-sm" onClick={() => loadVerlauf(blockId)}>↻ Neu laden</button>}
          {blockId && verlauf.length > 0 && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => {
              const ok = await confirmDialog(
                'Alle Abgleiche löschen',
                `Alle ${verlauf.length} gespeicherten Abgleiche für diesen Block löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
                'Alle löschen'
              );
              if (!ok) return;
              const res = await API.post('abgleich', { action: 'delete_all', ferienblock_id: blockId });
              toast.success(`${res.deleted} Abgleiche gelöscht`);
              setVerlauf([]); setDetail({}); setOpenId(null);
            }}>🗑 Alle Abgleiche löschen</button>
          )}
        </div>
      </div>

      {loading && <Spinner />}

      {!loading && !blockId && (
        <div className="card"><div className="empty-state"><div className="icon">📋</div><p>Bitte einen Ferienblock auswählen.</p></div></div>
      )}

      {!loading && blockId && verlauf.length === 0 && (
        <div className="card"><div className="empty-state"><div className="icon">📋</div><p>Noch keine Abgleiche für diesen Block gespeichert.</p></div></div>
      )}

      {/* ── Vergleichsmodus ── */}
      {!loading && blockId && verlauf.length >= 2 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>↔ Abgleiche vergleichen</span>
            <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }}
              onClick={() => { setCompareMode(!compareMode); setCompareData({ a: null, b: null }); setCompareA(''); setCompareB(''); }}>
              {compareMode ? '✗ Schließen' : '↔ Vergleichen'}
            </button>
          </div>
          {compareMode && (
            <div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Alter Abgleich (vorher)
                  </label>
                  <select className="form-input" value={compareA} onChange={e => { setCompareA(e.target.value); setCompareData({ a: null, b: null }); }}>
                    <option value="">– wählen –</option>
                    {verlauf.map(v => (
                      <option key={v.id} value={v.id} disabled={String(v.id) === String(compareB)}>
                        {fmtDateTime(v.erstellt_am)} — {v.matches_count || 0} Treffer, {v.nur_in_a_count || 0} fehlend
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: '1.5rem', color: 'var(--text2)', padding: '0 0.25rem 0.5rem' }}>→</div>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Neuer Abgleich (nachher)
                  </label>
                  <select className="form-input" value={compareB} onChange={e => { setCompareB(e.target.value); setCompareData({ a: null, b: null }); }}>
                    <option value="">– wählen –</option>
                    {verlauf.map(v => (
                      <option key={v.id} value={v.id} disabled={String(v.id) === String(compareA)}>
                        {fmtDateTime(v.erstellt_am)} — {v.matches_count || 0} Treffer, {v.nur_in_a_count || 0} fehlend
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary btn-sm" style={{ width: 'auto', marginBottom: '2px' }}
                  disabled={!compareA || !compareB || compareA === compareB || compareLoading}
                  onClick={loadComparison}>
                  {compareLoading ? '⏳ Lade…' : 'Vergleichen'}
                </button>
              </div>
              {compareLoading && <Spinner />}
              {!compareLoading && compareData.a?.matches && compareData.b?.matches && (
                <VergleichView
                  matchesOld={compareData.a.matches}
                  matchesNew={compareData.b.matches}
                  abgleichOld={compareData.a.abgleich}
                  abgleichNew={compareData.b.abgleich}
                />
              )}
            </div>
          )}
        </div>
      )}

      {!loading && verlauf.map(v => {
        const isOpen = openId === v.id;
        const d = detail[v.id];
        const dLoading = detailLoading[v.id];
        return (
          <div key={v.id} className="card" style={{ marginBottom: '1rem' }}>
            {/* Abgleich-Kopfzeile */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <strong>Abgleich vom {fmtDateTime(v.erstellt_am)}</strong>
                  <span className="badge badge-green">{v.status}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                  <span className="badge badge-green">✅ {v.matches_count} Treffer</span>
                  {parseInt(v.nur_in_a_count) > 0 && <span className="badge badge-red">⚠️ {v.nur_in_a_count} nur in A</span>}
                  {parseInt(v.nur_in_b_count) > 0 && <span className="badge badge-blue">📋 {v.nur_in_b_count} nur in B</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleDetail(v.id)}>
                  {isOpen ? '▲ Zuklappen' : '▼ Details anzeigen'}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', width: 'auto' }} title="Diesen Abgleich löschen" onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await confirmDialog('Abgleich löschen', `Abgleich vom ${fmtDateTime(v.erstellt_am)} löschen?`, 'Löschen');
                  if (!ok) return;
                  await API.post('abgleich', { action: 'delete', id: v.id });
                  toast.success('Abgleich gelöscht');
                  loadVerlauf(blockId);
                }}>✗</button>
              </div>
            </div>

            {/* Detail-Bereich */}
            {isOpen && (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                {dLoading && <Spinner />}
                {d && typConfig.map(({ key, label, badge }) => {
                  const items = d.matches?.filter(m => m.match_typ === key) || [];
                  if (!items.length) return null;
                  return (
                    <div key={key} style={{ marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{label}</strong>
                        <span className={`badge ${badge}`}>{items.length}</span>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Name A</th>
                              <th>Datum A</th>
                              {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th>Name B</th>}
                              {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th>Datum B</th>}
                              {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th>Score</th>}
                              {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <th>Grund</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {items.map(m => (
                              <tr key={m.id}>
                                <td>{m.a_vorname} {m.a_nachname}</td>
                                <td>{fmtDate(m.a_datum)}</td>
                                {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td>{m.b_vorname} {m.b_nachname}</td>}
                                {['exact', 'fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td>{fmtDate(m.b_datum)}</td>}
                                {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td><span className={`badge ${m.score >= 90 ? 'badge-green' : m.score >= 75 ? 'badge-orange' : 'badge-red'}`}>{m.score}%</span></td>}
                                {['fuzzy_accepted', 'fuzzy_rejected'].includes(key) && <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{m.grund}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── TAGESANSICHT ─────────────────────────────────────
const TagesansichtPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [abgleichMatches, setAbgleichMatches] = useState([]);
  const [hasAbgleich, setHasAbgleich] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [sortCol, setSortCol] = useState('nachname');
  const [sortDir, setSortDir] = useState('asc');

  const load = async (id) => {
    if (!id) return;
    setLoading(true);
    const [a, b, abl] = await Promise.all([
      API.get('listen', { ferienblock_id: id, liste: 'A' }),
      API.get('listen', { ferienblock_id: id, liste: 'B' }),
      API.get('abgleich', { ferienblock_id: id })
    ]);
    setListA(Array.isArray(a) ? a : []);
    setListB(Array.isArray(b) ? b : []);
    // Letzten Abgleich laden wenn vorhanden
    const abgleiche = Array.isArray(abl) ? abl : abl?.abgleiche || [];
    if (abgleiche.length > 0) {
      const letzter = abgleiche[0]; // neuester (API liefert DESC sortiert)
      const detail = await API.get('abgleich', { abgleich_id: letzter.id });
      setAbgleichMatches(Array.isArray(detail?.matches) ? detail.matches : []);
      setHasAbgleich(true);
    } else {
      setAbgleichMatches([]);
      setHasAbgleich(false);
    }
    setSelectedDate(null);
    setLoading(false);
  };

  useEffect(() => { if (blockId) load(blockId); }, [blockId]);

  // Matchings aus Abgleich-Ergebnissen aufbereiten
  const { matchedAIds, matchedBIds, bToAMap } = useMemo(() => {
    const aIds = new Set();
    const bIds = new Set();
    const b2a = new Map(); // B-entry-ID → A-entry-ID
    abgleichMatches.forEach(m => {
      if ((m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted') && m.liste_a_id && m.liste_b_id) {
        aIds.add(m.liste_a_id);
        bIds.add(m.liste_b_id);
        b2a.set(m.liste_b_id, m.liste_a_id);
      }
    });
    return { matchedAIds: aIds, matchedBIds: bIds, bToAMap: b2a };
  }, [abgleichMatches]);

  // Alle Tage sammeln
  const allDates = useMemo(() => {
    const dates = new Set();
    listA.forEach(e => dates.add(String(e.datum).split('T')[0]));
    listB.forEach(e => dates.add(String(e.datum).split('T')[0]));
    return [...dates].sort();
  }, [listA, listB]);

  // Tagesübersicht berechnen — nutzt Abgleich-Ergebnisse wenn vorhanden
  const dayStats = useMemo(() => {
    return allDates.map(d => {
      const aDay = listA.filter(e => String(e.datum).split('T')[0] === d);
      const bDay = listB.filter(e => String(e.datum).split('T')[0] === d);
      const aKids = new Set(aDay.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
      const bKids = new Set(bDay.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));

      if (hasAbgleich) {
        // Nutze echte Abgleich-Ergebnisse
        const aMatched = aDay.filter(e => matchedAIds.has(e.id));
        const aMissing = aDay.filter(e => !matchedAIds.has(e.id));
        const bOnly = bDay.filter(e => !matchedBIds.has(e.id));
        // Unique Kinder zählen
        const matchedKids = new Set(aMatched.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        const missingKids = new Set(aMissing.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        const onlyBKids = new Set(bOnly.map(e => (e.nachname + '|' + e.vorname).toLowerCase()));
        return { date: d, angemeldet: aKids.size, gebucht: bKids.size, matched: matchedKids.size, missingInB: missingKids.size, onlyInB: onlyBKids.size };
      } else {
        // Kein Abgleich vorhanden — nur Zählen, kein Matching
        return { date: d, angemeldet: aKids.size, gebucht: bKids.size, matched: null, missingInB: null, onlyInB: null };
      }
    });
  }, [allDates, listA, listB, hasAbgleich, matchedAIds, matchedBIds]);

  // Detail für gewählten Tag — nutzt Abgleich-Ergebnisse
  const dayDetail = useMemo(() => {
    if (!selectedDate) return null;
    const d = selectedDate;
    const aEntries = listA.filter(e => String(e.datum).split('T')[0] === d);
    const bEntries = listB.filter(e => String(e.datum).split('T')[0] === d);

    if (hasAbgleich) {
      // Mit Abgleich: Nutze echte Match-Ergebnisse
      // Schritt 1: Alle A-Kinder einfügen, nach DB-ID indexiert
      const kinderById = {}; // a_entry_id → kind-Objekt
      const kinder = {};     // name-key → kind-Objekt (für Deduplizierung gleicher A-Namen)
      aEntries.forEach(e => {
        const key = (e.nachname + '|' + e.vorname).toLowerCase();
        if (!kinder[key]) {
          const kind = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: true, inB: matchedAIds.has(e.id) };
          kinder[key] = kind;
          kinderById[e.id] = kind;
        } else {
          kinderById[e.id] = kinder[key];
          if (matchedAIds.has(e.id)) kinder[key].inB = true;
        }
      });

      // Schritt 2: B-Kinder verarbeiten
      bEntries.forEach(e => {
        if (matchedBIds.has(e.id)) {
          // Gematcht → dem zugehörigen A-Kind zuordnen (nicht als separaten Eintrag!)
          const aId = bToAMap.get(e.id);
          if (aId && kinderById[aId]) {
            kinderById[aId].inB = true;
          }
          // Falls Klasse in B vorhanden aber nicht in A, übernehmen
          if (aId && kinderById[aId] && !kinderById[aId].klasse && e.klasse) {
            kinderById[aId].klasse = e.klasse;
          }
        } else {
          // Nicht gematcht → als "Nur in B" hinzufügen
          const key = (e.nachname + '|' + e.vorname).toLowerCase();
          if (!kinder[key]) {
            kinder[key] = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: false, inB: true };
          }
        }
      });
      return Object.values(kinder);
    } else {
      // Ohne Abgleich: Zeige einfach alle Kinder mit ihrer Listenzugehörigkeit
      const kinder = {};
      aEntries.forEach(e => {
        const key = (e.nachname + '|' + e.vorname).toLowerCase();
        if (!kinder[key]) kinder[key] = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: true, inB: false };
      });
      bEntries.forEach(e => {
        const key = (e.nachname + '|' + e.vorname).toLowerCase();
        if (kinder[key]) { kinder[key].inB = true; }
        else kinder[key] = { nachname: e.nachname, vorname: e.vorname, klasse: e.klasse || '', inA: false, inB: true };
      });
      return Object.values(kinder);
    }
  }, [selectedDate, listA, listB, hasAbgleich, matchedAIds, matchedBIds, bToAMap]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortedDetail = useMemo(() => {
    if (!dayDetail) return [];
    return [...dayDetail].sort((a, b) => {
      let va, vb;
      if (sortCol === 'status') { va = a.inA && a.inB ? 2 : a.inA ? 1 : 0; vb = b.inA && b.inB ? 2 : b.inA ? 1 : 0; }
      else { va = (a[sortCol] || '').toLowerCase(); vb = (b[sortCol] || '').toLowerCase(); }
      const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb, 'de');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [dayDetail, sortCol, sortDir]);

  const sIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const block = blocks.find(b => String(b.id) === String(blockId));
  const weekday = (d) => { try { return new Date(d).toLocaleDateString('de-DE', { weekday: 'short' }); } catch { return ''; } };

  return (
    <div>
      <div className="page-header">
        <h1>Tagesansicht</h1>
        <p>Welche Kinder sind pro Tag angemeldet und gebucht?</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <select className="ferienblock-select" value={blockId} onChange={e => setBlockId(e.target.value)}>
          <option value="">– Block wählen –</option>
          {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
        </select>
      </div>

      {loading && <Spinner />}

      {!loading && blockId && dayStats.length === 0 && (
        <div className="card"><div className="empty-state"><div className="icon">📅</div><p>Keine Daten für diesen Block vorhanden.</p></div></div>
      )}

      {!loading && dayStats.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            Tage im Überblick
            {!hasAbgleich && <span style={{ fontSize: '0.78rem', color: 'var(--text2)', fontWeight: 400 }}>– Führe zuerst einen Abgleich durch für OK/Fehlt/Nur-in-B Spalten</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tag</th><th>Datum</th><th>Angemeldet (A)</th><th>Gebucht (B)</th>{hasAbgleich && <><th>✓ OK</th><th>✗ Fehlt in B</th><th>⚠ Nur in B</th></>}<th></th></tr></thead>
              <tbody>
                {dayStats.map(d => (
                  <tr key={d.date} style={{ background: selectedDate === d.date ? 'rgba(0,90,156,0.08)' : undefined, cursor: 'pointer' }} onClick={() => setSelectedDate(selectedDate === d.date ? null : d.date)}>
                    <td><strong>{weekday(d.date)}</strong></td>
                    <td>{fmtDate(d.date)}</td>
                    <td><span className="badge badge-blue">{d.angemeldet}</span></td>
                    <td><span className="badge badge-green">{d.gebucht}</span></td>
                    {hasAbgleich && <>
                      <td><span className="badge badge-green">{d.matched}</span></td>
                      <td>{d.missingInB > 0 ? <span className="badge badge-red">{d.missingInB}</span> : <span style={{ color: 'var(--text2)' }}>0</span>}</td>
                      <td>{d.onlyInB > 0 ? <span className="badge badge-orange">{d.onlyInB}</span> : <span style={{ color: 'var(--text2)' }}>0</span>}</td>
                    </>}
                    <td style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>{selectedDate === d.date ? '▲' : '▼'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedDate && dayDetail && (
        <div className="card">
          <div className="card-title">
            {weekday(selectedDate)} {fmtDate(selectedDate)} — {dayDetail.length} Kinder
          </div>
          {hasAbgleich && (
            <div className="stat-grid" style={{ marginBottom: '1rem' }}>
              <div className="stat-card accent-green" style={{ padding: '0.75rem 1rem' }}>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Angemeldet + Gebucht</div>
                <div className="stat-value" style={{ fontSize: '1.5rem' }}>{dayDetail.filter(k => k.inA && k.inB).length}</div>
              </div>
              <div className={`stat-card ${dayDetail.filter(k => k.inA && !k.inB).length > 0 ? 'accent-red' : 'accent-green'}`} style={{ padding: '0.75rem 1rem' }}>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Angemeldet, nicht gebucht</div>
                <div className="stat-value" style={{ fontSize: '1.5rem' }}>{dayDetail.filter(k => k.inA && !k.inB).length}</div>
              </div>
              <div className="stat-card accent-orange" style={{ padding: '0.75rem 1rem' }}>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Nur gebucht (nicht angemeldet)</div>
                <div className="stat-value" style={{ fontSize: '1.5rem' }}>{dayDetail.filter(k => !k.inA && k.inB).length}</div>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>#</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('nachname')}>Nachname{sIcon('nachname')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('vorname')}>Vorname{sIcon('vorname')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('klasse')}>Klasse{sIcon('klasse')}</th>
                {hasAbgleich && <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>Status{sIcon('status')}</th>}
                <th>Liste</th>
              </tr></thead>
              <tbody>
                {sortedDetail.map((k, i) => (
                  <tr key={i} style={{ background: hasAbgleich && k.inA && !k.inB ? 'rgba(220,53,69,0.06)' : hasAbgleich && !k.inA && k.inB ? 'rgba(230,168,23,0.06)' : undefined }}>
                    <td>{i + 1}</td>
                    <td><strong>{k.nachname}</strong></td>
                    <td>{k.vorname}</td>
                    <td>{k.klasse || '–'}</td>
                    {hasAbgleich && <td>
                      {k.inA && k.inB && <span className="badge badge-green">✓ OK</span>}
                      {k.inA && !k.inB && <span className="badge badge-red">✗ Fehlt in B</span>}
                      {!k.inA && k.inB && <span className="badge badge-orange">⚠ Nur in B</span>}
                    </td>}
                    <td style={{ fontSize: '0.8rem' }}>
                      {k.inA && <span className="badge badge-blue" style={{ marginRight: 3 }}>A</span>}
                      {k.inB && <span className="badge badge-green">B</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── KLASSEN-ZUSAMMENFASSUNG ──────────────────────────
const KlassenPage = ({ blocks }) => {
  const [blockId, setBlockId] = useState(blocks[0]?.id || '');
  const [listA, setListA] = useState([]);
  const [listB, setListB] = useState([]);
  const [abgleichMatches, setAbgleichMatches] = useState([]);
  const [hasAbgleich, setHasAbgleich] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (id) => {
    if (!id) return;
    setLoading(true);
    const [a, b, abl] = await Promise.all([
      API.get('listen', { ferienblock_id: id, liste: 'A' }),
      API.get('listen', { ferienblock_id: id, liste: 'B' }),
      API.get('abgleich', { ferienblock_id: id })
    ]);
    setListA(Array.isArray(a) ? a : []);
    setListB(Array.isArray(b) ? b : []);
    const abgleiche = Array.isArray(abl) ? abl : abl?.abgleiche || [];
    if (abgleiche.length > 0) {
      const letzter = abgleiche[0]; // neuester (API liefert DESC sortiert)
      const detail = await API.get('abgleich', { abgleich_id: letzter.id });
      setAbgleichMatches(Array.isArray(detail?.matches) ? detail.matches : []);
      setHasAbgleich(true);
    } else {
      setAbgleichMatches([]);
      setHasAbgleich(false);
    }
    setLoading(false);
  };

  useEffect(() => { if (blockId) load(blockId); }, [blockId]);

  // Gematchte IDs aus Abgleich
  const { matchedAIds, matchedBIds } = useMemo(() => {
    const aIds = new Set(), bIds = new Set();
    abgleichMatches.forEach(m => {
      if ((m.match_typ === 'exact' || m.match_typ === 'fuzzy_accepted') && m.liste_a_id && m.liste_b_id) {
        aIds.add(m.liste_a_id);
        bIds.add(m.liste_b_id);
      }
    });
    return { matchedAIds: aIds, matchedBIds: bIds };
  }, [abgleichMatches]);

  const klassenData = useMemo(() => {
    const map = {};
    const normKlasse = (k) => (k || 'Ohne Klasse').trim() || 'Ohne Klasse';

    // Kinder aus A sammeln
    listA.forEach(e => {
      const key = (e.nachname + '|' + e.vorname).toLowerCase();
      const klasse = normKlasse(e.klasse);
      if (!map[klasse]) map[klasse] = { klasse, kinderA: new Set(), kinderB: new Set(), tageA: 0, tageB: 0, matchedA: new Set() };
      map[klasse].kinderA.add(key);
      map[klasse].tageA++;
      if (hasAbgleich && matchedAIds.has(e.id)) map[klasse].matchedA.add(key);
    });
    // Kinder aus B: nur Tage und unique Kinder zählen
    listB.forEach(e => {
      const klasse = normKlasse(e.klasse);
      const key = (e.nachname + '|' + e.vorname).toLowerCase();
      if (!map[klasse]) map[klasse] = { klasse, kinderA: new Set(), kinderB: new Set(), tageA: 0, tageB: 0, matchedA: new Set() };
      map[klasse].kinderB.add(key);
      map[klasse].tageB++;
    });

    return Object.values(map).map(k => {
      let ohneB, nurInB;
      if (hasAbgleich) {
        // Mit Abgleich: Kinder ohne Match = nicht gematcht
        ohneB = k.kinderA.size - k.matchedA.size;
        // Nur in B: B-Kinder die nicht gematcht sind
        const matchedBKeys = new Set();
        listB.forEach(e => {
          if (matchedBIds.has(e.id) && normKlasse(e.klasse) === k.klasse) {
            matchedBKeys.add((e.nachname + '|' + e.vorname).toLowerCase());
          }
        });
        nurInB = [...k.kinderB].filter(x => !matchedBKeys.has(x)).length;
      } else {
        // Ohne Abgleich: einfacher Namensvergleich (Schätzung)
        ohneB = [...k.kinderA].filter(x => !k.kinderB.has(x)).length;
        nurInB = [...k.kinderB].filter(x => !k.kinderA.has(x)).length;
      }
      return {
        klasse: k.klasse,
        kinderA: k.kinderA.size,
        kinderB: k.kinderB.size,
        tageA: k.tageA,
        tageB: k.tageB,
        ohneB,
        nurInB,
      };
    }).sort((a, b) => a.klasse.localeCompare(b.klasse, 'de'));
  }, [listA, listB, hasAbgleich, matchedAIds, matchedBIds]);

  const block = blocks.find(b => String(b.id) === String(blockId));
  const preis = block ? parseFloat(block.preis_pro_tag) : 3.5;

  return (
    <div>
      <div className="page-header">
        <h1>Klassen-Übersicht</h1>
        <p>Statistiken gruppiert nach Schulklasse</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <select className="ferienblock-select" value={blockId} onChange={e => setBlockId(e.target.value)}>
            <option value="">– Block wählen –</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({fmtDate(b.startdatum)} – {fmtDate(b.enddatum)})</option>)}
          </select>
          {klassenData.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const wb = XLSX.utils.book_new();
              const rows = klassenData.map(k => ({
                Klasse: k.klasse, 'Kinder (A)': k.kinderA, 'Kinder (B)': k.kinderB,
                'Tage (A)': k.tageA, 'Tage (B)': k.tageB,
                'Fehlt in B': k.ohneB, 'Nur in B': k.nurInB,
                'Kosten (€)': (k.tageB * preis).toFixed(2)
              }));
              XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Klassen');
              XLSX.writeFile(wb, `Klassen_${block?.name || 'Export'}.xlsx`);
              toast.success('Klassen-Übersicht exportiert');
            }}>📊 Excel exportieren</button>
          )}
        </div>
      </div>

      {loading && <Spinner />}

      {!loading && blockId && klassenData.length === 0 && (
        <div className="card"><div className="empty-state"><div className="icon">🏫</div><p>Keine Daten für diesen Block vorhanden.</p></div></div>
      )}

      {!loading && klassenData.length > 0 && (
        <div className="card">
          {!hasAbgleich && <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem', fontStyle: 'italic' }}>
            Hinweis: Ohne Abgleich basieren "Fehlt in B" und "Nur in B" auf einfachem Namensvergleich (ungenau bei unterschiedlicher Schreibweise).
          </p>}
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Klasse</th><th>Kinder (A)</th><th>Kinder (B)</th>
                <th>Tage (A)</th><th>Tage (B)</th>
                <th title="Kinder aus A ohne Entsprechung in B">✗ Fehlt in B</th><th title="Kinder nur in B, nicht in A">⚠ Nur in B</th><th>Kosten</th>
              </tr></thead>
              <tbody>
                {klassenData.map(k => (
                  <tr key={k.klasse}>
                    <td><strong>{k.klasse}</strong></td>
                    <td><span className="badge badge-blue">{k.kinderA}</span></td>
                    <td><span className="badge badge-green">{k.kinderB}</span></td>
                    <td style={{ color: 'var(--text2)' }}>{k.tageA}</td>
                    <td style={{ color: 'var(--text2)' }}>{k.tageB}</td>
                    <td>{k.ohneB > 0 ? <span className="badge badge-red">{k.ohneB}</span> : <span style={{ color: 'var(--text2)' }}>0</span>}</td>
                    <td>{k.nurInB > 0 ? <span className="badge badge-orange">{k.nurInB}</span> : <span style={{ color: 'var(--text2)' }}>0</span>}</td>
                    <td><strong>{(k.tageB * preis).toFixed(2)} €</strong></td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td>Gesamt</td>
                  <td>{klassenData.reduce((s, k) => s + k.kinderA, 0)}</td>
                  <td>{klassenData.reduce((s, k) => s + k.kinderB, 0)}</td>
                  <td>{klassenData.reduce((s, k) => s + k.tageA, 0)}</td>
                  <td>{klassenData.reduce((s, k) => s + k.tageB, 0)}</td>
                  <td style={{ color: 'var(--danger)' }}>{klassenData.reduce((s, k) => s + k.ohneB, 0)}</td>
                  <td style={{ color: 'var(--warning)' }}>{klassenData.reduce((s, k) => s + k.nurInB, 0)}</td>
                  <td>{(klassenData.reduce((s, k) => s + k.tageB, 0) * preis).toFixed(2)} €</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// EINSTELLUNGEN
const EinstellungenPage = ({ user, onLogout }) => {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const changePassword = async () => {
    if (pw1 !== pw2) { setErr('Passwörter stimmen nicht überein'); return; }
    if (pw1.length < 8) { setErr('Mindestens 8 Zeichen'); return; }
    const res = await API.post('auth', { action: 'change-password', token: API.token(), newPassword: pw1 });
    if (res.success) { setMsg('Passwort geändert!'); setPw1(''); setPw2(''); setErr(''); }
    else setErr(res.error);
  };

  // ── Backup: Export ──
  const exportBackup = async () => {
    setBackupLoading(true);
    try {
      const data = await API.get('backup');
      if (data.error) { toast.error('Backup fehlgeschlagen: ' + data.error); return; }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
      a.href = url;
      a.download = `backup_${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup heruntergeladen');
    } catch (e) {
      toast.error('Backup-Fehler: ' + e.message);
    } finally {
      setBackupLoading(false);
    }
  };

  // ── Backup: Import ──
  const importBackup = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const ok = await confirmDialog(
      'Backup wiederherstellen',
      'ACHTUNG: Alle bestehenden Daten werden ÜBERSCHRIEBEN! Ferienblöcke, Listen, Abgleiche und Kinder werden durch die Backup-Daten ersetzt. Diese Aktion kann nicht rückgängig gemacht werden.',
      'Wiederherstellen'
    );
    if (!ok) return;

    setRestoreLoading(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.data) {
        toast.error('Ungültiges Backup-Format: "data"-Feld fehlt');
        return;
      }

      const res = await API.post('backup', { action: 'import', data: backup.data });
      if (res.success) {
        toast.success('Backup wiederhergestellt! Seite wird neu geladen…');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error('Restore fehlgeschlagen: ' + (res.error || 'Unbekannter Fehler'));
      }
    } catch (err) {
      toast.error('Fehler beim Lesen der Datei: ' + err.message);
    } finally {
      setRestoreLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Einstellungen</h1>
        <p>Konto, Sicherheit und Datensicherung</p>
      </div>

      <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 560 }}>
        {/* Passwort */}
        <div className="card">
          <div className="card-title">Passwort ändern</div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
            Angemeldet als: <strong>{user?.username}</strong>
          </p>
          {err && <div className="error-msg">{err}</div>}
          {msg && <div style={{ background: '#efe', border: '1px solid #8c8', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>{msg}</div>}
          <div className="form-group">
            <label>Neues Passwort</label>
            <input className="form-input" type="password" value={pw1} onChange={e => setPw1(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Passwort wiederholen</label>
            <input className="form-input" type="password" value={pw2} onChange={e => setPw2(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={changePassword} disabled={!pw1 || !pw2}>Passwort ändern</button>
          <hr />
          <button className="btn btn-danger" onClick={onLogout}>Abmelden</button>
        </div>

        {/* Backup */}
        <div className="card">
          <div className="card-title">💾 Datensicherung (Backup)</div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
            Erstelle ein vollständiges Backup aller Daten (Ferienblöcke, Listen, Abgleiche, Kinder) als JSON-Datei.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button className="btn btn-primary" onClick={exportBackup} disabled={backupLoading} style={{ width: 'auto' }}>
              {backupLoading ? '⏳ Exportiere…' : '📥 Backup herunterladen'}
            </button>

            <label className="btn btn-ghost" style={{ width: 'auto', cursor: restoreLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              {restoreLoading ? '⏳ Wiederherstelle…' : '📤 Backup wiederherstellen'}
              <input type="file" accept=".json" onChange={importBackup} style={{ display: 'none' }} disabled={restoreLoading} />
            </label>
          </div>

          <div style={{ fontSize: '0.82rem', color: 'var(--text2)', background: 'var(--surface2)', padding: '0.75rem', borderRadius: '8px', lineHeight: 1.5 }}>
            <strong>Hinweis:</strong> Beim Wiederherstellen werden alle bestehenden Daten überschrieben.
            Erstelle vorher ein frisches Backup, falls du die aktuellen Daten behalten möchtest.
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── KINDER-VERZEICHNIS ──────────────────────────────
// Avatar-Farbe aus Name generieren (konsistent)
const avatarColors = ['#005A9C', '#28a745', '#dc3545', '#e6a817', '#17a2b8', '#6f42c1', '#e83e8c', '#fd7e14', '#20c997', '#4dabf7'];
const getAvatarColor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return avatarColors[Math.abs(h) % avatarColors.length];
};
const Avatar = ({ vorname, nachname, size = 'md' }) => {
  const initials = ((vorname || '').charAt(0) + (nachname || '').charAt(0)).toUpperCase();
  const color = getAvatarColor((nachname || '') + (vorname || ''));
  return <div className={`avatar avatar-${size}`} style={{ background: color }}>{initials}</div>;
};

const KinderVerzeichnis = ({ blocks, onNavigate, initialKindId }) => {
  const [kinder, setKinder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [filterBlock, setFilterBlock] = useState('');

  // Akte-Detail
  const [selectedKindId, setSelectedKindId] = useState(initialKindId || null);
  const [akte, setAkte] = useState(null);
  const [akteLoading, setAkteLoading] = useState(false);

  // Import
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  // Edit-Modal
  const [editKind, setEditKind] = useState(null);
  const [editForm, setEditForm] = useState({ nachname: '', vorname: '', klasse: '', notizen: '' });

  // Duplikat-Erkennung
  const [showDuplicates, setShowDuplicates] = useState(false);
  const duplicates = useMemo(() => {
    if (!showDuplicates || kinder.length < 2) return [];
    const groups = [];
    const checked = new Set();
    for (let i = 0; i < kinder.length; i++) {
      if (checked.has(i)) continue;
      const a = kinder[i];
      const aName = (a.nachname + ' ' + a.vorname).toLowerCase();
      const similar = [];
      for (let j = i + 1; j < kinder.length; j++) {
        if (checked.has(j)) continue;
        const b = kinder[j];
        // Exakter Treffer (case-insensitive)
        const exact = a.nachname.toLowerCase() === b.nachname.toLowerCase() && a.vorname.toLowerCase() === b.vorname.toLowerCase();
        // Vertauscht
        const swapped = a.nachname.toLowerCase() === b.vorname.toLowerCase() && a.vorname.toLowerCase() === b.nachname.toLowerCase();
        // Ähnlich (Levenshtein-artig: einfache Prüfung)
        const bName = (b.nachname + ' ' + b.vorname).toLowerCase();
        const { score } = calcScore(aName, bName);

        const nameClose = aName.replace(/\s+/g, '') === bName.replace(/\s+/g, '') || aName.replace(/[^a-zäöüß]/g, '') === bName.replace(/[^a-zäöüß]/g, '');

        let matchReason = null;
        if (exact) matchReason = 'Exakt gleich';
        else if (swapped) matchReason = 'Vor-/Nachname vertauscht';
        else if (nameClose) matchReason = 'Sehr ähnlich (Lücken/Zeichen)';
        else if (score >= 82) matchReason = `Tippfehler? (Score ${score}%)`;

        if (matchReason) {
          similar.push({ kind: b, reason: matchReason });
          checked.add(j);
        }
      }
      if (similar.length > 0) {
        checked.add(i);
        groups.push({ kind: a, matches: similar });
      }
    }
    return groups;
  }, [kinder, showDuplicates]);

  // Sortierung
  const [sortBy, setSortBy] = useState('nachname');
  const [sortDir, setSortDir] = useState('asc');
  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };
  const sortIndicator = (col) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const loadKinder = async (fbId) => {
    setLoading(true);
    const params = {};
    if (fbId) params.ferienblock_id = fbId;
    const data = await API.get('kinder', params);
    setKinder(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { loadKinder(filterBlock); }, [filterBlock]);

  // Akte laden wenn Kind ausgewählt
  useEffect(() => {
    if (!selectedKindId) { setAkte(null); return; }
    setAkteLoading(true);
    API.get('kinder', { id: selectedKindId }).then(data => {
      setAkte(data.kind ? data : null);
      setAkteLoading(false);
    });
  }, [selectedKindId]);

  // Aus Listen synchronisieren
  const syncFromLists = async () => {
    setSyncing(true);
    const res = await API.post('kinder', { action: 'sync' });
    setSyncing(false);
    toast.success(res.message || 'Synchronisiert');
    loadKinder(filterBlock);
  };

  // Excel importieren
  // Import: Spalten-Zuordnung
  const [importCols, setImportCols] = useState({ name: '', nachname: '', vorname: '', klasse: '' });
  const [importHeaders, setImportHeaders] = useState([]);
  const [importPreview, setImportPreview] = useState([]);

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) { toast.error('Datei ist leer'); return; }

      // Header erkennen (erste Zeile Text = Header, sonst auto)
      const firstRow = rows[0];
      const isHeader = firstRow.every(c => typeof c === 'string' && c.trim().length > 0);
      let headers;
      let dataRows;
      if (isHeader) {
        headers = firstRow.map(h => String(h).trim());
        dataRows = rows.slice(1);
      } else {
        headers = firstRow.map((_, i) => `Spalte ${String.fromCharCode(65 + i)}`);
        dataRows = rows;
      }

      setImportHeaders(headers);
      setImportData(dataRows);
      setImportPreview(dataRows.slice(0, 5));
      setImportResult(null);

      // Auto-Zuordnung
      const hLow = headers.map(h => h.toLowerCase());
      const autoName = hLow.findIndex(h => h === 'name' || h === 'kind' || h === 'schüler');
      const autoNachname = hLow.findIndex(h => h.includes('nachname'));
      const autoVorname = hLow.findIndex(h => h.includes('vorname'));
      const autoKlasse = hLow.findIndex(h => h.includes('klasse') || h.includes('class'));

      if (autoNachname >= 0 && autoVorname >= 0) {
        // Separate Nachname + Vorname Spalten
        setImportCols({ name: '', nachname: String(autoNachname), vorname: String(autoVorname), klasse: autoKlasse >= 0 ? String(autoKlasse) : '' });
      } else if (autoName >= 0) {
        // Kombiniertes "Name" Feld
        setImportCols({ name: String(autoName), nachname: '', vorname: '', klasse: autoKlasse >= 0 ? String(autoKlasse) : '' });
      } else {
        setImportCols({ name: '', nachname: '', vorname: '', klasse: '' });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Name splitten: "Marie Müller" → { vorname: "Marie", nachname: "Müller" }
  // "Müller, Marie" → { nachname: "Müller", vorname: "Marie" }
  const splitName = (fullName) => {
    const s = fullName.trim();
    if (!s) return { vorname: '', nachname: '' };
    // Komma-Trennung: "Müller, Marie"
    if (s.includes(',')) {
      const parts = s.split(',').map(p => p.trim());
      return { nachname: parts[0], vorname: parts.slice(1).join(' ') };
    }
    // Leerzeichen-Trennung: "Marie Müller" → Vorname = alles bis auf letztes Wort
    const parts = s.split(/\s+/);
    if (parts.length === 1) return { vorname: parts[0], nachname: '' };
    const nachname = parts.pop();
    return { vorname: parts.join(' '), nachname };
  };

  const getImportPreviewEntries = () => {
    const rows = importPreview;
    return rows.map(row => {
      let vorname = '', nachname = '', klasse = '';
      if (importCols.name !== '') {
        const split = splitName(String(row[parseInt(importCols.name)] || ''));
        vorname = split.vorname;
        nachname = split.nachname;
      } else {
        nachname = importCols.nachname !== '' ? String(row[parseInt(importCols.nachname)] || '').trim() : '';
        vorname = importCols.vorname !== '' ? String(row[parseInt(importCols.vorname)] || '').trim() : '';
      }
      klasse = importCols.klasse !== '' ? String(row[parseInt(importCols.klasse)] || '').trim() : '';
      return { vorname, nachname, klasse };
    });
  };

  const executeImport = async () => {
    if (!importData || importData.length === 0) return;
    if (importCols.name === '' && importCols.nachname === '' && importCols.vorname === '') {
      toast.error('Bitte mindestens Name oder Nachname+Vorname zuordnen');
      return;
    }
    setImporting(true);

    const eintraege = [];
    for (const row of importData) {
      let vorname = '', nachname = '', klasse = '';
      if (importCols.name !== '') {
        const split = splitName(String(row[parseInt(importCols.name)] || ''));
        vorname = split.vorname;
        nachname = split.nachname;
      } else {
        nachname = importCols.nachname !== '' ? String(row[parseInt(importCols.nachname)] || '').trim() : '';
        vorname = importCols.vorname !== '' ? String(row[parseInt(importCols.vorname)] || '').trim() : '';
      }
      klasse = importCols.klasse !== '' ? String(row[parseInt(importCols.klasse)] || '').trim() : '';
      if (nachname && vorname) eintraege.push({ nachname, vorname, klasse });
    }

    const res = await API.post('kinder', { action: 'import', eintraege });
    setImportResult(res);
    setImporting(false);
    loadKinder(filterBlock);
  };

  // Kind bearbeiten
  const startEdit = (k) => {
    setEditKind(k);
    setEditForm({ nachname: k.nachname, vorname: k.vorname, klasse: k.klasse || '', notizen: k.notizen || '' });
  };
  const saveEdit = async () => {
    await API.post('kinder', { action: 'edit', id: editKind.id, ...editForm });
    setEditKind(null);
    loadKinder(filterBlock);
    if (selectedKindId === editKind.id) setSelectedKindId(editKind.id); // refresh akte
  };

  // Kind löschen
  const deleteKind = async (id) => {
    const ok = await confirmDialog('Kind löschen', 'Kind aus Stammverzeichnis löschen? Die Listen-Einträge bleiben erhalten.', 'Löschen');
    if (!ok) return;
    await API.post('kinder', { action: 'delete', id });
    toast.success('Kind gelöscht');
    loadKinder(filterBlock);
    if (selectedKindId === id) setSelectedKindId(null);
  };

  // Kind (Duplikat) zusammenführen
  const mergeKind = async (hauptId, typoId) => {
    const ok = await confirmDialog(
      'Mit Haupt-Eintrag zusammenführen', 
      'Möchtest du den Tippfehler unwiderruflich in den Haupt-Eintrag überführen? Alle bisherigen Anmeldungen und Buchungen des Tippfehlers werden auf den Haupt-Namen überschrieben, und das Duplikat verschwindet.', 
      'Ja, zusammenführen'
    );
    if (!ok) return;
    const res = await API.post('kinder', { action: 'merge', haupt_id: hauptId, typo_id: typoId });
    if (res.success) {
      toast.success('Kinder erfolgreich zusammengeführt!');
      loadKinder(filterBlock);
      if (selectedKindId === typoId) setSelectedKindId(hauptId);
    }
  };

  // Filter + Sortierung
  const filtered = kinder.filter(k =>
    (k.nachname + ' ' + k.vorname + ' ' + (k.klasse || ''))
      .toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => {
    let va, vb;
    switch (sortBy) {
      case 'nachname': va = (a.nachname || '').toLowerCase(); vb = (b.nachname || '').toLowerCase(); break;
      case 'vorname': va = (a.vorname || '').toLowerCase(); vb = (b.vorname || '').toLowerCase(); break;
      case 'klasse': va = (a.klasse || '').toLowerCase(); vb = (b.klasse || '').toLowerCase(); break;
      case 'bloecke': va = parseInt(a.block_count_a) || 0; vb = parseInt(b.block_count_a) || 0; break;
      case 'anmeldungen': va = parseInt(a.anmeldungen_count) || 0; vb = parseInt(b.anmeldungen_count) || 0; break;
      case 'buchungen': va = parseInt(a.buchungen_count) || 0; vb = parseInt(b.buchungen_count) || 0; break;
      default: va = (a.nachname || '').toLowerCase(); vb = (b.nachname || '').toLowerCase();
    }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  // ═══════════════════════════════════════
  // AKTE-DETAILANSICHT (Design-Upgrade)
  // ═══════════════════════════════════════
  if (selectedKindId) {
    if (akteLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><Spinner /></div>;
    if (!akte) return <div className="card"><p style={{ color: 'var(--danger)', padding: '2rem', textAlign: 'center' }}>Kind nicht gefunden</p><button className="btn btn-ghost btn-sm" onClick={() => setSelectedKindId(null)}>← Zurück zur Liste</button></div>;

    const { kind, aliases, blocks: akteBlocks, summary } = akte;

    // Kurzer Wochentag aus Datum
    const weekday = (d) => {
      try { return new Date(d).toLocaleDateString('de-DE', { weekday: 'short' }); } catch { return ''; }
    };

    return (
      <div>
        {/* Zurück-Link */}
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedKindId(null)} style={{ marginBottom: '1rem' }}>
          ← Zurück zur Übersicht
        </button>

        {/* ── PROFIL-KARTE ── */}
        <div className="akte-profile">
          <div className="akte-profile-actions">
            <button className="btn btn-sm" onClick={() => startEdit(kind)}>✎ Bearbeiten</button>
          </div>
          <div className="akte-profile-top">
            <Avatar vorname={kind.vorname} nachname={kind.nachname} size="lg" />
            <div>
              <div className="akte-profile-name">{kind.vorname} {kind.nachname}</div>
              {kind.klasse && <span className="akte-profile-klasse">Klasse {kind.klasse}</span>}
              {aliases && aliases.length > 0 && (
                <div className="akte-profile-aliases">Auch bekannt als: {aliases.join(', ')}</div>
              )}
            </div>
          </div>
          <div className="akte-stats-row">
            <div className="akte-stat">
              <div className="val">{summary.total_blocks}</div>
              <div className="lbl">Ferienblöcke</div>
            </div>
            <div className="akte-stat">
              <div className="val">{summary.total_anmeldungen}</div>
              <div className="lbl">Tage angemeldet</div>
            </div>
            <div className="akte-stat">
              <div className="val">{summary.total_buchungen}</div>
              <div className="lbl">Tage gebucht</div>
            </div>
            <div className="akte-stat">
              <div className="val">{summary.total_kosten.toFixed(0)} €</div>
              <div className="lbl">Gesamtkosten</div>
            </div>
          </div>
        </div>

        {/* ── NOTIZEN ── */}
        {kind.notizen && (
          <div className="akte-notes">
            <span className="akte-notes-icon">📝</span>
            <div className="akte-notes-text">{kind.notizen}</div>
          </div>
        )}

        {/* ── FERIENBLÖCKE TIMELINE ── */}
        {akteBlocks.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="icon">📭</div>
              <p>Keine Einträge in den Listen gefunden.</p>
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text2)' }}>
              Verlauf ({akteBlocks.length} {akteBlocks.length === 1 ? 'Block' : 'Blöcke'})
            </h3>
            <div className="akte-timeline">
              {akteBlocks.map(b => {
                const aDates = new Set(b.anmeldungen.map(a => String(a.datum).split('T')[0]));
                const bDates = new Set(b.buchungen.map(x => String(x.datum).split('T')[0]));
                const allDates = [...new Set([...aDates, ...bDates])].sort();
                const matchedDays = allDates.filter(d => aDates.has(d) && bDates.has(d)).length;
                const missingDays = [...aDates].filter(d => !bDates.has(d)).length;
                const extraDays = [...bDates].filter(d => !aDates.has(d)).length;

                // Block-Status für Timeline-Punkt
                const statusClass = missingDays > 0 ? 'status-miss' : extraDays > 0 ? 'status-warn' : 'status-ok';

                return (
                  <div className={`akte-block ${statusClass}`} key={b.ferienblock_id}>
                    <div className="akte-block-card">
                      <div className="akte-block-head">
                        <div>
                          <h3>{b.block_name}</h3>
                          <div className="meta">{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</div>
                        </div>
                        <div className="akte-block-badges">
                          {b.klasse && <span className="badge badge-blue">Klasse {b.klasse}</span>}
                          {b.match_status && (
                            <span className={`badge ${b.match_status === 'exact' || b.match_status === 'fuzzy_accepted' ? 'badge-green'
                                : b.match_status === 'nur_in_a' ? 'badge-red' : 'badge-orange'
                              }`}>
                              {b.match_status === 'exact' ? '✓ Exakt' : b.match_status === 'fuzzy_accepted' ? '≈ Fuzzy' : b.match_status === 'nur_in_a' ? '✗ Fehlt in B' : b.match_status === 'nur_in_b' ? '⚠ Nur in B' : b.match_status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Anmeldungen (A) */}
                      <div className="days-section">
                        <div className="days-section-title">
                          Anmeldungen (A) <span className="count">{b.anmeldungen.length} Tage</span>
                        </div>
                        <div className="days-grid">
                          {[...aDates].sort().map(d => {
                            const inB = bDates.has(d);
                            return (
                              <div key={'a' + d} className={`day-chip ${inB ? 'matched' : 'missing'}`}>
                                <span className="day-icon">{inB ? '✓' : '✗'}</span>
                                <span>{weekday(d)} {fmtDate(d)}</span>
                              </div>
                            );
                          })}
                          {b.anmeldungen.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Keine Anmeldungen</span>}
                        </div>
                      </div>

                      {/* Buchungen (B) */}
                      <div className="days-section">
                        <div className="days-section-title">
                          Buchungen (B) <span className="count">{b.buchungen.length} Tage</span>
                        </div>
                        <div className="days-grid">
                          {[...bDates].sort().map(d => {
                            const inA = aDates.has(d);
                            const buchung = b.buchungen.find(x => String(x.datum).split('T')[0] === d);
                            return (
                              <div key={'b' + d} className={`day-chip ${inA ? 'matched' : 'extra'}`} title={buchung?.menu || ''}>
                                <span className="day-icon">{inA ? '✓' : '⚠'}</span>
                                <span>{weekday(d)} {fmtDate(d)}</span>
                                {buchung?.menu && <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({buchung.menu})</span>}
                              </div>
                            );
                          })}
                          {b.buchungen.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Keine Buchungen</span>}
                        </div>
                      </div>

                      {/* Block-Zusammenfassung */}
                      <div className="block-summary-row">
                        <span>✓ <strong>{matchedDays}</strong> übereinstimmend</span>
                        {missingDays > 0 && <span style={{ color: 'var(--danger)' }}>✗ <strong>{missingDays}</strong> ohne Buchung</span>}
                        {extraDays > 0 && <span style={{ color: 'var(--warning)' }}>⚠ <strong>{extraDays}</strong> ohne Anmeldung</span>}
                        <span style={{ marginLeft: 'auto' }}><strong>{b.kosten.toFixed(2)} €</strong></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editKind && (
          <div className="modal-overlay" onClick={() => setEditKind(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>Kind bearbeiten</h3>
              <div className="form-group">
                <label>Nachname</label>
                <input className="form-input" value={editForm.nachname} onChange={e => setEditForm({ ...editForm, nachname: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Vorname</label>
                <input className="form-input" value={editForm.vorname} onChange={e => setEditForm({ ...editForm, vorname: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Klasse</label>
                <input className="form-input" value={editForm.klasse} onChange={e => setEditForm({ ...editForm, klasse: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notizen</label>
                <textarea className="textarea" style={{ minHeight: '80px' }} value={editForm.notizen} onChange={e => setEditForm({ ...editForm, notizen: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setEditKind(null)}>Abbrechen</button>
                <button className="btn btn-primary" style={{ width: 'auto' }} onClick={saveEdit}>Speichern</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════
  // LISTENANSICHT (Design-Upgrade)
  // ═══════════════════════════════════════
  const mitBuchung = kinder.filter(k => parseInt(k.buchungen_count) > 0).length;
  const ohneBuchung = kinder.filter(k => parseInt(k.anmeldungen_count) > 0 && parseInt(k.buchungen_count) === 0).length;

  // Sortier-Buttons für Mobile + Desktop
  const sortOptions = [
    { key: 'nachname', label: 'Nachname' },
    { key: 'vorname', label: 'Vorname' },
    { key: 'klasse', label: 'Klasse' },
    { key: 'anmeldungen', label: 'Anmeldungen' },
    { key: 'buchungen', label: 'Buchungen' },
  ];

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Kinder-Verzeichnis</h1>
          <p>Alle registrierten Kinder mit ihren Akten</p>
        </div>
      </div>

      {/* Ferienblock-Filter */}
      {blocks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap' }}>Statistik für:</span>
          <select
            className="form-input"
            style={{ maxWidth: '300px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
            value={filterBlock}
            onChange={e => setFilterBlock(e.target.value)}
          >
            <option value="">Alle Ferienblöcke</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card accent-blue">
          <div className="stat-label">{filterBlock ? 'Angemeldet (A)' : 'Kinder gesamt'}</div>
          <div className="stat-value">{loading ? '…' : filterBlock ? kinder.filter(k => parseInt(k.anmeldungen_count) > 0).length : kinder.length}</div>
        </div>
        <div className="stat-card accent-green">
          <div className="stat-label">{filterBlock ? 'Gebucht (B)' : 'Mit Buchungen'}</div>
          <div className="stat-value">{loading ? '…' : mitBuchung}</div>
        </div>
        <div className={`stat-card ${ohneBuchung > 0 ? 'accent-red' : 'accent-green'}`}>
          <div className="stat-label">Ohne Buchung</div>
          <div className="stat-value">{loading ? '…' : ohneBuchung}</div>
          <div className="stat-sub">{ohneBuchung > 0 ? 'Angemeldet aber keine Buchung' : ''}</div>
        </div>
      </div>

      <div className="toolbar">
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => setShowImport(!showImport)}>
          {showImport ? '✗ Import schließen' : '📥 Excel importieren'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={syncing} onClick={syncFromLists}>
          {syncing ? '⏳ Synchronisiere...' : '🔄 Aus Listen synchronisieren'}
        </button>
        {kinder.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const wb = XLSX.utils.book_new();
            const rows = filtered.map(k => ({
              Nachname: k.nachname,
              Vorname: k.vorname,
              Klasse: k.klasse || '',
              'Anmeldungen (A)': parseInt(k.anmeldungen_count) || 0,
              'Buchungen (B)': parseInt(k.buchungen_count) || 0,
              'Blöcke': parseInt(k.block_count_a) || 0,
              Notizen: k.notizen || ''
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Kinder');
            XLSX.writeFile(wb, `Kinder-Verzeichnis${search ? '_' + search : ''}.xlsx`);
            toast.success(`${rows.length} Kinder exportiert`);
          }}>📊 Excel exportieren</button>
        )}
        {kinder.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => {
            const ok = await confirmDialog(
              'Alle Kinder löschen',
              `Wirklich alle ${kinder.length} Kinder aus dem Verzeichnis löschen? Die Listen-Einträge (A/B) bleiben erhalten.`,
              'Alle löschen'
            );
            if (!ok) return;
            const res = await API.post('kinder', { action: 'delete_all' });
            toast.success(`${res.deleted} Kinder gelöscht`);
            loadKinder(filterBlock);
          }}>🗑 Alle löschen</button>
        )}
        {kinder.length > 1 && (
          <button className={`btn btn-ghost btn-sm ${showDuplicates ? 'btn-active' : ''}`} onClick={() => setShowDuplicates(!showDuplicates)}>
            🔎 Duplikate {showDuplicates && duplicates.length > 0 ? `(${duplicates.length})` : 'prüfen'}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => loadKinder(filterBlock)}>↻ Aktualisieren</button>
      </div>

      {/* Duplikat-Warnung */}
      {showDuplicates && duplicates.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--warning)' }}>
          <div className="card-title" style={{ color: 'var(--warning)', marginBottom: '0.5rem' }}>⚠ {duplicates.length} mögliche Duplikate gefunden</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1.5rem' }}>Es sieht so aus, als wären folgende Kinder mehrfach angelegt. Schau auf die Zahl der Anmeldungen (A) und Buchungen (B) und lösche den überflüssigen Eintrag.</p>

          {duplicates.map((g, i) => {
            const allEntries = [{ kind: g.kind, reason: 'Haupt-Eintrag' }, ...g.matches.map(m => ({ kind: m.kind, reason: m.reason }))];
            return (
              <div key={i} style={{ padding: '1rem', background: 'var(--bg)', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.5px' }}>Duplikat-Gruppe {i + 1}</div>
                {allEntries.map((e, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0', borderBottom: j < allEntries.length - 1 ? '1px dashed var(--border)' : 'none', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1rem' }}>{e.kind.vorname} {e.kind.nachname}</strong>
                    {e.kind.klasse && <span className="badge badge-blue">Kl. {e.kind.klasse}</span>}

                    <span style={{ fontSize: '0.85rem', color: 'var(--text)', background: 'rgba(0,0,0,0.04)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      <strong>A:</strong> {parseInt(e.kind.anmeldungen_count) || 0} | <strong>B:</strong> {parseInt(e.kind.buchungen_count) || 0}
                    </span>

                    <span className="badge badge-orange">{e.reason}</span>

                    <span style={{ marginLeft: 'auto' }} />
                    {j > 0 && (
                      <button
                        className="btn btn-sm"
                        style={{ color: 'var(--primary)', width: 'auto', padding: '0.3rem 0.75rem', background: 'rgba(0,90,156,0.1)', border: 'none', marginRight: '0.5rem' }}
                        onClick={() => mergeKind(allEntries[0].kind.id, e.kind.id)}
                      >
                        🔗 Zu Haupt-Eintrag
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      style={{ color: 'var(--danger)', width: 'auto', padding: '0.3rem 0.75rem', background: 'rgba(220,53,69,0.1)', border: 'none' }}
                      onClick={() => deleteKind(e.kind.id)}
                    >
                      ✗ Löschen
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {showDuplicates && duplicates.length === 0 && (
        <div className="info-box" style={{ marginBottom: '1.5rem' }}>✅ Keine Duplikate gefunden — alle {kinder.length} Kinder sind eindeutig.</div>
      )}

      {/* Import-Bereich */}
      {showImport && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-title">Kinder-Stammliste importieren</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1rem' }}>
            Excel-Datei hochladen und Spalten zuordnen. Duplikate werden automatisch übersprungen.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ marginBottom: '1rem' }} />

          {importHeaders.length > 0 && (
            <div>
              <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>{importData.length} Zeilen erkannt — Spalten zuordnen:</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', maxWidth: '600px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>
                    Name (kombiniert) <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>— ODER Nachname+Vorname getrennt</span>
                  </label>
                  <select className="form-input" value={importCols.name}
                    onChange={e => setImportCols({ ...importCols, name: e.target.value, nachname: e.target.value ? '' : importCols.nachname, vorname: e.target.value ? '' : importCols.vorname })}>
                    <option value="">– nicht verwenden –</option>
                    {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>Klasse (optional)</label>
                  <select className="form-input" value={importCols.klasse}
                    onChange={e => setImportCols({ ...importCols, klasse: e.target.value })}>
                    <option value="">– nicht verwenden –</option>
                    {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
                {importCols.name === '' && (
                  <>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>Nachname *</label>
                      <select className="form-input" value={importCols.nachname}
                        onChange={e => setImportCols({ ...importCols, nachname: e.target.value })}>
                        <option value="">– wählen –</option>
                        {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '0.3rem' }}>Vorname *</label>
                      <select className="form-input" value={importCols.vorname}
                        onChange={e => setImportCols({ ...importCols, vorname: e.target.value })}>
                        <option value="">– wählen –</option>
                        {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>

              {importCols.name !== '' && (
                <div className="info-box" style={{ marginBottom: '1rem' }}>
                  Kombiniertes Namensfeld erkannt — wird automatisch in Vor-/Nachname getrennt.<br />
                  <span style={{ fontSize: '0.8rem' }}>Format: "Vorname Nachname" oder "Nachname, Vorname"</span>
                </div>
              )}

              {/* Vorschau */}
              {(importCols.name !== '' || (importCols.nachname !== '' && importCols.vorname !== '')) && (() => {
                const preview = getImportPreviewEntries();
                return (
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem' }}>Vorschau (erste {preview.length}):</p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Vorname</th><th>Nachname</th><th>Klasse</th></tr></thead>
                        <tbody>
                          {preview.map((e, i) => (
                            <tr key={i} style={!e.nachname || !e.vorname ? { background: 'rgba(220,53,69,0.08)' } : {}}>
                              <td>{e.vorname || <span style={{ color: 'var(--danger)' }}>–fehlt–</span>}</td>
                              <td>{e.nachname || <span style={{ color: 'var(--danger)' }}>–fehlt–</span>}</td>
                              <td>{e.klasse || '–'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={importing} onClick={executeImport}>
                {importing ? 'Importiere...' : `${importData.length} Kinder importieren`}
              </button>
            </div>
          )}

          {importResult && (
            <div className="info-box" style={{ marginTop: '1rem' }}>
              ✓ {importResult.message}
              {importResult.skipped_names?.length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>Übersprungen: {importResult.skipped_names.join(', ')}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Suche + Sortierung */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="search-wrap" style={{ flex: '1', minWidth: '200px', marginBottom: 0 }}>
          <span className="search-icon">🔍</span>
          <input
            className="form-input"
            placeholder="Kind suchen (Name, Klasse)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>Sortieren:</span>
          <select className="form-input" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto', padding: '0.4rem 0.5rem', fontSize: '0.85rem' }} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Kinder-Ergebnis Zähler */}
      {!loading && filtered.length > 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
          {filtered.length} {filtered.length === 1 ? 'Kind' : 'Kinder'}{search ? ` für "${search}"` : ''}
        </div>
      )}

      {/* Kinder-Liste */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👦</div>
            <p>{kinder.length === 0
              ? 'Noch keine Kinder registriert. Importiere eine Excel-Liste oder synchronisiere aus den bestehenden Listen.'
              : 'Keine Kinder gefunden für "' + search + '"'
            }</p>
          </div>
        ) : (
          filtered.map(k => {
            const aCount = parseInt(k.anmeldungen_count) || 0;
            const bCount = parseInt(k.buchungen_count) || 0;
            const fehlend = aCount > 0 && bCount === 0;
            return (
              <div key={k.id} className="kind-row" onClick={() => setSelectedKindId(k.id)}>
                <Avatar vorname={k.vorname} nachname={k.nachname} size="md" />
                <div className="kind-row-info">
                  <div className="kind-row-name">{k.vorname} {k.nachname}</div>
                  <div className="kind-row-meta">
                    {k.klasse ? `Klasse ${k.klasse}` : 'Keine Klasse'}
                    {' · '}
                    {parseInt(k.block_count_a) || 0} {(parseInt(k.block_count_a) || 0) === 1 ? 'Block' : 'Blöcke'}
                  </div>
                </div>
                <div className="kind-row-stats">
                  <div className="kind-mini-stat">
                    <div className="val" style={{ color: 'var(--primary)' }}>{aCount}</div>
                    <div className="lbl">Anmeld.</div>
                  </div>
                  <div className="kind-mini-stat">
                    <div className="val" style={{ color: fehlend ? 'var(--danger)' : bCount > 0 ? 'var(--success)' : 'var(--text2)' }}>{bCount}</div>
                    <div className="lbl">Buchung.</div>
                  </div>
                </div>
                <div className="kind-row-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => startEdit(k)} title="Bearbeiten">✎</button>
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => deleteKind(k.id)} title="Löschen">✗</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit Modal */}
      {editKind && (
        <div className="modal-overlay" onClick={() => setEditKind(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Kind bearbeiten</h3>
            <div className="form-group">
              <label>Nachname</label>
              <input className="form-input" value={editForm.nachname} onChange={e => setEditForm({ ...editForm, nachname: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Vorname</label>
              <input className="form-input" value={editForm.vorname} onChange={e => setEditForm({ ...editForm, vorname: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Klasse</label>
              <input className="form-input" value={editForm.klasse} onChange={e => setEditForm({ ...editForm, klasse: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Notizen</label>
              <textarea className="textarea" style={{ minHeight: '80px' }} value={editForm.notizen} onChange={e => setEditForm({ ...editForm, notizen: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditKind(null)}>Abbrechen</button>
              <button className="btn btn-primary" style={{ width: 'auto' }} onClick={saveEdit}>Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── ANGEBOTE PAGE ───────────────────────────────────
const STATUS_LABEL = {
  vollstaendig: { label: 'Vollständig', color: '#22c55e' },
  teilweise:    { label: 'Teilweise',   color: '#f59e0b' },
  nicht_gebucht:{ label: 'Kein Essen gebucht', color: '#ef4444' },
  nur_gebucht:  { label: 'Nur gebucht', color: '#8b5cf6' },
  nicht_vorhanden:{ label: 'Nicht vorhanden', color: '#94a3b8' },
};

const AngebotePage = ({ blocks }) => {
  const [angebote, setAngebote] = useState([]);
  const [selectedAngebot, setSelectedAngebot] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(null);
  const [createForm, setCreateForm] = useState({ name: '', ferienblock_id: '', beschreibung: '' });
  const [filterBlock, setFilterBlock] = useState('');
  // Kinder hinzufügen
  const [kinderSuche, setKinderSuche] = useState('');
  const [kinderListe, setKinderListe] = useState([]);
  const [kinderGefiltert, setKinderGefiltert] = useState([]);

  const loadAngebote = async (fbId = filterBlock) => {
    setLoadingList(true);
    const params = fbId ? { ferienblock_id: fbId } : {};
    const res = await API.get('angebote', params);
    setAngebote(Array.isArray(res) ? res : []);
    setLoadingList(false);
  };

  const loadDetail = async (id) => {
    setLoadingDetail(true);
    setDetailData(null);
    const res = await API.get('angebote', { id });
    setDetailData(res.error ? null : res);
    setLoadingDetail(false);
  };

  const loadKinder = async () => {
    const res = await API.get('kinder');
    setKinderListe(Array.isArray(res) ? res : []);
  };

  useEffect(() => { loadAngebote(); loadKinder(); }, []);

  useEffect(() => {
    if (!kinderSuche.trim()) { setKinderGefiltert([]); return; }
    const q = kinderSuche.toLowerCase();
    const bereits = detailData?.kinder?.map(k => k.id) || [];
    setKinderGefiltert(
      kinderListe.filter(k =>
        !bereits.includes(k.id) &&
        (k.nachname.toLowerCase().includes(q) || k.vorname.toLowerCase().includes(q) || (k.klasse || '').toLowerCase().includes(q))
      ).slice(0, 10)
    );
  }, [kinderSuche, kinderListe, detailData]);

  const handleFilterBlock = (val) => {
    setFilterBlock(val);
    loadAngebote(val);
    setSelectedAngebot(null);
    setDetailData(null);
  };

  const handleSelectAngebot = (a) => {
    setSelectedAngebot(a);
    loadDetail(a.id);
    setKinderSuche('');
  };

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.ferienblock_id) {
      toast.error('Name und Ferienblock sind Pflichtfelder');
      return;
    }
    const res = await API.post('angebote', { action: 'create', ...createForm });
    if (res.success) {
      toast.success('Angebot erstellt');
      setShowCreateForm(false);
      setCreateForm({ name: '', ferienblock_id: '', beschreibung: '' });
      await loadAngebote();
    }
  };

  const handleEdit = async () => {
    if (!showEditForm) return;
    const res = await API.post('angebote', { action: 'edit', id: showEditForm.id, name: showEditForm.name, beschreibung: showEditForm.beschreibung });
    if (res.success) {
      toast.success('Angebot aktualisiert');
      setShowEditForm(null);
      await loadAngebote();
      if (selectedAngebot?.id === showEditForm.id) loadDetail(showEditForm.id);
    }
  };

  const handleDelete = async (id, name) => {
    const ok = await confirmDialog('Angebot löschen', `"${name}" und alle zugeordneten Kinder wirklich löschen?`, 'Löschen');
    if (!ok) return;
    const res = await API.post('angebote', { action: 'delete', id });
    if (res.success) {
      toast.success('Angebot gelöscht');
      if (selectedAngebot?.id === id) { setSelectedAngebot(null); setDetailData(null); }
      await loadAngebote();
    }
  };

  const handleAddKind = async (kind) => {
    const res = await API.post('angebote', { action: 'add_kind', angebot_id: selectedAngebot.id, kind_id: kind.id });
    if (res.success) {
      toast.success(`${kind.vorname} ${kind.nachname} hinzugefügt`);
      setKinderSuche('');
      await loadDetail(selectedAngebot.id);
      await loadAngebote();
    }
  };

  const handleRemoveKind = async (kind) => {
    const ok = await confirmDialog('Kind entfernen', `${kind.vorname} ${kind.nachname} aus dem Angebot entfernen?`, 'Entfernen');
    if (!ok) return;
    const res = await API.post('angebote', { action: 'remove_kind', angebot_id: selectedAngebot.id, kind_id: kind.id });
    if (res.success) {
      toast.success(`${kind.vorname} ${kind.nachname} entfernt`);
      await loadDetail(selectedAngebot.id);
      await loadAngebote();
    }
  };

  const fmtDatum = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
  };

  return (
    <div style={{ display: 'flex', gap: '1.5rem', height: '100%', minHeight: 0 }}>

      {/* ── Linke Spalte: Angebotsliste ── */}
      <div style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Angebote</h2>
            <button className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }} onClick={() => setShowCreateForm(true)}>
              + Neu
            </button>
          </div>

          <select
            className="input"
            style={{ marginBottom: '0.5rem' }}
            value={filterBlock}
            onChange={e => handleFilterBlock(e.target.value)}
          >
            <option value="">Alle Ferienblöcke</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {loadingList ? <Spinner /> : (
            angebote.length === 0
              ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Keine Angebote vorhanden</p>
              : angebote.map(a => (
                <div
                  key={a.id}
                  onClick={() => handleSelectAngebot(a)}
                  style={{
                    padding: '0.6rem 0.75rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: selectedAngebot?.id === a.id ? 'var(--accent)' : 'var(--bg-hover)',
                    color: selectedAngebot?.id === a.id ? '#fff' : 'inherit',
                    marginBottom: '0.4rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.name}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>{a.block_name}</div>
                  </div>
                  <span style={{
                    background: selectedAngebot?.id === a.id ? 'rgba(255,255,255,0.25)' : 'var(--badge-bg)',
                    borderRadius: '12px',
                    padding: '1px 8px',
                    fontSize: '0.75rem'
                  }}>{a.kinder_count} Kinder</span>
                </div>
              ))
          )}
        </div>

        {/* Erstellen-Formular */}
        {showCreateForm && (
          <div className="card" style={{ padding: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Neues Angebot</h3>
            <input className="input" placeholder="Name (z.B. Fußball)" value={createForm.name}
              onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} style={{ marginBottom: '0.5rem' }} />
            <select className="input" value={createForm.ferienblock_id}
              onChange={e => setCreateForm(f => ({ ...f, ferienblock_id: e.target.value }))} style={{ marginBottom: '0.5rem' }}>
              <option value="">Ferienblock wählen</option>
              {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <textarea className="input" placeholder="Beschreibung (optional)" value={createForm.beschreibung}
              onChange={e => setCreateForm(f => ({ ...f, beschreibung: e.target.value }))}
              style={{ marginBottom: '0.75rem', minHeight: '60px', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={handleCreate}>Erstellen</button>
              <button className="btn btn-ghost" onClick={() => setShowCreateForm(false)}>Abbrechen</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Rechte Spalte: Detail ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedAngebot && (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Angebot aus der Liste auswählen oder neu erstellen
          </div>
        )}

        {selectedAngebot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Header */}
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              {showEditForm?.id === selectedAngebot.id ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <input className="input" value={showEditForm.name} onChange={e => setShowEditForm(f => ({ ...f, name: e.target.value }))}
                    style={{ flex: '1', minWidth: '140px' }} placeholder="Name" />
                  <input className="input" value={showEditForm.beschreibung || ''} onChange={e => setShowEditForm(f => ({ ...f, beschreibung: e.target.value }))}
                    style={{ flex: '2', minWidth: '160px' }} placeholder="Beschreibung" />
                  <button className="btn btn-primary" onClick={handleEdit}>Speichern</button>
                  <button className="btn btn-ghost" onClick={() => setShowEditForm(null)}>Abbrechen</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ margin: '0 0 0.2rem' }}>{selectedAngebot.name}</h2>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {selectedAngebot.block_name} &nbsp;·&nbsp;
                      {fmtDatum(selectedAngebot.startdatum)} – {fmtDatum(selectedAngebot.enddatum)}
                    </div>
                    {selectedAngebot.beschreibung && <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>{selectedAngebot.beschreibung}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }}
                      onClick={() => setShowEditForm({ id: selectedAngebot.id, name: selectedAngebot.name, beschreibung: selectedAngebot.beschreibung || '' })}>
                      Bearbeiten
                    </button>
                    <button className="btn btn-danger" style={{ fontSize: '0.8rem', width: 'auto' }}
                      onClick={() => handleDelete(selectedAngebot.id, selectedAngebot.name)}>
                      Löschen
                    </button>
                  </div>
                </div>
              )}
            </div>

            {loadingDetail ? <Spinner /> : detailData && (
              <>
                {/* Zusammenfassung */}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {Object.entries(STATUS_LABEL).map(([key, { label, color }]) => (
                    <div key={key} className="card" style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontSize: '0.8rem' }}>{label}:</span>
                      <strong style={{ fontSize: '0.9rem' }}>{detailData.summary[key]}</strong>
                    </div>
                  ))}
                </div>

                {/* Kind hinzufügen */}
                <div className="card" style={{ padding: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Kind hinzufügen</h3>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      placeholder="Name oder Klasse suchen..."
                      value={kinderSuche}
                      onChange={e => setKinderSuche(e.target.value)}
                    />
                    {kinderGefiltert.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                        background: 'var(--card-bg)', border: '1px solid var(--border)',
                        borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: '220px', overflowY: 'auto'
                      }}>
                        {kinderGefiltert.map(k => (
                          <div key={k.id}
                            style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                            onMouseDown={() => handleAddKind(k)}
                          >
                            <span>{k.nachname}, {k.vorname}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{k.klasse || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Kindertabelle */}
                <div className="card" style={{ padding: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>
                    Kinder ({detailData.kinder.length})
                  </h3>
                  {detailData.kinder.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Noch keine Kinder zugeordnet</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--border)' }}>
                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Name</th>
                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Klasse</th>
                            <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem' }}>Liste A</th>
                            <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem' }}>Liste B</th>
                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Status</th>
                            <th style={{ padding: '0.4rem 0.5rem' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.kinder.map(k => {
                            const s = STATUS_LABEL[k.status] || { label: k.status, color: '#94a3b8' };
                            return (
                              <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.5rem 0.5rem', fontWeight: 500 }}>
                                  {k.nachname}, {k.vorname}
                                </td>
                                <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-muted)' }}>{k.klasse || '—'}</td>
                                <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>
                                  <span title={k.tage_liste_a.join(', ') || 'keine Einträge'}>
                                    {k.tage_liste_a.length > 0
                                      ? <span style={{ color: '#22c55e', fontWeight: 600 }}>{k.tage_liste_a.length} Tage</span>
                                      : <span style={{ color: '#ef4444' }}>—</span>
                                    }
                                  </span>
                                </td>
                                <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>
                                  <span title={k.tage_liste_b.join(', ') || 'keine Einträge'}>
                                    {k.tage_liste_b.length > 0
                                      ? <span style={{ color: '#22c55e', fontWeight: 600 }}>{k.tage_liste_b.length} Tage</span>
                                      : <span style={{ color: '#ef4444' }}>—</span>
                                    }
                                  </span>
                                </td>
                                <td style={{ padding: '0.5rem 0.5rem' }}>
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                    fontSize: '0.78rem', fontWeight: 500
                                  }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0, display: 'inline-block' }} />
                                    {s.label}
                                  </span>
                                  {k.nur_in_a.length > 0 && (
                                    <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '2px' }}>
                                      Ohne Essen: {k.nur_in_a.map(d => {
                                        const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`;
                                      }).join(', ')}
                                    </div>
                                  )}
                                  {k.nur_in_b.length > 0 && (
                                    <div style={{ fontSize: '0.72rem', color: '#8b5cf6', marginTop: '2px' }}>
                                      Nur gebucht: {k.nur_in_b.map(d => {
                                        const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`;
                                      }).join(', ')}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>
                                  <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: '#ef4444' }}
                                    onClick={() => handleRemoveKind(k)}>
                                    Entfernen
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── HAUPT-APP ────────────────────────────────────────
const App = () => {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [navParam, setNavParam] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Token prüfen beim Start
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setChecking(false); return; }
    API.post('auth', { action: 'check', token }).then(res => {
      if (res.valid) { setUser(res.user); loadBlocks(); }
      else localStorage.removeItem('token');
      setChecking(false);
    }).catch(() => setChecking(false));
  }, []);

  const loadBlocks = async () => {
    const res = await API.get('ferienblock');
    setBlocks(Array.isArray(res) ? res : []);
  };

  const handleLogin = (u) => { setUser(u); loadBlocks(); };

  const handleLogout = async () => {
    await API.post('auth', { action: 'logout', token: API.token() });
    localStorage.removeItem('token');
    setUser(null);
    setPage('dashboard');
  };

  const navigate = (p, param = null) => { setPage(p); setNavParam(param); };

  if (checking) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Spinner /></div>;
  if (!user) return <LoginPage onLogin={handleLogin} />;

  const navItems = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { id: 'kinder', icon: '👦', label: 'Kinder' },
    { id: 'angebote', icon: '🎯', label: 'Angebote' },
    { id: 'abgleich', icon: '🔍', label: 'Abgleich' },
    { id: 'tagesansicht', icon: '🗓️', label: 'Tagesansicht' },
    { id: 'klassen', icon: '🏫', label: 'Klassen' },
    { id: 'finanzen', icon: '💶', label: 'Finanzen' },
    { id: 'verlauf', icon: '📋', label: 'Verlauf' },
    { id: 'ferienblock', icon: '📅', label: 'Ferienblöcke' },
    { id: 'einstellungen', icon: '⚙️', label: 'Einstellungen' },
  ];

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Prüfer</h2>
          <p>Ferienversorgung</p>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(n => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => navigate(n.id)}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">{user.username}</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="theme-toggle" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>
              {theme === 'dark' ? '☀️ Hell' : '🌙 Dunkel'}
            </button>
            <button className="theme-toggle" onClick={handleLogout} title="Abmelden">
              🚪 Logout
            </button>
          </div>
        </div>
      </div>

      <main className="main-content">
        {page === 'dashboard' && <Dashboard blocks={blocks} onNavigate={navigate} onReload={loadBlocks} />}
        {page === 'kinder' && <KinderVerzeichnis blocks={blocks} onNavigate={navigate} initialKindId={navParam} />}
        {page === 'angebote' && <AngebotePage blocks={blocks} />}
        {page === 'abgleich' && <AbgleichTool blocks={blocks} initialBlockId={navParam} onReload={loadBlocks} />}
        {page === 'tagesansicht' && <TagesansichtPage blocks={blocks} />}
        {page === 'klassen' && <KlassenPage blocks={blocks} />}
        {page === 'finanzen' && <FinanzenPage blocks={blocks} />}
        {page === 'verlauf' && <VerlaufPage blocks={blocks} />}
        {page === 'ferienblock' && <FerienblockPage blocks={blocks} onReload={loadBlocks} />}
        {page === 'einstellungen' && <EinstellungenPage user={user} onLogout={handleLogout} />}
      </main>
    </div>
  );
};

export default App;
export { ToastContainer, ConfirmDialog };
