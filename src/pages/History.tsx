import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../lib/app';
import { Card, Empty, SectionTitle, StatusBadge, TopicBadge, cx } from '../components/ui';
import { dayKey, dayOutcome } from '../lib/engine';
import { fmtDateLong, fmtDuration, fmtTime12 } from '../lib/time';
import { recordOf, sessionsOfDay } from '../lib/actions';

type Filter = 'all' | 'missed' | 'partial' | 'completed';

export default function HistoryPage() {
  const d = useData();
  const { store } = useApp();
  const [filter, setFilter] = useState<Filter>('all');

  const days = useMemo(() => [...d.days].sort((a, b) => dayKey(b) - dayKey(a)), [d.days]);
  const shown = days
    .map((day) => ({ day, ss: sessionsOfDay(store, day.id) }))
    .filter(({ ss }) => filter === 'all' || ss.some((s) => s.status === filter));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-800">History</h1>
        <p className="text-sm text-ink-500">Every day and session ever recorded, including missed and partial ones.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Filter">
        {(['all', 'missed', 'partial', 'completed'] as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cx('min-h-[40px] rounded-full border px-4 text-sm font-semibold capitalize', filter === f ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-300 bg-white text-ink-700')}>{f}</button>
        ))}
      </div>

      {shown.length === 0 && <Empty>No {filter === 'all' ? '' : filter + ' '}sessions recorded yet.</Empty>}

      <ul className="space-y-4">
        {shown.map(({ day, ss }) => {
          const outcome = dayOutcome(day, ss);
          return (
            <li key={day.id}>
              <Card>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="font-extrabold text-navy-800">Cycle {day.cycle_number} · Day {day.day_number}</div>
                    <div className="text-xs text-ink-500">Opened {fmtDateLong(day.opened_on)}</div>
                  </div>
                  <span className={cx('rounded-full border px-2 py-0.5 text-xs font-semibold',
                    outcome === 'open' ? 'border-navy-200 bg-navy-50 text-navy-700' : outcome === 'complete' ? 'border-ok-100 bg-ok-50 text-ok-700' : 'border-bad-100 bg-bad-50 text-bad-700')}>
                    {outcome === 'open' ? 'Open' : outcome === 'complete' ? 'Closed · both completed' : 'Closed · incomplete'}
                  </span>
                </div>
                {day.review_note && <p className="mb-2 rounded bg-slate-50 p-2 text-xs italic text-ink-700">“{day.review_note}”</p>}
                <ul className="space-y-3">
                  {ss.map((s) => {
                    const rec = recordOf(store, s.id);
                    const logs = d.logs.filter((l) => l.session_id === s.id);
                    return (
                      <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase text-ink-500">{s.slot} · {fmtTime12(s.planned_start)}</div>
                            <div className="font-bold">{d.courseById.get(s.course_id)?.code} <span className="font-normal text-ink-500">{d.courseById.get(s.course_id)?.title}</span></div>
                            <div className="text-xs text-ink-700">Studied <b>{fmtDuration(rec?.actual_seconds ?? 0)}</b> of {fmtDuration(s.planned_minutes * 60)} planned{rec?.pages ? ` · pp. ${rec.pages}` : ''}{rec?.slides ? ` · slides ${rec.slides}` : ''}</div>
                          </div>
                          <StatusBadge status={s.status} />
                        </div>
                        {logs.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {logs.map((l) => (
                              <li key={l.id} className="flex items-center justify-between gap-2 text-xs"><span>• {l.topic_title}{l.confidence ? ` · confidence ${l.confidence}/5` : ''}</span><TopicBadge status={l.status_after} /></li>
                            ))}
                          </ul>
                        )}
                        {rec?.reflection && <p className="mt-2 text-xs italic text-ink-700">“{rec.reflection}”</p>}
                        <Link to={`/session/${s.id}`} className="mt-2 inline-block text-xs font-semibold text-navy-700">{s.status === 'pending' || s.status === 'partial' || s.status === 'missed' ? 'Resume / edit' : 'View / edit'} →</Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </li>
          );
        })}
      </ul>

      <section>
        <SectionTitle>Daily accountability records</SectionTitle>
        {d.accountability.length === 0 ? <Empty>No accountability checks yet.</Empty> : (
          <ul className="space-y-2">
            {[...d.accountability].sort((a, b) => b.check_date.localeCompare(a.check_date)).map((a) => (
              <li key={a.id} className="card p-3 text-sm">
                <div className="flex justify-between"><b>{fmtDateLong(a.check_date)}</b><span className={cx('font-semibold', a.followed_plan === 'yes' ? 'text-ok-700' : a.followed_plan === 'partly' ? 'text-warn-700' : 'text-bad-700')}>Followed plan: {a.followed_plan}</span></div>
                {a.biggest_obstacle && <div className="text-xs text-ink-700">Obstacle: {a.biggest_obstacle}</div>}
                {a.tomorrow_commitment && <div className="text-xs text-ink-700">Tomorrow: {a.tomorrow_commitment}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
