import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useData } from '../lib/app';
import { Card, Modal, ProgressBar, SectionTitle, StatusBadge, Stat, cx } from '../components/ui';
import { cycleSummaries, dayOutcome, statusOnClose } from '../lib/engine';
import { closeDay, recordOf, sessionsOfDay } from '../lib/actions';
import { fmtDuration, fmtTime12 } from '../lib/time';
import type { SessionStatus } from '../lib/types';

export default function CyclePage() {
  const d = useData();
  const { store } = useApp();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);

  const cycleNo = d.currentDay?.cycle_number ?? 1;
  const cycleDays = d.days.filter((x) => x.cycle_number === cycleNo);
  const summary = cycleSummaries(d.days, d.sessions, d.cycleLength).find((c) => c.cycle_number === cycleNo);
  const cur = d.currentDay;
  const curSessions = useMemo(() => (cur ? sessionsOfDay(store, cur.id) : []), [cur, d.sessions, store]);
  const code = (id: string) => d.courseById.get(id)?.code ?? '?';

  const preview = curSessions.map((s) => ({ s, after: statusOnClose(s.status, recordOf(store, s.id)?.actual_seconds ?? 0) as SessionStatus }));
  const willChange = preview.filter((p) => p.after !== p.s.status);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-800">Reading Cycle</h1>
        <p className="text-sm text-ink-500">11 days · 22 sessions · 9:00 AM primary (3h) and 4:00 PM secondary (2h), seven days a week.</p>
      </div>

      {cur && (
        <Card className="!border-2 !border-navy-700">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-navy-700">Current day</div>
              <div className="text-xl font-extrabold text-navy-800">Cycle {cur.cycle_number} · Day {cur.day_number}</div>
            </div>
            <button className="btn-ghost" onClick={() => setClosing(true)}>Review &amp; close day</button>
          </div>
          <ul className="mt-3 space-y-2">
            {curSessions.map((s) => (
              <li key={s.id}>
                <Link to={`/session/${s.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                  <div>
                    <div className="text-xs font-semibold uppercase text-ink-500">{s.slot} · {fmtTime12(s.planned_start)} · {fmtDuration(s.planned_minutes * 60)}</div>
                    <div className="font-bold text-navy-800">{code(s.course_id)} <span className="font-normal text-ink-500">{d.courseById.get(s.course_id)?.title}</span></div>
                    {(recordOf(store, s.id)?.actual_seconds ?? 0) > 0 && <div className="text-xs text-ink-700">Recorded: {fmtDuration(recordOf(store, s.id)!.actual_seconds)}</div>}
                  </div>
                  <StatusBadge status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-500">The day advances when both sessions are completed, or when you review and close it. It never advances by itself because the date changed.</p>
        </Card>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Accounted" value={`${summary.counts.accounted}/${d.cycleLength * 2}`} sub="sessions this cycle" tone="navy" />
          <Stat label="Completed" value={summary.counts.completed} tone="ok" />
          <Stat label="Partial" value={summary.counts.partial} tone="warn" />
          <Stat label="Missed" value={summary.counts.missed} tone="bad" />
          <div className="col-span-2 sm:col-span-4"><ProgressBar pct={summary.accountedPct} tone="navy" label="Cycle accounted-for sessions" /></div>
        </div>
      )}

      <Card pad={false}>
        <div className="flex items-center justify-between p-4 pb-2">
          <SectionTitle>Timetable</SectionTitle>
          <button className="btn-ghost !min-h-[36px]" onClick={() => setEditing(true)}>Edit timetable</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase text-ink-500">
                <th className="px-4 py-2">Day</th><th className="px-2 py-2">Primary · 9:00 AM</th><th className="px-2 py-2">Secondary · 4:00 PM</th><th className="px-4 py-2">This cycle</th>
              </tr>
            </thead>
            <tbody>
              {d.templates.map((t) => {
                const inst = cycleDays.find((x) => x.day_number === t.day_number);
                const ss = inst ? sessionsOfDay(store, inst.id) : [];
                const outcome = inst ? dayOutcome(inst, ss) : null;
                const isCur = cur?.day_number === t.day_number && cur?.cycle_number === cycleNo;
                return (
                  <tr key={t.id} className={cx('border-b border-slate-100', isCur && 'bg-navy-50')}>
                    <td className="px-4 py-2 font-bold text-navy-800">{t.day_number}{isCur && <span className="ml-2 rounded bg-navy-800 px-1.5 py-0.5 text-[10px] text-white">NOW</span>}</td>
                    <td className="px-2 py-2 font-semibold">{code(t.primary_course_id)}</td>
                    <td className="px-2 py-2 font-semibold">{code(t.secondary_course_id)}</td>
                    <td className="px-4 py-2">
                      {!inst ? <span className="text-xs text-ink-500">upcoming</span> : (
                        <span className="flex flex-wrap gap-1">
                          {ss.map((s) => <StatusBadge key={s.id} status={s.status} />)}
                          {outcome === 'incomplete' && <span className="text-xs font-semibold text-bad-700">closed incomplete</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {closing && cur && (
        <Modal title={`Close Day ${cur.day_number}?`} onClose={() => setClosing(false)}>
          <p className="mb-3 text-sm text-ink-700">Closing moves you to the next cycle day. Nothing is hidden: unfinished sessions are recorded exactly as shown below.</p>
          <ul className="mb-3 space-y-2">
            {preview.map(({ s, after }) => (
              <li key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2 text-sm">
                <span className="font-semibold">{code(s.course_id)} <span className="text-xs font-normal text-ink-500">{s.slot}</span></span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  {after !== s.status && <>→ <StatusBadge status={after} /></>}
                </span>
              </li>
            ))}
          </ul>
          {willChange.length > 0 && <p className="mb-3 rounded-lg bg-warn-50 p-2 text-xs text-warn-700">{willChange.length} session(s) will be recorded as incomplete. They stay visible on your dashboard and in History.</p>}
          <label className="label" htmlFor="note">Review note (optional)</label>
          <textarea id="note" className="input min-h-[72px] py-2" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why was anything left unfinished?" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setClosing(false)}>Keep day open</button>
            <button className="btn-primary" onClick={() => { closeDay(store, cur.id, note); setClosing(false); setNote(''); }}>Close day</button>
          </div>
        </Modal>
      )}

      {editing && <TimetableEditor onClose={() => setEditing(false)} />}
    </div>
  );
}

function TimetableEditor({ onClose }: { onClose: () => void }) {
  const d = useData();
  const { store } = useApp();
  const [draft, setDraft] = useState(() => Object.fromEntries(d.templates.map((t) => [t.id, { p: t.primary_course_id, s: t.secondary_course_id }])));
  const save = () => {
    for (const t of d.templates) {
      const v = draft[t.id];
      if (v.p !== t.primary_course_id || v.s !== t.secondary_course_id) store.put('cycle_templates', { id: t.id, primary_course_id: v.p, secondary_course_id: v.s });
    }
    onClose();
  };
  return (
    <Modal title="Edit timetable" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-500">Changes apply to days that are opened from now on. Days already opened, and all history, are not rewritten.</p>
      <div className="space-y-2">
        {d.templates.map((t) => (
          <div key={t.id} className="grid grid-cols-[48px_1fr_1fr] items-center gap-2">
            <span className="text-sm font-bold text-navy-800">Day {t.day_number}</span>
            {(['p', 's'] as const).map((k) => (
              <select key={k} aria-label={`Day ${t.day_number} ${k === 'p' ? 'primary' : 'secondary'}`} className="input !px-2" value={draft[t.id][k]} onChange={(e) => setDraft({ ...draft, [t.id]: { ...draft[t.id], [k]: e.target.value } })}>
                {d.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save timetable</button>
      </div>
    </Modal>
  );
}
