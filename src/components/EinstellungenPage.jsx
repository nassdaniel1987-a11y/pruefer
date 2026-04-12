import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';

const THEMES = [
  {
    id: 'light',
    label: 'Hell',
    icon: 'light_mode',
    description: 'Material Design · Violett/Indigo · Sidebar links',
    preview: { bg: '#fcf8fd', accent: '#5a598b', sidebar: '#1e1b4b' },
    isTopbar: false,
  },
  {
    id: 'dark',
    label: 'Dunkel',
    icon: 'dark_mode',
    description: 'Dunkles Slate-Design · Sidebar links',
    preview: { bg: '#0f172a', accent: '#818cf8', sidebar: '#020617' },
    isTopbar: false,
  },
  {
    id: 'aurora',
    label: 'Aurora',
    icon: 'forest',
    description: 'Warm & organisch · Waldgrün · Topbar-Navigation',
    preview: { bg: '#f5f0e8', accent: '#3a6b47', sidebar: '#2d4a35' },
    isTopbar: true,
  },
];

// EINSTELLUNGEN
const EinstellungenPage = ({ user, onLogout, theme, setTheme }) => {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [regUser, setRegUser] = useState('');
  const [regPw, setRegPw] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [users, setUsers] = useState([]);

  const loadUsers = async () => {
    const res = await API.post('auth', { action: 'list-users', token: API.token() });
    if (res.success) setUsers(res.users);
  };

  useEffect(() => { loadUsers(); }, []);

  const changePw = async () => {
    if (newPw !== confirmPw) { toast.error('Passwörter stimmen nicht überein'); return; }
    if (newPw.length < 8) { toast.error('Mindestens 8 Zeichen'); return; }
    const res = await API.post('auth', { action: 'change-password', token: API.token(), oldPassword: oldPw, newPassword: newPw });
    if (res.success) { toast.success('Passwort geändert!'); setOldPw(''); setNewPw(''); setConfirmPw(''); }
    else toast.error(res.error || 'Fehler beim Ändern');
  };

  const register = async () => {
    if (regPw.length < 8) { toast.error('Passwort muss mindestens 8 Zeichen haben'); return; }
    if (regUser.trim().length < 3) { toast.error('Benutzername muss mindestens 3 Zeichen haben'); return; }
    const res = await API.post('auth', { action: 'register', token: API.token(), username: regUser, password: regPw });
    if (res.success) { toast.success(`Benutzer "${regUser}" erstellt!`); setRegUser(''); setRegPw(''); loadUsers(); }
    else toast.error(res.error || 'Fehler');
  };

  const deleteUser = async (u) => {
    const ok = await confirmDialog('Benutzer löschen', `"${u.username}" wirklich löschen? Der Benutzer kann sich danach nicht mehr anmelden.`, 'Löschen');
    if (!ok) return;
    const res = await API.post('auth', { action: 'delete-user', token: API.token(), userId: u.id });
    if (res.success) { toast.success(`Benutzer "${u.username}" gelöscht`); loadUsers(); }
    else toast.error(res.error || 'Fehler');
  };

  const exportAll = async () => {
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

  const importBackup = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const ok = await confirmDialog('Backup wiederherstellen', 'ACHTUNG: Alle bestehenden Daten werden ÜBERSCHRIEBEN!', 'Wiederherstellen');
    if (!ok) return;
    setRestoreLoading(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.data) { toast.error('Ungültiges Backup-Format'); return; }
      const res = await API.post('backup', { action: 'import', data: backup.data });
      if (res.success) { toast.success('Backup wiederhergestellt!'); setTimeout(() => window.location.reload(), 1500); }
      else toast.error('Restore fehlgeschlagen: ' + (res.error || 'Fehler'));
    } catch (err) {
      toast.error('Fehler beim Lesen: ' + err.message);
    } finally {
      setRestoreLoading(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div>
        <span className="text-xs font-bold text-primary tracking-[0.1em] uppercase">Konfiguration</span>
        <h2 className="text-3xl lg:text-4xl font-extrabold text-on-surface mt-1 tracking-tight">Einstellungen</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Design / Erscheinungsbild */}
        {setTheme && (
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-2xl">palette</span>
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-on-surface">Design</h3>
                <p className="text-xs text-on-surface-variant">Erscheinungsbild, Farbschema &amp; Navigation</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {THEMES.map(t => {
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`flex flex-col gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-outline-variant/20 hover:border-outline-variant/50 hover:bg-surface-container-low'
                    }`}
                  >
                    {/* Layout-Miniaturvorschau */}
                    <div className="w-full rounded-lg overflow-hidden border border-outline-variant/20 flex flex-col" style={{ height: '64px' }}>
                      {t.isTopbar ? (
                        /* Aurora: Topbar oben */
                        <>
                          <div style={{ height: '13px', background: t.preview.sidebar, display: 'flex', alignItems: 'center', padding: '0 5px', gap: '3px', flexShrink: 0 }}>
                            <div style={{ width: '18px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.55)' }} />
                            {[1,2,3,4,5].map(i => (
                              <div key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: i === 1 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)' }} />
                            ))}
                          </div>
                          <div style={{ flex: 1, background: t.preview.bg, padding: '5px' }}>
                            <div style={{ height: '6px', borderRadius: '2px', background: t.preview.accent, opacity: 0.35, marginBottom: '4px' }} />
                            <div style={{ display: 'flex', gap: '3px' }}>
                              {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: '20px', borderRadius: '3px', background: t.preview.accent, opacity: 0.1 }} />)}
                            </div>
                          </div>
                        </>
                      ) : (
                        /* Hell/Dunkel: Sidebar links */
                        <div style={{ display: 'flex', height: '100%' }}>
                          <div style={{ width: '18px', background: t.preview.sidebar, display: 'flex', flexDirection: 'column', gap: '3px', padding: '4px 3px', flexShrink: 0 }}>
                            {[1,2,3,4,5,6].map(i => (
                              <div key={i} style={{ height: '4px', borderRadius: '2px', background: i === 1 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.14)' }} />
                            ))}
                          </div>
                          <div style={{ flex: 1, background: t.preview.bg, padding: '5px' }}>
                            <div style={{ height: '5px', borderRadius: '2px', background: t.preview.accent, opacity: 0.45, marginBottom: '4px' }} />
                            <div style={{ display: 'flex', gap: '3px' }}>
                              {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: '26px', borderRadius: '3px', background: t.preview.accent, opacity: 0.1 }} />)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Label + Icon */}
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-on-surface-variant">{t.icon}</span>
                      <span className="text-sm font-bold text-on-surface">{t.label}</span>
                      {active && (
                        <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-auto">Aktiv</span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant -mt-1">{t.description}</p>

                    {/* Auswahl-Indikator */}
                    <div className={`w-5 h-5 rounded-full border-2 self-end flex items-center justify-center transition-all ${
                      active ? 'border-primary bg-primary' : 'border-outline-variant/40'
                    }`}>
                      {active && (
                        <span className="material-symbols-outlined text-on-primary" style={{ fontSize: '12px' }}>check</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Profil */}
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-2xl">person</span>
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-on-surface">Profil</h3>
              <p className="text-xs text-on-surface-variant">Benutzerkonto & Sicherheit</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-outline-variant/10">
              <span className="text-sm font-medium text-on-surface-variant">Benutzername</span>
              <span className="text-sm font-bold text-on-surface">{user?.username}</span>
            </div>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Passwort ändern</h4>
              <input type="password" placeholder="Aktuelles Passwort" className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={oldPw} onChange={e => setOldPw(e.target.value)} />
              <input type="password" placeholder="Neues Passwort" className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={newPw} onChange={e => setNewPw(e.target.value)} />
              <input type="password" placeholder="Passwort bestätigen" className="w-full border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
              <button className="px-5 py-2.5 text-sm font-bold rounded-xl bg-primary text-on-primary shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform disabled:opacity-50" disabled={!oldPw || !newPw || newPw !== confirmPw} onClick={changePw}>Passwort ändern</button>
            </div>
          </div>
        </div>

        {/* Benutzerverwaltung */}
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-tertiary/10 flex items-center justify-center text-tertiary">
              <span className="material-symbols-outlined text-2xl">group</span>
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-on-surface">Benutzerverwaltung</h3>
              <p className="text-xs text-on-surface-variant">Benutzer erstellen & verwalten</p>
            </div>
          </div>
          <div className="space-y-4">
            {/* Nutzerliste */}
            {users.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Vorhandene Benutzer</h4>
                <div className="space-y-2">
                  {users.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/10">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-base text-on-surface-variant">person</span>
                        <span className="text-sm font-bold text-on-surface">{u.username}</span>
                        {u.username === user?.username && <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">Ich</span>}
                      </div>
                      {u.username !== user?.username && (
                        <button className="p-1.5 rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors" onClick={() => deleteUser(u)} title="Benutzer löschen">
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Neuer Benutzer */}
            <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Neuer Benutzer</h4>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Benutzername" className="border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={regUser} onChange={e => setRegUser(e.target.value)} />
              <input type="password" placeholder="Passwort" className="border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm bg-surface-container-low focus:ring-2 focus:ring-primary/20" value={regPw} onChange={e => setRegPw(e.target.value)} />
            </div>
            <button className="px-5 py-2.5 text-sm font-bold rounded-xl bg-primary text-on-primary shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform disabled:opacity-50" disabled={!regUser || !regPw} onClick={register}>Benutzer erstellen</button>
          </div>
        </div>

        {/* System */}
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary">
              <span className="material-symbols-outlined text-2xl">settings</span>
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-on-surface">System</h3>
              <p className="text-xs text-on-surface-variant">Aktionen & Verwaltung</p>
            </div>
          </div>
          <div className="space-y-3">
            <button className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container-low border border-outline-variant/10 transition-colors ${backupLoading ? 'opacity-50' : ''}`} onClick={exportAll} disabled={backupLoading}>
              <span className="material-symbols-outlined text-lg">download</span>{backupLoading ? 'Exportiere...' : 'Backup exportieren (JSON)'}
            </button>
            <label className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container-low border border-outline-variant/10 transition-colors cursor-pointer ${restoreLoading ? 'opacity-50' : ''}`}>
              <span className="material-symbols-outlined text-lg">upload</span>{restoreLoading ? 'Importiere...' : 'Backup importieren'}
              <input type="file" accept=".json" className="hidden" onChange={importBackup} disabled={restoreLoading} />
            </label>
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-error hover:bg-error-container border border-outline-variant/10 transition-colors" onClick={onLogout}>
              <span className="material-symbols-outlined text-lg">logout</span>Abmelden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EinstellungenPage;
