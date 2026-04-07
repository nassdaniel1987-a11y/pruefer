import { toast } from './toast';

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

export { API };
