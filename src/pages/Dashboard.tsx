import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useData } from '../lib/app';
import { Card, ProgressBar, SectionTitle, Stat, StatusBadge, pctText, Empty } from '../components/ui';
import { BarChart } from '../components/charts';
import {
  actualSeconds, consistency, courseProgress, plannedSeconds, secondsByDay, semesterProgress, sessionCounts,
  sessionCompletionRate, weeklyConsistency, cycleSummaries,
} from '../lib/engine';
import { addDays, fmtDuration, fmtHours, fmtTime12, zonedDate, zonedParts } from '../lib/time';
import { recordOf, sessionsOfDay, startTimer } from '../lib/actions';
import { cx } from '../components/ui';

export default function Dashboard() {
  const d = useData();
  const { store } = useApp();
  const nav = useNavigate();
  const today = zonedDate();

  const daySessions = useMemo(() => (d.currentDay ? sessionsOfDay(store, d.currentDay.id) : []), [d.currentDay, d.sessions, store]);
  const nextUp = daySessions.find((s) => s.status !== 'completed' && s.status !== 'missed') ?? daySessions.find((s) => s.status !== 'completed');
  const course = (id: string) => d.courseById.get(id);

  const sem = semesterProgress(d.courses, d.topics);
  const counts = sessionCounts(d.sessions);
  const rate = sessionCompletionRate(d.sessions);
  const actual = actualSeconds(d.records);
  const planned = plannedSeconds(d.sessions);
  const cons7 = consistency(d.records, addDays(today, -6), today);
  const weeks = weeklyConsistency(d.records, today, 8);
  const byDay = secondsByDay(d.records, addDays(today, -13), today);
  const todayRecords = d.records.filter((r) => r.study_date === today);
  const todaySecs = actualSeconds(todayRecords);
  const cycles = cycleSummaries(d.days, d.sessions, d.cycleLength);
  const finishedCycles = cycles.filter((c) => c.finished).length;
  const thisCycle = cycles.find((c) => c.cycle_number === d.currentDay?.cycle_number);

  const nowMin = zonedParts(new Date()).minutesOfDay;
  const accDone = d.accountability.some((a) => a.check_date === today);
  const showAccountability = !accDone && nowMin >= parseInt((d.profile?.accountability_time ?? '18:00').slice(0, 2)) * 60;

  // "Next scheduled": the session after the one in front of you.
  const nextAfter = (() => {
    if (!d.currentDay || !nextUp) return null;
    const rest = daySessions.filter((s) => s.id !== nextUp.id && s.status !== 'completed' && s.status !== 'missed');
    if (rest.length) return { label: `${course(rest[0].course_id)?.code} · ${rest[0].slot}`, when: `today ${fmtTime12(rest[0].planned_start)}` };
    const tpl = d.templates.find((t) => t.day_number === (d.currentDay!.day_number % d.cycleLength) + 1);
    return tpl ? { label: `${course(tpl.primary_course_id)?.code} · primary`, when: `next cycle day (${(d.currentDay.day_number % d.cycleLength) + 1})` } : null;
  })();

  const attention = d.sessions.filter((s) => s.status === 'missed' || s.status === 'partial');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-800">
          {d.currentDay ? `Cycle ${d.currentDay.cycle_number} · Day ${d.currentDay.day_number} of ${d.cycleLength}` : 'Setting up…'}
        </h1>
        <p className="text-sm text-ink-500">Your position follows your closed days, not the calendar.</p>
      </div>

      {store.unresolvedConflicts().length > 0 && (
        <Link to="/conflicts" className="block rounded-lg border border-bad-100 bg-bad-50 p-3 text-sm font-semibold text-bad-700">
          {store.unresolvedConflicts().length} record(s) were changed on two devices. Review them →
        </Link>
      )}

      {/* ---- the one thing to do now */}
      {nextUp ? (
        <Card className="border-navy-700 !border-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-navy-700">
                {nextUp.status === 'in_progress' ? 'Reading in progress' : nextUp.status === 'partial' ? 'Continue — partially done' : 'Up now'} · {nextUp.slot}
              </div>
              <div className="mt-1 text-2xl font-extrabold text-navy-800">{course(nextUp.course_id)?.code}</div>
              <div className="text-sm text-ink-700">{course(nextUp.course_id)?.title}</div>
              <div className="mt-1 text-sm text-ink-500">{fmtTime12(nextUp.planned_start)} · planned {fmtDuration(nextUp.planned_minutes * 60)}</div>
            </div>
            <StatusBadge status={nextUp.status} />
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              className="btn-primary flex-1"
              onClick={() => { if (nextUp.status === 'pending' || nextUp.status === 'partial') startTimer(store, nextUp.id); nav(`/session/${nextUp.id}`); }}
            >
              {nextUp.status === 'in_progress' ? 'Open session' : nextUp.status === 'partial' ? 'Resume reading' : 'Start reading'}
            </button>
            <Link to={`/session/${nextUp.id}`} className="btn-ghost">Record manually</Link>
          </div>
          {nextAfter && <div className="mt-3 text-xs text-ink-500">Next after this: <b>{nextAfter.label}</b> · {nextAfter.when}</div>}
        </Card>
      ) : (
        d.currentDay && <Empty>Both of today's sessions are accounted for. <Link className="font-semibold text-navy-700 underline" to="/cycle">Review and close the day</Link> to move on.</Empty>
      )}

      <div className="grid grid-cols-2 gap-3">
        {daySessions.map((s) => (
          <Link key={s.id} to={`/session/${s.id}`} className="card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-ink-500">{s.slot}</span>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-1 text-lg font-bold text-navy-800">{course(s.course_id)?.code}</div>
            <div className="text-xs text-ink-500">
              {fmtTime12(s.planned_start)} · {fmtDuration(s.planned_minutes * 60)} planned
              {(recordOf(store, s.id)?.actual_seconds ?? 0) > 0 && <> · <b className="text-ink-700">{fmtDuration(recordOf(store, s.id)!.actual_seconds)} done</b></>}
            </div>
          </Link>
        ))}
      </div>

      {showAccountability && (
        <Link to="/accountability" className="block rounded-lg border border-navy-200 bg-navy-50 p-3 text-sm font-semibold text-navy-800">
          Daily accountability check is due → record how today went
        </Link>
      )}

      {/* ---- four separate measures; never combined */}
      <section>
        <SectionTitle>Four separate measures</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Planned hours" value={fmtHours(planned)} sub="of sessions generated so far" />
          <Stat label="Actual hours" value={fmtHours(actual)} tone="navy" sub={`${fmtHours(todaySecs)}h today`} />
          <Stat label="Sessions completed" value={counts.completed} tone="ok" sub={rate === null ? 'none accounted for yet' : `${pctText(Math.round(rate))} of ${counts.accounted} accounted for`} />
          <Stat label="Syllabus topics done" value={`${sem.completed}/${sem.total}`} tone="ok" sub={sem.total ? `${pctText(Math.round(sem.pct))} of tracked topics` : 'no topics tracked yet'} />
        </div>
        <p className="mt-2 text-xs text-ink-500">Time spent and sessions completed do not move syllabus completion. Only completed topics do.</p>
      </section>

      <Card>
        <SectionTitle action={<Link to="/courses" className="text-sm font-semibold text-navy-700">All courses</Link>}>Semester syllabus completion</SectionTitle>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-3xl font-extrabold text-navy-800">{pctText(Math.round(sem.pct * 10) / 10)}</span>
          <span className="text-sm text-ink-500">{sem.completed} of {sem.total} topics · {sem.inProgress} in progress</span>
        </div>
        <ProgressBar pct={sem.pct} label="Semester syllabus completion" height="h-3" />
        {sem.total === 0 && <p className="mt-2 text-xs text-warn-700">No syllabus topics are tracked yet. Open a course and import your outline to start measuring coverage.</p>}
        <ul className="mt-4 space-y-3">
          {d.courses.map((c) => {
            const p = courseProgress(d.topics.filter((t) => t.course_id === c.id));
            return (
              <li key={c.id}>
                <Link to={`/courses/${c.id}`} className="block">
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-ink-900">{c.code} <span className="font-normal text-ink-500">· {c.title}</span></span>
                    <span className="tabular-nums text-ink-700">{p.total ? `${p.completed}/${p.total} · ${pctText(Math.round(p.pct))}` : '—'}</span>
                  </div>
                  <ProgressBar pct={p.pct} label={`${c.code} completion`} />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <SectionTitle>Study hours · last 14 days</SectionTitle>
          <BarChart ariaLabel="Actual study hours per day, last 14 days" data={byDay.map((x) => ({ label: x.date.slice(8), value: x.seconds / 3600 }))} fmt={(n) => n.toFixed(1)} />
        </Card>
        <Card>
          <SectionTitle>Weekly consistency</SectionTitle>
          <div className="mb-2 text-sm text-ink-700"><b>{cons7.active}</b> of {cons7.days} days with recorded study in the last 7 days</div>
          <BarChart ariaLabel="Days with recorded study per week" color="#0f8b7d" unit=" days" fmt={(n) => String(Math.round(n))} data={weeks.map((w) => ({ label: w.weekStart.slice(5), value: w.active, sub: `of ${w.days}` }))} />
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <SectionTitle>Cycle</SectionTitle>
          <div className="text-sm text-ink-700">Completed cycles: <b>{finishedCycles}</b></div>
          {thisCycle && (
            <>
              <div className="mt-2 text-sm text-ink-700">This cycle: <b>{thisCycle.counts.accounted}</b> of {d.cycleLength * 2} sessions accounted for</div>
              <div className="mt-1"><ProgressBar pct={thisCycle.accountedPct} tone="navy" label="Cycle accounted sessions" /></div>
              <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-ink-500">
                <span className="text-ok-700">{thisCycle.counts.completed} completed</span>
                <span className="text-warn-700">{thisCycle.counts.partial} partial</span>
                <span className="text-bad-700">{thisCycle.counts.missed} missed</span>
                <span>{d.cycleLength * 2 - thisCycle.counts.accounted} remaining</span>
              </div>
            </>
          )}
        </Card>
        <Card>
          <SectionTitle action={<Link to="/history" className="text-sm font-semibold text-navy-700">History</Link>}>Missed &amp; partial</SectionTitle>
          <div className="flex gap-6">
            <div><div className={cx('text-3xl font-extrabold', counts.missed ? 'text-bad-700' : 'text-ink-500')}>{counts.missed}</div><div className="text-xs text-ink-500">missed</div></div>
            <div><div className={cx('text-3xl font-extrabold', counts.partial ? 'text-warn-700' : 'text-ink-500')}>{counts.partial}</div><div className="text-xs text-ink-500">partial</div></div>
          </div>
          {attention.length > 0 && <p className="mt-2 text-xs text-ink-500">These stay visible until you resume and finish them.</p>}
        </Card>
      </div>
    </div>
  );
}
