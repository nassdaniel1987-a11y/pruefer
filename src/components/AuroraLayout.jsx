import React, { useState } from 'react';

const NAV_ITEMS = [
  { id: 'dashboard',    icon: 'dashboard',      label: 'Dashboard' },
  { id: 'ferienblock',  icon: 'calendar_month', label: 'Ferienblöcke' },
  { id: 'kinder',       icon: 'child_care',     label: 'Kinder' },
  { id: 'angebote',     icon: 'local_offer',    label: 'Angebote' },
  { id: 'abgleich',     icon: 'sync_alt',       label: 'Abgleich' },
  { id: 'tagesansicht', icon: 'today',          label: 'Tagesansicht' },
  { id: 'klassen',      icon: 'groups',         label: 'Klassen' },
  { id: 'finanzen',     icon: 'payments',       label: 'Finanzen' },
  { id: 'verlauf',      icon: 'history',        label: 'Verlauf' },
  { id: 'einstellungen',icon: 'settings',       label: 'Einstellungen' },
];

const TOPBAR_BG   = '#2d4a35';
const NAV_ACTIVE  = 'rgba(168,197,160,0.22)';
const NAV_COLOR   = '#d4edda';
const NAV_DIM     = 'rgba(168,197,160,0.55)';
const BORDER_LINE = 'rgba(168,197,160,0.15)';

const AuroraLayout = ({ page, navigate, user, setTheme, onLogout, children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const shortLabel = (label) =>
    label.length > 9 ? label.slice(0, 8) + '…' : label;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ── TOPBAR ── */}
      <header style={{
        background: TOPBAR_BG,
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 1.25rem',
        gap: '1rem',
        flexShrink: 0,
        boxShadow: `0 1px 0 ${BORDER_LINE}`,
        position: 'relative',
        zIndex: 50,
      }}>

        {/* Logo */}
        <div style={{ flexShrink: 0, lineHeight: 1.1 }}>
          <div style={{
            fontFamily: "'Lora', Georgia, serif",
            fontWeight: 700,
            fontSize: '1.15rem',
            color: '#fefcf8',
            letterSpacing: '-0.02em',
          }}>Prüfer</div>
          <div style={{
            fontSize: '0.5rem',
            color: 'rgba(168,197,160,0.55)',
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 600,
          }}>Verwaltung</div>
        </div>

        {/* Trennlinie */}
        <div style={{ width: '1px', height: '28px', background: BORDER_LINE, flexShrink: 0 }} className="hidden md:block" />

        {/* Desktop Nav */}
        <nav
          className="hidden md:flex no-scrollbar"
          style={{ flex: 1, display: 'flex', gap: '2px', alignItems: 'center', overflowX: 'auto' }}
        >
          {NAV_ITEMS.map(n => {
            const active = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => navigate(n.id)}
                title={n.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.3rem 0.55rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                  minWidth: '50px',
                  background: active ? NAV_ACTIVE : 'transparent',
                  color: active ? NAV_COLOR : NAV_DIM,
                  gap: '1px',
                  outline: 'none',
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '1.15rem',
                    fontVariationSettings: active
                      ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20"
                      : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20",
                  }}
                >{n.icon}</span>
                <span style={{
                  fontSize: '0.48rem',
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}>
                  {shortLabel(n.label)}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Desktop: rechte Seite */}
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {/* In Einstellungen wechseln für Theme-Auswahl — kleiner Hinweis-Button */}
          <button
            onClick={() => navigate('einstellungen')}
            title="Design-Einstellungen"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: NAV_DIM,
              display: 'flex',
              alignItems: 'center',
              padding: '0.3rem',
              borderRadius: '6px',
              transition: 'color 0.15s',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '1.1rem', fontVariationSettings: "'FILL' 0, 'wght' 300" }}>palette</span>
          </button>

          {/* Trennlinie */}
          <div style={{ width: '1px', height: '20px', background: BORDER_LINE }} />

          {/* User-Avatar + Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: 'rgba(168,197,160,0.22)',
              border: `1px solid ${BORDER_LINE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: NAV_COLOR,
              fontSize: '0.75rem',
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {(user?.username || 'A').charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(168,197,160,0.75)', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.username}
            </span>
          </div>

          {/* Abmelden */}
          <button
            onClick={onLogout}
            title="Abmelden"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: NAV_DIM,
              display: 'flex',
              alignItems: 'center',
              padding: '0.3rem',
              borderRadius: '6px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '1rem', fontVariationSettings: "'FILL' 0, 'wght' 300" }}>logout</span>
          </button>
        </div>

        {/* Mobile: Hamburger */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(v => !v)}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(168,197,160,0.8)',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '1.4rem' }}>
            {mobileOpen ? 'close' : 'menu'}
          </span>
        </button>
      </header>

      {/* ── MOBILE DROPDOWN ── */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }}
            onClick={() => setMobileOpen(false)}
          />
          {/* Dropdown */}
          <div style={{
            position: 'fixed',
            top: '60px',
            left: 0,
            right: 0,
            background: TOPBAR_BG,
            zIndex: 45,
            padding: '0.75rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.4rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            borderTop: `1px solid ${BORDER_LINE}`,
          }}>
            {NAV_ITEMS.map(n => {
              const active = page === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => { navigate(n.id); setMobileOpen(false); }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '0.65rem 0.3rem',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? NAV_ACTIVE : 'transparent',
                    color: active ? NAV_COLOR : NAV_DIM,
                    gap: '0.25rem',
                    transition: 'background 0.15s',
                  }}
                >
                  <span className="material-symbols-outlined" style={{
                    fontSize: '1.3rem',
                    fontVariationSettings: active ? "'FILL' 1, 'wght' 500" : "'FILL' 0, 'wght' 300",
                  }}>{n.icon}</span>
                  <span style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', textAlign: 'center' }}>
                    {n.label}
                  </span>
                </button>
              );
            })}

            {/* Untere Zeile: User-Info + Aktionen */}
            <div style={{
              gridColumn: '1/-1',
              borderTop: `1px solid ${BORDER_LINE}`,
              marginTop: '0.25rem',
              paddingTop: '0.65rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: '0.25rem',
              paddingRight: '0.25rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  background: 'rgba(168,197,160,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: NAV_COLOR, fontSize: '0.7rem', fontWeight: 700,
                }}>
                  {(user?.username || 'A').charAt(0).toUpperCase()}
                </div>
                <span style={{ color: 'rgba(168,197,160,0.7)', fontSize: '0.78rem', fontWeight: 600 }}>
                  {user?.username}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => { navigate('einstellungen'); setMobileOpen(false); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: NAV_DIM, display: 'flex', padding: '0.2rem' }}
                  title="Einstellungen"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>palette</span>
                </button>
                <button
                  onClick={() => { onLogout(); setMobileOpen(false); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: NAV_DIM, display: 'flex', padding: '0.2rem' }}
                  title="Abmelden"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>logout</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── CONTENT ── */}
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} className="no-scrollbar">
        <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '1.5rem 2rem 4rem' }}>
          {children}
        </div>
      </main>
    </div>
  );
};

export default AuroraLayout;
