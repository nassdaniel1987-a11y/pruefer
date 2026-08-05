import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API } from './utils/api';
import { ToastContainer } from './utils/toast';
import { ConfirmDialog } from './utils/confirm';
import Spinner from './components/Spinner';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import FerienblockPage from './components/FerienblockPage';
import AbgleichTool from './components/AbgleichTool';
import VerlaufPage from './components/VerlaufPage';
import TagesansichtPage from './components/TagesansichtPage';
import KlassenPage from './components/KlassenPage';
import EinstellungenPage from './components/EinstellungenPage';
import AuroraLayout from './components/AuroraLayout';
import KinderVerzeichnis from './components/KinderVerzeichnis';
import AngebotePage from './components/AngebotePage';

// Flache Liste in Anzeigereihenfolge; `gruppe` steuert nur die
// Zwischenüberschriften. Bewusst nicht verschachtelt, damit VALID_PAGES
// weiterhin garantiert jede Seite erfasst — sonst landen gültige URLs
// stillschweigend auf dem Dashboard.
const NAV_ITEMS = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },

  { id: 'tagesansicht', icon: 'today', label: 'Tagesansicht', gruppe: 'Täglich' },
  { id: 'abgleich', icon: 'sync_alt', label: 'Abgleich', gruppe: 'Täglich' },

  { id: 'ferienblock', icon: 'calendar_month', label: 'Ferienblöcke', gruppe: 'Stammdaten' },
  { id: 'kinder', icon: 'child_care', label: 'Kinder', gruppe: 'Stammdaten' },
  { id: 'angebote', icon: 'local_offer', label: 'Angebote', gruppe: 'Stammdaten' },
  { id: 'klassen', icon: 'groups', label: 'Klassen', gruppe: 'Stammdaten' },

  { id: 'verlauf', icon: 'history', label: 'Verlauf', gruppe: 'Auswertung' },
  { id: 'einstellungen', icon: 'settings', label: 'Einstellungen', gruppe: 'Auswertung' },
];

const VALID_PAGES = NAV_ITEMS.map(n => n.id);

const parseUrl = () => {
  const parts = window.location.pathname.replace(/^\//, '').split('/');
  const p = parts[0] || 'dashboard';
  const param = parts[1] || null;
  return { page: VALID_PAGES.includes(p) ? p : 'dashboard', param };
};

const toUrl = (p, param) => {
  if (p === 'dashboard') return '/';
  return param ? `/${p}/${param}` : `/${p}`;
};

const App = () => {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState(() => parseUrl().page);
  const [navParam, setNavParam] = useState(() => parseUrl().param);
  const [blocks, setBlocks] = useState([]);
  const [blockId, setBlockId] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  // Der aktive Ferienblock gilt für alle Seiten gemeinsam. Vorbelegung ist der
  // Block, der heute läuft — das ist fast immer der gemeinte. Nur wenn gerade
  // keiner läuft, wird der erste genommen.
  useEffect(() => {
    if (!blocks.length) { setBlockId(''); return; }
    if (blocks.some(b => String(b.id) === String(blockId))) return; // Auswahl noch gültig
    const heute = new Date().toISOString().split('T')[0];
    const laufend = blocks.find(b =>
      String(b.startdatum).split('T')[0] <= heute && heute <= String(b.enddatum).split('T')[0]
    );
    setBlockId(String((laufend || blocks[0]).id));
  }, [blocks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cls = '';
    if (theme === 'dark') cls = 'dark';
    else if (theme === 'aurora') cls = 'aurora';
    document.documentElement.className = cls;
    localStorage.setItem('theme', theme);

    // Aurora-Font (Lora) dynamisch laden/entfernen
    const FONT_ID = 'aurora-font-link';
    const existing = document.getElementById(FONT_ID);
    if (theme === 'aurora') {
      if (!existing) {
        const link = document.createElement('link');
        link.id = FONT_ID;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&display=swap';
        document.head.appendChild(link);
      }
    } else {
      if (existing) existing.remove();
    }
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

  const navigate = useCallback((p, param = null) => {
    // Beim Absprung aufs Abgleich-Tool ist der Parameter ein Ferienblock —
    // dann zieht die Kopfzeile mit, sonst zeigt sie einen anderen Block als
    // die Seite.
    if (p === 'abgleich' && param) setBlockId(String(param));
    setPage(p);
    setNavParam(param);
    setSidebarOpen(false);
    window.history.pushState({ page: p, param }, '', toUrl(p, param));
  }, []);

  useEffect(() => {
    const onPop = (e) => {
      const state = e.state || parseUrl();
      setPage(state.page || 'dashboard');
      setNavParam(state.param || null);
    };
    window.addEventListener('popstate', onPop);
    window.history.replaceState({ page, param: navParam }, '', toUrl(page, navParam));
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Spinner /></div>;
  if (!user) return <LoginPage onLogin={handleLogin} />;

  // Seiten, die sich auf genau einen Ferienblock beziehen — nur dort wird die
  // Blockauswahl in der Kopfzeile eingeblendet.
  const BLOCK_SEITEN = ['tagesansicht', 'abgleich', 'klassen', 'verlauf'];
  const zeigeBlockwahl = BLOCK_SEITEN.includes(page) && blocks.length > 0;

  const blockWahl = (
    <select
      className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl px-3 py-2 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer max-w-[240px]"
      value={blockId}
      onChange={e => setBlockId(e.target.value)}
      aria-label="Ferienblock auswählen"
    >
      {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );

  // Ohne angelegten Ferienblock haben die blockbezogenen Seiten nichts zu
  // zeigen. Ohne diesen Hinweis blieben sie einfach leer.
  const ohneBlock = BLOCK_SEITEN.includes(page) && blocks.length === 0;

  // Gemeinsamer Page-Content für beide Layouts
  const pageContent = ohneBlock ? (
    <div className="border-2 border-dashed border-outline-variant/30 p-12 rounded-2xl flex flex-col items-center justify-center gap-3 text-center">
      <span className="material-symbols-outlined text-5xl text-outline-variant">calendar_month</span>
      <p className="text-sm font-bold text-on-surface-variant">Noch kein Ferienblock angelegt</p>
      <p className="text-xs text-on-surface-variant max-w-sm">Diese Seite bezieht sich immer auf einen Ferienblock. Lege zuerst einen an.</p>
      <button className="mt-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold" onClick={() => navigate('ferienblock')}>
        Ferienblock anlegen
      </button>
    </div>
  ) : (
    <>
      {page === 'dashboard' && <Dashboard blocks={blocks} onNavigate={navigate} onReload={loadBlocks} />}
      {page === 'kinder' && <KinderVerzeichnis blocks={blocks} onNavigate={navigate} initialKindId={navParam} />}
      {page === 'angebote' && <AngebotePage blocks={blocks} />}
      {page === 'abgleich' && <AbgleichTool blocks={blocks} blockId={blockId} onReload={loadBlocks} />}
      {page === 'tagesansicht' && <TagesansichtPage blocks={blocks} blockId={blockId} />}
      {page === 'klassen' && <KlassenPage blocks={blocks} blockId={blockId} />}
      {page === 'verlauf' && <VerlaufPage blockId={blockId} />}
      {page === 'ferienblock' && <FerienblockPage blocks={blocks} onReload={loadBlocks} />}
      {page === 'einstellungen' && <EinstellungenPage user={user} onLogout={handleLogout} theme={theme} setTheme={setTheme} />}
    </>
  );

  // Aurora: alternatives Layout mit Topbar
  if (theme === 'aurora') {
    return (
      <>
        <AuroraLayout page={page} navigate={navigate} user={user} theme={theme} setTheme={setTheme} onLogout={handleLogout}
          blockWahl={zeigeBlockwahl ? blockWahl : null}>
          {pageContent}
        </AuroraLayout>
        <ToastContainer />
        <ConfirmDialog />
      </>
    );
  }

  // Standard-Layout (Hell / Dunkel) — unverändert
  return (
    <div className="flex h-full overflow-hidden">
      {/* Indigo Dark Sidebar */}
      <aside className={`fixed left-0 top-0 h-full w-[240px] bg-indigo-950 flex flex-col p-4 space-y-2 z-50 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="mb-8 px-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">Prüfer</h1>
          <p className="text-[10px] text-indigo-300/60 uppercase tracking-[0.2em] font-semibold">Verwaltungssystem</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto no-scrollbar">
          {NAV_ITEMS.map((n, i) => (
            <React.Fragment key={n.id}>
              {/* Überschrift nur beim ersten Eintrag einer Gruppe */}
              {n.gruppe && n.gruppe !== NAV_ITEMS[i - 1]?.gruppe && (
                <div className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-400/50">
                  {n.gruppe}
                </div>
              )}
              <button
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
            </React.Fragment>
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
        {zeigeBlockwahl && (
          <div className="flex items-center gap-3 px-4 md:px-8 pt-4 md:pt-6">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Ferienblock</span>
            {blockWahl}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-12 pt-4 md:pt-6 space-y-6 md:space-y-8 no-scrollbar">
          {pageContent}
        </div>
      </main>
    </div>
  );
};

export default App;
export { ToastContainer, ConfirmDialog };
