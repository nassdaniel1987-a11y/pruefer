import React, { useState, useEffect } from 'react';
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
