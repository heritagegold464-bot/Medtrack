import { useEffect, type ReactNode } from 'react';
import type { SessionStatus, TopicStatus } from '../lib/types';

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx('card', pad && 'p-4', className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{children}</h2>
      {action}
    </div>
  );
}

const SESSION_STYLE: Record<SessionStatus, { label: string; cls: string }> = {
  pending: { label: 'Not started', cls: 'bg-slate-100 text-ink-700 border-slate-200' },
  in_progress: { label: 'In progress', cls: 'bg-navy-50 text-navy-700 border-navy-200' },
  completed: { label: 'Completed', cls: 'bg-ok-50 text-ok-700 border-ok-100' },
  partial: { label: 'Partial', cls: 'bg-warn-50 text-warn-700 border-warn-100' },
  missed: { label: 'Missed', cls: 'bg-bad-50 text-bad-700 border-bad-100' },
};
export function StatusBadge({ status }: { status: SessionStatus }) {
  const s = SESSION_STYLE[status];
  return <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', s.cls)}>{s.label}</span>;
}

const TOPIC_STYLE: Record<TopicStatus, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-slate-100 text-ink-700 border-slate-200' },
  in_progress: { label: 'In progress', cls: 'bg-warn-50 text-warn-700 border-warn-100' },
  completed: { label: 'Completed', cls: 'bg-ok-50 text-ok-700 border-ok-100' },
};
export const TOPIC_LABEL = (s: TopicStatus) => TOPIC_STYLE[s].label;
export function TopicBadge({ status }: { status: TopicStatus }) {
  const s = TOPIC_STYLE[status];
  return <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', s.cls)}>{s.label}</span>;
}

export const pctText = (n: number) => (Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`);

export function ProgressBar({ pct, tone = 'ok', label, height = 'h-2.5' }: { pct: number; tone?: 'ok' | 'warn' | 'navy'; label: string; height?: string }) {
  const color = tone === 'ok' ? 'bg-ok-600' : tone === 'warn' ? 'bg-warn-600' : 'bg-navy-700';
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className={cx('w-full overflow-hidden rounded-full bg-slate-200', height)}>
      <div className={cx('h-full rounded-full', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'navy' }) {
  const color = tone === 'ok' ? 'text-ok-700' : tone === 'warn' ? 'text-warn-700' : tone === 'bad' ? 'text-bad-700' : 'text-navy-800';
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums', color)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-navy-800">{title}</h2>
          <button className="btn-ghost !min-h-[36px] !px-3" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-ink-500">{children}</div>;
}
