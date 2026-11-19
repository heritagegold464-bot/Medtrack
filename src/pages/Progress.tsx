import { useData } from '../lib/app';
import { Card, ProgressBar, SectionTitle, Stat, pctText } from '../components/ui';
import { BarChart, StackedBar } from '../components/charts';
import {
  actualSeconds, consistency, courseProgress, cycleSummaries, plannedSeconds, secondsByCourse, secondsByDay,
  semesterProgress, sessionCompletionRate, sessionCounts, weeklyConsistency,
} from '../lib/engine';
import { addDays, fmtHours, zonedDate } from '../lib/time';

export default function ProgressPage() {
  const d = useData();
  const today = zonedDate();
  const sem = semesterProgress(d.courses, d.topics);
  const counts = sessionCounts(d.sessions);
  const rate = sessionCompletionRate(d.sessions);
  const actual = actualSeconds(d.records);
  const planned = plannedSeconds(d.sessions);
  const byDay = secondsByDay(d.records, addDays(today, -29), today);
  const byCourse = secondsByCourse(d.records, d.sessions, d.courses);
  const weeks = weeklyConsistency(d.records, today, 12);
  const cons30 = consistency(d.records, addDays(today, -29), today);
  const cycles = cycleSummaries(d.days, d.sessions, d.cycleLength);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-800">Progress</h1>
        <p className="text-sm text-ink-500">Study effort, session outcomes and syllabus coverage are reported separately on purpose.</p>
      </div>

      <section>
        <SectionTitle>Study effort</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Planned hours" value={fmtHours(planned)} sub="generated sessions" />
          <Stat label="Actual hours" value={fmtHours(actual)} tone="navy" sub={planned ? `${pctText(Math.round((actual / planned) * 100))} of planned` : undefined} />
          <Stat label="30-day consistency" value={pctText(Math.round(cons30.pct))} sub={`${cons30.active} of ${cons30.days} days with study`} tone="ok" />
          <Stat label="Session completion" value={rate === null ? '—' : pctText(Math.round(rate))} sub={`${counts.completed} of ${counts.accounted} accounted for`} tone="ok" />
        </div>
      </section>

      <Card>
        <SectionTitle>Study hours by day · 30 days</SectionTitle>
        <BarChart ariaLabel="Actual study hours per day, last 30 days" data={byDay.map((x) => ({ label: x.date.slice(8), value: x.seconds / 3600 }))} fmt={(n) => n.toFixed(1)} />
      </Card>

      <Card>
        <SectionTitle>Study hours by course</SectionTitle>
        <ul className="space-y-2">
          {byCourse.map(({ course, seconds }) => {
            const max = Math.max(1, ...byCourse.map((x) => x.seconds));
            return (
              <li key={course.id}>
                <div className="flex justify-between text-sm"><span className="font-semibold">{course.code}</span><span className="tabular-nums text-ink-700">{fmtHours(seconds)}h</span></div>
                <ProgressBar pct={(seconds / max) * 100} tone="navy" label={`${course.code} hours`} />
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Weekly consistency · 12 weeks</SectionTitle>
        <p className="mb-2 text-xs text-ink-500">Days per week with recorded study (current week counts elapsed days only).</p>
        <BarChart ariaLabel="Days with recorded study per week" color="#0f8b7d" unit=" days" fmt={(n) => String(Math.round(n))} data={weeks.map((w) => ({ label: w.weekStart.slice(5), value: w.active, sub: `of ${w.days}` }))} />
      </Card>

      <Card>
        <SectionTitle>Topic coverage by course</SectionTitle>
        <p className="mb-3 text-xs text-ink-500">Semester: {sem.completed} of {sem.total} tracked topics completed ({pctText(Math.round(sem.pct * 10) / 10)}).</p>
        <ul className="space-y-3">
          {d.courses.map((c) => {
            const p = courseProgress(d.topics.filter((t) => t.course_id === c.id));
            return (
              <li key={c.id}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{c.code}</span><span className="tabular-nums text-ink-700">{p.total ? `${p.completed} done · ${p.inProgress} active · ${p.notStarted} left` : 'no topics tracked'}</span></div>
                <StackedBar completed={p.completed} inProgress={p.inProgress} notStarted={p.notStarted} label={c.code} />
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex gap-4 text-xs text-ink-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-ok-600" />Completed</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warn-600" />In progress</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />Not started</span></div>
      </Card>

      <Card pad={false}>
        <div className="p-4 pb-2"><SectionTitle>11-day cycle history</SectionTitle></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase text-ink-500"><th className="px-4 py-2">Cycle</th><th className="px-2">Days closed</th><th className="px-2">Completed</th><th className="px-2">Partial</th><th className="px-2">Missed</th><th className="px-4">Accounted</th></tr></thead>
            <tbody>
              {cycles.length === 0 && <tr><td className="px-4 py-3 text-ink-500" colSpan={6}>No cycles yet.</td></tr>}
              {[...cycles].reverse().map((c) => (
                <tr key={c.cycle_number} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-bold text-navy-800">Cycle {c.cycle_number}{c.finished && <span className="ml-2 text-xs font-semibold text-ok-700">finished</span>}</td>
                  <td className="px-2">{c.daysClosed}/{c.totalDays}</td>
                  <td className="px-2 text-ok-700">{c.counts.completed}</td>
                  <td className="px-2 text-warn-700">{c.counts.partial}</td>
                  <td className="px-2 text-bad-700">{c.counts.missed}</td>
                  <td className="px-4 tabular-nums">{c.counts.accounted}/{c.totalDays * 2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
