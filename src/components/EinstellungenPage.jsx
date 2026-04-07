import React, { useState } from 'react';
import { API } from '../utils/api';
import { toast } from '../utils/toast';

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
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface font-headline flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">settings</span>
            Einstellungen
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">Konto, Sicherheit und Datensicherung</p>
        </div>
      </div>

      <div className="grid gap-4 max-w-lg">
        {/* Passwort */}
        <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-base text-primary">lock</span>
            <span className="font-semibold text-on-surface">Passwort ändern</span>
          </div>
          <p className="text-sm text-on-surface-variant mb-4">Angemeldet als: <strong className="text-on-surface">{user?.username}</strong></p>
          {err && (
            <div className="flex items-center gap-2 bg-error-container text-on-error-container text-sm rounded-xl px-4 py-3 mb-4">
              <span className="material-symbols-outlined text-base">error</span>{err}
            </div>
          )}
          {msg && (
            <div className="flex items-center gap-2 bg-green-50 text-green-800 text-sm rounded-xl px-4 py-3 mb-4">
              <span className="material-symbols-outlined text-base">check_circle</span>{msg}
            </div>
          )}
          <div className="space-y-4 mb-5">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Neues Passwort</label>
              <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
                type="password" value={pw1} onChange={e => setPw1(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Passwort wiederholen</label>
              <input className="w-full border-b-2 border-outline-variant bg-transparent py-2 text-on-surface focus:outline-none focus:border-primary transition-colors"
                type="password" value={pw2} onChange={e => setPw2(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={changePassword} disabled={!pw1 || !pw2}>
              <span className="material-symbols-outlined text-sm align-middle mr-1">key</span>Passwort ändern
            </button>
            <button className="flex items-center gap-1 px-4 py-2 rounded-xl text-error hover:bg-error/10 font-semibold text-sm transition-colors" onClick={onLogout}>
              <span className="material-symbols-outlined text-sm">logout</span>Abmelden
            </button>
          </div>
        </div>

        {/* Backup */}
        <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/10">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-base text-primary">backup</span>
            <span className="font-semibold text-on-surface">Datensicherung (Backup)</span>
          </div>
          <p className="text-sm text-on-surface-variant mb-4">
            Erstelle ein vollständiges Backup aller Daten (Ferienblöcke, Listen, Abgleiche, Kinder) als JSON-Datei.
          </p>

          <div className="flex gap-2 flex-wrap mb-4">
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={exportBackup} disabled={backupLoading}>
              <span className="material-symbols-outlined text-sm">download</span>
              {backupLoading ? 'Exportiere…' : 'Backup herunterladen'}
            </button>

            <label className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant/30 text-on-surface-variant font-semibold text-sm hover:bg-surface-container transition-colors ${restoreLoading ? 'cursor-wait opacity-50' : 'cursor-pointer'}`}>
              <span className="material-symbols-outlined text-sm">upload</span>
              {restoreLoading ? 'Wiederherstelle…' : 'Backup wiederherstellen'}
              <input type="file" accept=".json" onChange={importBackup} className="hidden" disabled={restoreLoading} />
            </label>
          </div>

          <div className="flex items-start gap-2 bg-surface-container rounded-xl px-4 py-3 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-sm mt-0.5">info</span>
            <span><strong>Hinweis:</strong> Beim Wiederherstellen werden alle bestehenden Daten überschrieben. Erstelle vorher ein frisches Backup, falls du die aktuellen Daten behalten möchtest.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EinstellungenPage;
