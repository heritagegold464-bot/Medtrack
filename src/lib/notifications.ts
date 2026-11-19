import { supabase } from './supabase';
import { parseHHMM, zonedParts } from './time';
import type { NotificationPrefs, Profile, ReadingSession, StudyRecord, Accountability } from './types';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export interface NotifState {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  pushSupported: boolean;
  vapidConfigured: boolean;
  /** A browser push subscription exists on this device. */
  subscribed: boolean;
}

export async function getNotifState(): Promise<NotifState> {
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
  const pushSupported = supported && 'PushManager' in window;
  let subscribed = false;
  if (pushSupported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      subscribed = !!(await reg?.pushManager.getSubscription());
    } catch { /* ignore */ }
  }
  return {
    supported,
    permission: supported ? Notification.permission : 'unsupported',
    pushSupported,
    vapidConfigured: !!VAPID,
    subscribed,
  };
}

export async function requestPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

const b64ToU8 = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Subscribe this device to background push and save the subscription for the reminder function. */
export async function subscribePush(userId: string): Promise<void> {
  if (!VAPID) throw new Error('Push is not configured (VITE_VAPID_PUBLIC_KEY is missing).');
  if (!supabase) throw new Error('Cloud is not configured.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) }));
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: sub.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth },
    { onConflict: 'user_id,endpoint' },
  );
  if (error) throw new Error(error.message);
}

export async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export interface ReminderContext {
  profile: Profile;
  prefs: NotificationPrefs;
  today: string;
  /** Sessions of the currently open cycle day (primary first). */
  sessions: ReadingSession[];
  records: StudyRecord[];
  accountability: Accountability[];
}

export interface DueReminder { kind: string; title: string; body: string }

const WINDOW_MIN = 20; // a reminder missed by more than this is not replayed late

/** Pure: which reminders are due right now (Africa/Lagos clock)? Used by the in-app scheduler and unit tests. */
export function dueReminders(ctx: ReminderContext, now: Date, tz = ctx.profile.timezone): DueReminder[] {
  const { minutesOfDay, date } = zonedParts(now, tz);
  const inWindow = (hhmm: string, offset = 0) => {
    const t = parseHHMM(hhmm) + offset;
    return minutesOfDay >= t && minutesOfDay < t + WINDOW_MIN;
  };
  const out: DueReminder[] = [];
  const p = ctx.sessions.find((s) => s.slot === 'primary');
  const s = ctx.sessions.find((x) => x.slot === 'secondary');
  const p_ = ctx.prefs;
  if (p_.primary_reminder && p && p.status === 'pending' && inWindow(ctx.profile.primary_time)) {
    out.push({ kind: 'primary', title: 'Start primary reading', body: 'Your primary session is due now.' });
  }
  if (p_.secondary_reminder && s && s.status === 'pending' && inWindow(ctx.profile.secondary_time)) {
    out.push({ kind: 'secondary', title: 'Start secondary reading', body: 'Your secondary session is due now.' });
  }
  if (p_.overdue_reminder) {
    for (const x of [p, s]) {
      if (x && x.status === 'pending' && inWindow(x.planned_start, p_.overdue_after_minutes)) {
        out.push({ kind: `overdue-${x.slot}`, title: 'Session overdue', body: `Your ${x.slot} reading session has not been started.` });
      }
    }
  }
  const atAccountability = inWindow(ctx.profile.accountability_time);
  if (p_.accountability_reminder && atAccountability && !ctx.accountability.some((a) => a.check_date === date)) {
    out.push({ kind: 'accountability', title: 'Daily accountability check', body: 'Take a minute to record how today went.' });
  }
  if (p_.incomplete_reminder && atAccountability && ctx.sessions.some((x) => x.status === 'partial' || x.status === 'in_progress')) {
    out.push({ kind: 'incomplete', title: 'Unfinished session', body: 'A session is still partial or in progress. Finish it or close the day.' });
  }
  if (p_.unrecorded_reminder && atAccountability && !ctx.records.some((r) => r.study_date === date && r.actual_seconds > 0)) {
    out.push({ kind: 'unrecorded', title: 'No study recorded today', body: 'You have not recorded any reading today.' });
  }
  return out;
}

/** While the app is open (or running in the background as a PWA), show due reminders once per day each. */
export function startReminderLoop(getCtx: () => ReminderContext | null): () => void {
  const tick = async () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const ctx = getCtx();
    if (!ctx) return;
    for (const r of dueReminders(ctx, new Date())) {
      const key = `medtrack:notified:${ctx.today}:${r.kind}`;
      try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch { /* ignore */ }
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(r.title, { body: r.body, tag: r.kind, icon: '/icon-192.png' });
      else new Notification(r.title, { body: r.body });
    }
  };
  void tick();
  const i = window.setInterval(tick, 30000);
  return () => clearInterval(i);
}
