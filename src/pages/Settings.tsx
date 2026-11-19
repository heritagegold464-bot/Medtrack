import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData, useStoreVersion } from '../lib/app';
import { Card, SectionTitle, cx } from '../components/ui';
import { getNotifState, requestPermission, subscribePush, unsubscribePush, type NotifState } from '../lib/notifications';
import { fmtDateLong } from '../lib/time';
import type { NotificationPrefs } from '../lib/types';

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 py-1">
      <span><span className="text-sm font-medium text-ink-900">{label}</span>{hint && <span className="block text-xs text-ink-500">{hint}</span>}</span>
      <input type="checkbox" role="switch" className="h-5 w-5 accent-[#163659]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function SettingsPage() {
  const { store, user, signOut } = useApp();
  const d = useData();
  useStoreVersion();
  const [ns, setNs] = useState<NotifState | null>(null);
  const [msg, setMsg] = useState('');
  const refresh = useCallback(() => void getNotifState().then(setNs), []);
  useEffect(refresh, [refresh]);

  const prefs = d.prefs;
  const setPref = (patch: Partial<NotificationPrefs>) => prefs && store.put('notification_preferences', { id: prefs.id, ...patch });
  const profile = d.profile;

  const enable = async () => {
    setMsg('');
    try {
      const p = await requestPermission();
      if (p === 'granted') {
        try { await subscribePush(user.id); } catch (e) { setMsg(`Notifications are allowed, but background push could not be set up: ${e instanceof Error ? e.message : e}`); }
      } else setMsg(p === 'denied' ? 'The browser blocked notifications. Allow them in the browser’s site settings, then come back.' : 'Permission was not granted.');
    } finally { refresh(); }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medtrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Honest notification status.
  let notifLine = 'Checking…', notifTone = 'text-ink-500';
  if (ns) {
    if (!ns.supported) { notifLine = 'Not supported in this browser.'; notifTone = 'text-bad-700'; }
    else if (ns.permission === 'denied') { notifLine = 'Blocked — notifications are disabled in your browser settings.'; notifTone = 'text-bad-700'; }
    else if (ns.permission === 'default') { notifLine = 'Off — permission has not been granted.'; notifTone = 'text-warn-700'; }
    else if (ns.subscribed) { notifLine = 'On — permission granted and background push subscribed on this device.'; notifTone = 'text-ok-700'; }
    else if (!ns.vapidConfigured) { notifLine = 'Partly on — permission granted. Reminders appear while MEDTRACK is open; background push is not configured for this deployment.'; notifTone = 'text-warn-700'; }
    else { notifLine = 'Partly on — permission granted but this device is not subscribed to background push.'; notifTone = 'text-warn-700'; }
  }

  const failed = store.failedEntries();
  const sync = store.status;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold text-navy-800">Settings</h1>

      <Card>
        <SectionTitle>Account</SectionTitle>
        <div className="text-sm text-ink-700">Signed in as <b>{user.email}</b></div>
        <button className="btn-ghost mt-3" onClick={() => void signOut()}>Sign out</button>
      </Card>

      <Card>
        <SectionTitle>Sync</SectionTitle>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-500">Status</dt><dd className="font-semibold capitalize">{sync.state === 'disabled' ? 'local only' : sync.state}</dd>
          <dt className="text-ink-500">Last synced</dt><dd>{sync.lastSyncAt ? `${fmtDateLong(sync.lastSyncAt.slice(0, 10))} ${new Date(sync.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })}` : 'never'}</dd>
          <dt className="text-ink-500">Waiting to upload</dt><dd className="font-semibold">{store.pendingCount()}</dd>
          <dt className="text-ink-500">Conflicts</dt><dd className={cx('font-semibold', store.unresolvedConflicts().length > 0 && 'text-bad-700')}>{store.unresolvedConflicts().length}</dd>
        </dl>
        {sync.error && <p role="alert" className="mt-2 text-sm text-bad-700">{sync.error}</p>}
        {failed.length > 0 && <p role="alert" className="mt-2 text-sm text-bad-700">{failed.length} change(s) were rejected by the server: {failed[0].last_error}. They are kept on this device.</p>}
        {store.persistError && <p role="alert" className="mt-2 text-sm text-bad-700">Local storage problem: {store.persistError}</p>}
        <div className="mt-3 flex gap-2">
          <button className="btn-primary" onClick={() => void store.sync()}>Sync now</button>
          {store.unresolvedConflicts().length > 0 && <Link to="/conflicts" className="btn-danger">Review conflicts</Link>}
        </div>
      </Card>

      <Card>
        <SectionTitle>Notifications</SectionTitle>
        <p className={cx('text-sm font-semibold', notifTone)} role="status">{notifLine}</p>
        {ns?.supported && ns.permission !== 'denied' && (!ns.subscribed || ns.permission === 'default') && (
          <button className="btn-primary mt-3" onClick={() => void enable()}>{ns.permission === 'default' ? 'Enable notifications' : 'Set up background push'}</button>
        )}
        {ns?.subscribed && <button className="btn-ghost mt-3" onClick={() => void unsubscribePush().then(refresh)}>Turn off background push on this device</button>}
        {msg && <p role="alert" className="mt-2 text-sm text-warn-700">{msg}</p>}
        {prefs && (
          <div className="mt-3 divide-y divide-slate-100">
            <Toggle label="Primary reading reminder" hint={`At ${profile?.primary_time}`} checked={prefs.primary_reminder} onChange={(v) => setPref({ primary_reminder: v })} />
            <Toggle label="Secondary reading reminder" hint={`At ${profile?.secondary_time}`} checked={prefs.secondary_reminder} onChange={(v) => setPref({ secondary_reminder: v })} />
            <Toggle label="Daily accountability check" hint={`At ${profile?.accountability_time}`} checked={prefs.accountability_reminder} onChange={(v) => setPref({ accountability_reminder: v })} />
            <Toggle label="Overdue session alert" hint={`${prefs.overdue_after_minutes} min after a session was due and not started`} checked={prefs.overdue_reminder} onChange={(v) => setPref({ overdue_reminder: v })} />
            <Toggle label="Incomplete session reminder" hint="Partial or in-progress session at accountability time" checked={prefs.incomplete_reminder} onChange={(v) => setPref({ incomplete_reminder: v })} />
            <Toggle label="No study recorded today" hint="At accountability time, if nothing was logged" checked={prefs.unrecorded_reminder} onChange={(v) => setPref({ unrecorded_reminder: v })} />
          </div>
        )}
        <p className="mt-2 text-xs text-ink-500">All reminder times use Africa/Lagos.</p>
      </Card>

      {profile && (
        <Card>
          <SectionTitle>Schedule</SectionTitle>
          <p className="mb-3 text-xs text-ink-500">Timezone: <b>{profile.timezone}</b>. Changes apply to days opened from now on; the current day keeps its original times.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="pt">Primary start</label><input id="pt" type="time" className="input" value={profile.primary_time} onChange={(e) => e.target.value && store.put('profiles', { id: profile.id, primary_time: e.target.value })} /></div>
            <div><label className="label" htmlFor="pm">Primary minutes</label><input id="pm" type="number" min={15} max={720} step={15} className="input" value={profile.primary_minutes} onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 720) store.put('profiles', { id: profile.id, primary_minutes: n }); }} /></div>
            <div><label className="label" htmlFor="st">Secondary start</label><input id="st" type="time" className="input" value={profile.secondary_time} onChange={(e) => e.target.value && store.put('profiles', { id: profile.id, secondary_time: e.target.value })} /></div>
            <div><label className="label" htmlFor="sm">Secondary minutes</label><input id="sm" type="number" min={15} max={720} step={15} className="input" value={profile.secondary_minutes} onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 720) store.put('profiles', { id: profile.id, secondary_minutes: n }); }} /></div>
            <div><label className="label" htmlFor="at">Accountability check</label><input id="at" type="time" className="input" value={profile.accountability_time} onChange={(e) => e.target.value && store.put('profiles', { id: profile.id, accountability_time: e.target.value })} /></div>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>Data</SectionTitle>
        <p className="text-sm text-ink-700">Records are never hard-deleted: removed topics are archived so past sessions keep their history.</p>
        <button className="btn-ghost mt-3" onClick={exportData}>Export full backup (JSON)</button>
      </Card>
    </div>
  );
}
