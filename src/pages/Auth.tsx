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

const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_AUTH === '1';

export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const google = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } } });
    if (error) { setErr(error.message); setBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setInfo('');
    if (password.length < 8) return setErr('Use a password of at least 8 characters.');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setErr(error.message);
      } else {
        const { data, error } = await supabase!.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) setErr(error.message);
        else if (!data.session) setInfo('Account created. Check your email and tap the confirmation link, then sign in here.');
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not reach the server. Check your connection.');
    } finally { setBusy(false); }
  };

  return (
    <Shell>
      <p className="mb-4 text-sm text-ink-700">Track your 11-day reading cycle and your real syllabus progress. Your records follow you across devices.</p>
      <form onSubmit={submit} className="space-y-3 text-left">
        <div>
          <label className="label" htmlFor="em">Email</label>
          <input id="em" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={busy} type="submit">{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="mt-3 text-sm font-semibold text-navy-700" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(''); setInfo(''); }}>
        {mode === 'signin' ? 'First time? Create your account' : 'Already have an account? Sign in'}
      </button>
      {GOOGLE_ENABLED && (
        <button className="btn-ghost mt-3 w-full" disabled={busy} onClick={() => void google()}>Continue with Google</button>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-bad-700">{err}</p>}
      {info && <p role="status" className="mt-3 text-sm text-ok-700">{info}</p>}
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
