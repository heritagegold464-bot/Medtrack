import { NavLink, Outlet, Link } from 'react-router-dom';
import { useApp, useStoreVersion, DEV_LOCAL } from '../lib/app';
import { cx } from './ui';
import { fmtTime12 } from '../lib/time';

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
  { to: '/cycle', label: 'Reading Cycle', short: 'Cycle', icon: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5' },
  { to: '/courses', label: 'Courses', short: 'Courses', icon: 'M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5zM8 7h6M8 11h6' },
  { to: '/progress', label: 'Progress', short: 'Progress', icon: 'M4 20V10M10 20V4M16 20v-8M22 20H2' },
  { to: '/history', label: 'History', short: 'History', icon: 'M12 7v5l3 2M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5' },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4H9l-.5 2.5-1.5 1L5 7l-2 4 2 1v2l-2 1 2 4 2-.5 1.5 1L9 20h6l.5-2.5 1.5-1 2 .5 2-4-2-1z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function SyncChip() {
  const { store } = useApp();
  useStoreVersion();
  const pending = store.pendingCount();
  const conflicts = store.unresolvedConflicts().length;
  const st = store.status;
  let text = 'Synced', tone = 'bg-ok-50 text-ok-700 border-ok-100';
  if (st.state === 'disabled') { text = 'Local only'; tone = 'bg-warn-50 text-warn-700 border-warn-100'; }
  else if (conflicts) { text = `${conflicts} conflict${conflicts > 1 ? 's' : ''}`; tone = 'bg-bad-50 text-bad-700 border-bad-100'; }
  else if (st.state === 'offline') { text = pending ? `Offline · ${pending} pending` : 'Offline'; tone = 'bg-warn-50 text-warn-700 border-warn-100'; }
  else if (st.state === 'error') { text = 'Sync error'; tone = 'bg-bad-50 text-bad-700 border-bad-100'; }
  else if (st.state === 'syncing') { text = 'Syncing…'; tone = 'bg-navy-50 text-navy-700 border-navy-200'; }
  else if (pending) { text = `${pending} pending`; tone = 'bg-warn-50 text-warn-700 border-warn-100'; }
  return (
    <Link to={conflicts ? '/conflicts' : '/settings'} className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold', tone)} aria-live="polite">
      {text}
    </Link>
  );
}

export default function Layout() {
  const { user } = useApp();
  return (
    <div className="min-h-screen md:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-navy-800 p-4 text-white md:flex">
        <div className="mb-6 px-2">
          <div className="text-xl font-extrabold tracking-wide">MEDTRACK</div>
          <div className="text-xs text-navy-200">Semester reading system</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium', isActive ? 'bg-white/15 text-white' : 'text-navy-100 hover:bg-white/10')}>
              <Icon d={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="truncate px-2 text-xs text-navy-200">{user.email}</div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:px-8">
        <div className="text-base font-extrabold tracking-wide text-navy-800 md:hidden">MEDTRACK</div>
        <div className="hidden text-sm text-ink-500 md:block">Africa/Lagos · primary {fmtTime12('09:00')} · secondary {fmtTime12('16:00')}</div>
        <SyncChip />
      </header>
      {DEV_LOCAL && <div className="bg-warn-100 px-4 py-1 text-center text-xs font-semibold text-warn-700">DEV LOCAL MODE — not signed in, not syncing</div>}

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:px-8 md:pb-10">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', isActive ? 'text-navy-800' : 'text-ink-500')}>
            <Icon d={n.icon} />
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
