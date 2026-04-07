// Helper functions extracted from App.jsx

const normalizeDate = (d) => {
  if (d === null || d === undefined || d === '') return null;
  const asNum = typeof d === 'number' ? d : (String(d).match(/^\d{5}$/) ? parseInt(d) : null);
  if (asNum && asNum > 40000 && asNum < 60000) {
    return new Date((asNum - 25569) * 86400 * 1000).toISOString().split('T')[0];
  }
  if (String(d).match(/^\d{4}-\d{2}-\d{2}/)) return String(d).slice(0, 10);
  const m = String(d).match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/);
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

export { normalizeDate, fmtDate, fmtDateTime, scoreClass };
