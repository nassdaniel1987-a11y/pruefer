import React, { useState } from 'react';
import { API } from '../utils/api';

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
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-3xl p-8 shadow-lg w-full max-w-sm border border-outline-variant/20">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary text-3xl">fact_check</span>
          </div>
          <h1 className="text-2xl font-bold text-on-surface font-headline">Prüfer</h1>
          <p className="text-on-surface-variant text-sm mt-1">Ferienversorgung Abgleich-System</p>
        </div>
        {err && (
          <div className="flex items-center gap-2 bg-error-container text-on-error-container text-sm rounded-xl px-4 py-3 mb-5">
            <span className="material-symbols-outlined text-base">error</span>
            {err}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Benutzername</label>
            <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors placeholder:text-on-surface-variant/50"
              value={user} onChange={e => setUser(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Passwort</label>
            <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors placeholder:text-on-surface-variant/50"
              type="password" value={pass} onChange={e => setPass(e.target.value)} />
          </div>
          <button className="w-full mt-2 py-3 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading || !user || !pass}>
            {loading ? 'Anmelden...' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
