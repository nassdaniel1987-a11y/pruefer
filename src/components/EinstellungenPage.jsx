import React, { useState } from 'react';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';

// EINSTELLUNGEN
const EinstellungenPage = ({ user, onLogout }) => {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [regUser, setRegUser] = useState('');
  const [regPw, setRegPw] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

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
    if (res.success) { toast.success(`Benutzer "${regUser}" erstellt!`); setRegUser(''); setRegPw(''); }
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
