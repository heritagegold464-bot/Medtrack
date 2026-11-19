import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { supabase, SupabaseRemote, supabaseConfigured } from './supabase';
import { LocalDB } from './db';
import { Store } from './store';
import { seedIfEmpty, syncOfficialOutline } from './seed';
import { ensureCurrentDay } from './actions';
import { currentDayRef } from './engine';
import { uuid } from './ids';

export interface AppUser { id: string; email: string; name: string }

/** Development-only escape hatch so the UI can be exercised without a Supabase project. Stripped from production builds. */
export const DEV_LOCAL = import.meta.env.DEV && import.meta.env.VITE_DEV_LOCAL_USER === '1';

interface Ctx { store: Store; user: AppUser; signOut: () => Promise<void> }
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

function deviceId(): string {
  try {
    let id = localStorage.getItem('medtrack:device');
    if (!id) { id = uuid(); localStorage.setItem('medtrack:device', id); }
    return id;
  } catch { return 'unknown-device'; }
}

type Boot = { phase: 'loading' } | { phase: 'signed-out' } | { phase: 'setup-needed' } | { phase: 'ready'; ctx: Ctx } | { phase: 'error'; message: string };

export function AppProvider({ children, fallback }: { children: ReactNode; fallback: (b: Exclude<Boot, { phase: 'ready' }>) => ReactNode }) {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });

  useEffect(() => {
    if (DEV_LOCAL || !supabase) { setAuth(null); return; }
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let store: Store | null = null;
    let cleanup: Array<() => void> = [];
    (async () => {
      let user: AppUser;
      if (DEV_LOCAL) user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@local', name: 'Dev Student' };
      else if (!supabaseConfigured) return setBoot({ phase: 'setup-needed' });
      else if (auth === undefined) return setBoot({ phase: 'loading' });
      else if (!auth) return setBoot({ phase: 'signed-out' });
      else {
        const m = auth.user.user_metadata ?? {};
        user = { id: auth.user.id, email: auth.user.email ?? '', name: (m.full_name as string) || (m.name as string) || auth.user.email || 'Student' };
      }
      try {
        setBoot({ phase: 'loading' });
        const db = await LocalDB.open(`medtrack:${user.id}`);
        store = new Store(user.id, db, DEV_LOCAL || !supabase ? null : new SupabaseRemote(supabase), deviceId());
        await store.load();
        // Pull first so a second device never re-seeds over existing cloud data.
        await store.sync();
        seedIfEmpty(store, user.name);
        syncOfficialOutline(store);
        ensureCurrentDay(store);
        store.scheduleSync(50);
        if (cancelled) return;

        const s = store;
        const trigger = () => void s.sync();
        window.addEventListener('online', trigger);
        const onVis = () => { if (document.visibilityState === 'visible') trigger(); };
        document.addEventListener('visibilitychange', onVis);
        const iv = window.setInterval(trigger, 30000);
        cleanup = [() => window.removeEventListener('online', trigger), () => document.removeEventListener('visibilitychange', onVis), () => clearInterval(iv)];

        setBoot({
          phase: 'ready',
          ctx: {
            store: s, user,
            signOut: async () => {
              // Never discard unsynced work silently on sign-out.
              if (s.pendingCount() > 0 && navigator.onLine) await s.sync();
              if (s.pendingCount() > 0 && !window.confirm(`${s.pendingCount()} change(s) have not synced yet and will stay on this device until you sign in again. Sign out anyway?`)) return;
              await supabase?.auth.signOut();
            },
          },
        });
      } catch (e) {
        if (!cancelled) setBoot({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; cleanup.forEach((f) => f()); };
  }, [auth]);

  if (boot.phase !== 'ready') return <>{fallback(boot)}</>;
  return <AppCtx.Provider value={boot.ctx}>{children}</AppCtx.Provider>;
}

/** Re-render whenever anything in the store changes. */
export function useStoreVersion(): number {
  const { store } = useApp();
  return useSyncExternalStore(store.subscribe, store.metaVersion);
}

export function useNow(intervalMs = 1000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), intervalMs); return () => clearInterval(i); }, [intervalMs]);
  return n;
}

/** All live data + the derived "where am I in the cycle" state. */
export function useData() {
  const { store } = useApp();
  const ver = useStoreVersion();
  return useMemo(() => {
    const courses = [...store.rows('courses')].sort((a, b) => a.position - b.position);
    const topics = store.rows('syllabus_topics');
    const templates = [...store.rows('cycle_templates')].sort((a, b) => a.day_number - b.day_number);
    const days = store.rows('cycle_days');
    const sessions = store.rows('reading_sessions');
    const records = store.rows('study_records');
    const logs = store.rows('session_topic_logs');
    const accountability = store.rows('daily_accountability');
    const profile = store.get('profiles', store.userId);
    const prefs = store.rows('notification_preferences')[0];
    const cycleLength = templates.length || 11;
    const ref = currentDayRef(days, cycleLength);
    const currentDay = ref.kind === 'open' ? ref.day : null;
    const courseById = new Map(courses.map((c) => [c.id, c]));
    return { courses, topics, templates, days, sessions, records, logs, accountability, profile, prefs, cycleLength, currentDay, courseById };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ver]);
}
