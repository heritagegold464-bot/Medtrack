import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useData, useNow } from '../lib/app';
import { Card, SectionTitle, StatusBadge, TopicBadge, cx } from '../components/ui';
import { childrenMap, effectiveStatus } from '../lib/engine';
import { fmtClock, fmtDuration, fmtTime12 } from '../lib/time';
import { liveSeconds, pauseTimer, recordOf, saveSession, startTimer, validateSave, type TopicInput } from '../lib/actions';
import type { Topic, TopicStatus } from '../lib/types';

interface Sel extends Omit<TopicInput, 'topic_id'> { on: boolean }

export default function SessionPage() {
  const { id } = useParams();
  const { store } = useApp();
  const d = useData();
  const nav = useNavigate();
  const session = d.sessions.find((s) => s.id === id);
  const rec = session ? recordOf(store, session.id) : undefined;
  const running = !!rec?.timer_running_since;
  const now = useNow(1000);
  const finishRef = useRef<HTMLDivElement>(null);

  const course = session ? d.courseById.get(session.course_id) : undefined;
  const day = session ? d.days.find((x) => x.id === session.cycle_day_id) : undefined;
  const courseTopics = useMemo(() => d.topics.filter((t) => t.course_id === session?.course_id), [d.topics, session?.course_id]);
  const kids = useMemo(() => childrenMap(courseTopics), [courseTopics]);
  const existingLogs = useMemo(() => d.logs.filter((l) => l.session_id === session?.id), [d.logs, session?.id]);

  const [manual, setManual] = useState<string | null>(null);
  const [pages, setPages] = useState<string | null>(null);
  const [slides, setSlides] = useState<string | null>(null);
  const [reflection, setReflection] = useState<string | null>(null);
  const [status, setStatus] = useState<'completed' | 'partial' | 'missed' | null>(null);
  const [sel, setSel] = useState<Record<string, Sel>>({});
  const [error, setError] = useState<string | null>(null);

  if (!session || !course) return <Card>Session not found. <Link className="underline" to="/">Back</Link></Card>;

  const live = liveSeconds(rec, now);
  const manualSecs = manual !== null ? Math.round((parseFloat(manual) || 0) * 60) : null;
  const seconds = manualSecs ?? live;
  const planned = session.planned_minutes * 60;
  const current = status ?? (session.status === 'completed' || session.status === 'partial' || session.status === 'missed' ? session.status : null);

  const selFor = (t: Topic): Sel => {
    const mine = sel[t.id];
    if (mine) return mine;
    const log = existingLogs.find((l) => l.topic_id === t.id);
    if (log) return { on: true, status_after: log.status_after, confidence: log.confidence, minutes: log.minutes, pages: log.pages, notes: log.notes };
    return { on: false, status_after: t.status === 'completed' ? 'completed' : 'in_progress', confidence: null, minutes: 0, pages: '', notes: '' };
  };
  const setTopic = (t: Topic, patch: Partial<Sel>) => setSel((s) => ({ ...s, [t.id]: { ...selFor(t), ...patch } }));

  const flat: Array<{ t: Topic; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of kids.get(parent) ?? []) { flat.push({ t, depth }); walk(t.id, depth + 1); }
  };
  walk(null, 0);

  const chosen: TopicInput[] = flat
    .filter(({ t }) => !(kids.get(t.id)?.length) && selFor(t).on)
    .map(({ t }) => { const s = selFor(t); return { topic_id: t.id, status_after: s.status_after, confidence: s.confidence, minutes: s.minutes, pages: s.pages, notes: s.notes }; });

  const build = (st: 'completed' | 'partial' | 'missed') => ({
    sessionId: session.id, status: st, seconds, topics: chosen,
    pages: pages ?? rec?.pages ?? '', slides: slides ?? rec?.slides ?? '', reflection: reflection ?? rec?.reflection ?? '',
  });

  const save = (st: 'completed' | 'partial' | 'missed') => {
    const input = build(st);
    const err = validateSave(input);
    if (err) return setError(err);
    try { saveSession(store, input); nav('/'); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const endSession = () => {
    pauseTimer(store, session.id);
    const secs = recordOf(store, session.id)?.actual_seconds ?? 0;
    setManual(null);
    setStatus(secs >= planned ? 'completed' : secs > 0 ? 'partial' : null);
    setTimeout(() => finishRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const missed = current === 'missed';
  const shortfall = planned - seconds;

  return (
    <div className="space-y-5">
      <Link to="/" className="text-sm font-semibold text-navy-700">← Dashboard</Link>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-navy-700">
              Cycle {day?.cycle_number} · Day {day?.day_number} · {session.slot} session
            </div>
            <h1 className="mt-1 text-2xl font-extrabold text-navy-800">{course.code}</h1>
            <p className="text-sm text-ink-700">{course.title}</p>
            <p className="mt-1 text-sm text-ink-500">Planned {fmtTime12(session.planned_start)} · {fmtDuration(planned)}</p>
          </div>
          <StatusBadge status={session.status} />
        </div>
        {day?.status === 'closed' && <p className="mt-3 rounded-lg bg-slate-100 p-2 text-xs text-ink-700">This day is closed. Changes here update this session's record; the day stays in your history.</p>}
      </Card>

      {/* ---------------- timer */}
      <Card>
        <SectionTitle>Study timer (optional)</SectionTitle>
        <div className="text-center">
          <div className={cx('font-mono text-5xl font-bold tabular-nums', running ? 'text-navy-800' : 'text-ink-500')} aria-live="off">{fmtClock(live)}</div>
          <div className="mt-1 text-xs text-ink-500">{running ? 'Running' : live > 0 ? 'Paused' : 'Not started'} · planned {fmtDuration(planned)} — the timer never stops you early or assumes you finished</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {running ? (
            <button className="btn-ghost" onClick={() => pauseTimer(store, session.id)}>Pause</button>
          ) : (
            <button className="btn-primary" disabled={session.status === 'completed'} onClick={() => { setManual(null); startTimer(store, session.id); }}>{live > 0 ? 'Resume' : 'Start reading'}</button>
          )}
          <button className="btn-ghost" onClick={endSession} disabled={live === 0 && !running}>End session</button>
        </div>
        {session.status === 'completed' && <p className="mt-2 text-xs text-ink-500">Completed. Change the outcome below to add more time.</p>}
      </Card>

      {/* ---------------- actual time */}
      <Card>
        <SectionTitle>Time actually studied</SectionTitle>
        <label className="label" htmlFor="mins">Minutes (manual entry)</label>
        <div className="flex items-center gap-3">
          <input
            id="mins" className="input max-w-[140px]" type="number" inputMode="decimal" min={0} max={1440} step={5} disabled={running}
            value={manual ?? String(Math.round(live / 60))} onChange={(e) => setManual(e.target.value)}
          />
          <div className="text-sm text-ink-700"><b>{fmtDuration(seconds)}</b> recorded of {fmtDuration(planned)} planned</div>
        </div>
        {running && <p className="mt-1 text-xs text-ink-500">Pause the timer to edit manually.</p>}
        {seconds > 0 && shortfall > 0 && (
          <p className="mt-2 rounded-lg bg-warn-50 p-2 text-xs text-warn-700">{fmtDuration(shortfall)} of the plan is not covered. It will not be counted as studied.</p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pages">Pages covered</label>
            <input id="pages" className="input" placeholder="e.g. 12–34" maxLength={500} value={pages ?? rec?.pages ?? ''} onChange={(e) => setPages(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="slides">Lecture slides covered</label>
            <input id="slides" className="input" placeholder="e.g. 1–45" maxLength={500} value={slides ?? rec?.slides ?? ''} onChange={(e) => setSlides(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* ---------------- topics */}
      <Card>
        <SectionTitle action={<Link to={`/courses/${course.id}`} className="text-sm font-semibold text-navy-700">Manage topics</Link>}>Topics studied</SectionTitle>
        <p className="mb-3 text-xs text-ink-500">Tick what you actually covered. Only topics you mark <b>Completed</b> raise syllabus progress — studying for hours does not.</p>
        {flat.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-ink-500">
            {course.code} has no tracked topics yet. <Link className="font-semibold text-navy-700 underline" to={`/courses/${course.id}`}>Add or import them</Link> to record coverage.
          </p>
        ) : (
          <ul className="space-y-2">
            {flat.map(({ t, depth }) => {
              const isParent = !!kids.get(t.id)?.length;
              const s = selFor(t);
              return (
                <li key={t.id} style={{ marginLeft: depth * 16 }} className={cx('rounded-lg border p-2', s.on ? 'border-navy-600 bg-navy-50' : 'border-slate-200')}>
                  {isParent ? (
                    <div className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-700"><span>{t.title}</span><TopicBadge status={effectiveStatus(t, kids)} /></div>
                  ) : (
                    <>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                        <input type="checkbox" className="h-5 w-5 accent-[#163659]" checked={s.on} onChange={(e) => setTopic(t, { on: e.target.checked })} />
                        <span className="flex-1">{t.title}</span>
                        <TopicBadge status={t.status} />
                      </label>
                      {s.on && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="label">Status after this session</label>
                            <select aria-label={`Status after this session: ${t.title}`} className="input" value={s.status_after} onChange={(e) => setTopic(t, { status_after: e.target.value as TopicStatus })}>
                              <option value="in_progress">In progress</option>
                              <option value="completed">Completed</option>
                              <option value="not_started">Not started</option>
                            </select>
                          </div>
                          <div>
                            <label className="label">Confidence (1–5)</label>
                            <select aria-label={`Confidence (1–5): ${t.title}`} className="input" value={s.confidence ?? ''} onChange={(e) => setTopic(t, { confidence: e.target.value ? Number(e.target.value) : null })}>
                              <option value="">—</option>
                              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="label">Minutes on this topic</label>
                            <input aria-label={`Minutes on ${t.title}`} className="input" type="number" min={0} max={1440} value={s.minutes || ''} onChange={(e) => setTopic(t, { minutes: Number(e.target.value) || 0 })} />
                          </div>
                          <div>
                            <label className="label">Pages / slides</label>
                            <input aria-label={`Pages / slides: ${t.title}`} className="input" maxLength={200} value={s.pages} onChange={(e) => setTopic(t, { pages: e.target.value })} />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="label">Note</label>
                            <input aria-label={`Note: ${t.title}`} className="input" maxLength={500} value={s.notes} onChange={(e) => setTopic(t, { notes: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---------------- finish */}
      <div ref={finishRef} />
      <Card>
        <SectionTitle>Reflection &amp; outcome</SectionTitle>
        <label className="label" htmlFor="refl">Short study reflection</label>
        <textarea id="refl" className="input min-h-[88px] py-2" maxLength={2000} placeholder="What went well? What was hard? What next?" value={reflection ?? rec?.reflection ?? ''} onChange={(e) => setReflection(e.target.value)} />

        <div className="mt-4">
          <div className="label">How did this session go?</div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Session outcome">
            {([['completed', 'Completed', 'border-ok-600 bg-ok-50 text-ok-700'], ['partial', 'Partial', 'border-warn-600 bg-warn-50 text-warn-700'], ['missed', 'Missed', 'border-bad-600 bg-bad-50 text-bad-700']] as const).map(([v, label, on]) => (
              <button key={v} role="radio" aria-checked={current === v} onClick={() => setStatus(v)} className={cx('min-h-[48px] rounded-lg border-2 text-sm font-bold', current === v ? on : 'border-slate-200 bg-white text-ink-700')}>{label}</button>
            ))}
          </div>
          {current === 'completed' && seconds > 0 && shortfall > 600 && (
            <p className="mt-2 text-xs text-warn-700">You recorded {fmtDuration(seconds)} of {fmtDuration(planned)}. If you did not finish the planned reading, choose Partial so the record stays accurate.</p>
          )}
          {missed && <p className="mt-2 text-xs text-ink-500">Missed sessions stay visible in your history and on the dashboard. They are never counted as completed.</p>}
        </div>

        {error && <p role="alert" className="mt-3 rounded-lg bg-bad-50 p-2 text-sm font-semibold text-bad-700">{error}</p>}
        <button className="btn-primary mt-4 w-full" disabled={!current} onClick={() => current && save(current)}>
          {current ? `Save session as ${current}` : 'Choose an outcome to save'}
        </button>
      </Card>
    </div>
  );
}
