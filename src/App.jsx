import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API } from './utils/api';
import { ToastContainer } from './utils/toast';
import { ConfirmDialog } from './utils/confirm';
import Spinner from './components/Spinner';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import FerienblockPage from './components/FerienblockPage';
import AbgleichTool from './components/AbgleichTool';
import FinanzenPage from './components/FinanzenPage';
import VerlaufPage from './components/VerlaufPage';
import TagesansichtPage from './components/TagesansichtPage';
import KlassenPage from './components/KlassenPage';
import EinstellungenPage from './components/EinstellungenPage';
import KinderVerzeichnis from './components/KinderVerzeichnis';
import AngebotePage from './components/AngebotePage';

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

  const inactivityTimer = useRef(null);
  const INACTIVITY_MS = 30 * 60 * 1000; // 30 Minuten

  const handleLogout = useCallback(async () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    await API.post('auth', { action: 'logout', token: API.token() });
    localStorage.removeItem('token');
    setUser(null);
    setPage('dashboard');
  }, []);

  const resetTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(handleLogout, INACTIVITY_MS);
  }, [handleLogout]);

  useEffect(() => {
    if (!user) return;
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [user, resetTimer]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = (p, param = null) => { setPage(p); setNavParam(param); setSidebarOpen(false); };

  if (checking) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Spinner /></div>;
  if (!user) return <LoginPage onLogin={handleLogin} />;

  const navItems = [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    { id: 'ferienblock', icon: 'calendar_month', label: 'Ferienblöcke' },
    { id: 'kinder', icon: 'child_care', label: 'Kinder' },
    { id: 'angebote', icon: 'local_offer', label: 'Angebote' },
    { id: 'abgleich', icon: 'sync_alt', label: 'Abgleich' },
    { id: 'tagesansicht', icon: 'today', label: 'Tagesansicht' },
    { id: 'klassen', icon: 'groups', label: 'Klassen' },
    { id: 'finanzen', icon: 'payments', label: 'Finanzen' },
    { id: 'verlauf', icon: 'history', label: 'Verlauf' },
    { id: 'einstellungen', icon: 'settings', label: 'Einstellungen' },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Indigo Dark Sidebar */}
      <aside className={`fixed left-0 top-0 h-full w-[240px] bg-indigo-950 flex flex-col p-4 space-y-2 z-50 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="mb-8 px-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">Prüfer</h1>
          <p className="text-[10px] text-indigo-300/60 uppercase tracking-[0.2em] font-semibold">Verwaltungssystem</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto no-scrollbar">
          {navItems.map(n => (
            <button
              key={n.id}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${
                page === n.id
                  ? 'bg-indigo-800 text-white font-semibold'
                  : 'text-indigo-300/70 hover:text-white hover:bg-indigo-900/50'
              }`}
              onClick={() => navigate(n.id)}
            >
              <span className="material-symbols-outlined text-xl">{n.icon}</span>
              <span className="text-sm">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="pt-4 mt-auto border-t border-indigo-900/50 space-y-2">
          <button
            className="w-full flex items-center gap-3 px-3 py-2 text-indigo-300/70 hover:text-white hover:bg-indigo-900/50 rounded-lg transition-all"
            onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          >
            <span className="material-symbols-outlined text-xl">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
            <span className="text-sm">{theme === 'dark' ? 'Hell' : 'Dunkel'}</span>
          </button>
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-white text-sm font-bold">
              {(user.username || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-semibold text-white truncate">{user.username}</span>
              <span className="text-[10px] text-indigo-400">Verwaltung</span>
            </div>
            <button onClick={handleLogout} className="text-indigo-400 hover:text-white transition-colors" title="Abmelden">
              <span className="material-symbols-outlined text-lg">logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <main className="flex-1 md:ml-[240px] flex flex-col h-full overflow-hidden">
        <div className="md:hidden flex items-center px-4 pt-4 pb-2 border-b border-outline-variant/10">
          <button className="p-2 rounded-lg text-on-surface hover:bg-surface-container transition-colors" onClick={() => setSidebarOpen(v => !v)}>
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="ml-3 font-bold text-on-surface text-lg">Prüfer</span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-12 pt-4 md:pt-6 space-y-6 md:space-y-8 no-scrollbar">
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
        </div>
      </main>
    </div>
  );
};

export default App;
export { ToastContainer, ConfirmDialog };
