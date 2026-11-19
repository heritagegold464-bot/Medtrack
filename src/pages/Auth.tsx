import { useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-800 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <div className="text-3xl font-extrabold tracking-wide text-navy-800">MEDTRACK</div>
        <div className="mb-5 text-sm text-ink-500">Semester reading management</div>
        {children}
      </div>
    </div>
  );
}

export function Loading() {
  return <Shell><p role="status" className="text-sm text-ink-500">Loading your records…</p></Shell>;
}

export function Login() {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } } });
    if (error) { setErr(error.message); setBusy(false); }
  };
  return (
    <Shell>
      <p className="mb-5 text-sm text-ink-700">Track your 11-day reading cycle and your real syllabus progress. Your records follow you across devices.</p>
      <button className="btn-primary w-full" disabled={busy} onClick={() => void go()}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.3-.2-2.7-.5-4z" /></svg>
        Continue with Google
      </button>
      {err && <p role="alert" className="mt-3 text-sm text-bad-700">{err}</p>}
    </Shell>
  );
}

export function SetupNeeded() {
  return (
    <Shell>
      <p className="text-left text-sm text-ink-700">
        MEDTRACK is not connected to a Supabase project. Copy <code>.env.example</code> to <code>.env</code>, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then rebuild. See <code>DEPLOY.md</code>.
      </p>
    </Shell>
  );
}

export function BootError({ message }: { message: string }) {
  return (
    <Shell>
      <p role="alert" className="text-sm text-bad-700">Could not open your local data: {message}</p>
      <button className="btn-ghost mt-4" onClick={() => window.location.reload()}>Retry</button>
    </Shell>
  );
}
