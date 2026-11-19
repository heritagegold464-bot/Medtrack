import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp, useData } from '../lib/app';
import { Card, Empty, Modal, ProgressBar, SectionTitle, Stat, TopicBadge, pctText, cx } from '../components/ui';
import { childrenMap, courseProgress, effectiveStatus, parseOutline } from '../lib/engine';
import { addTopic, deleteTopic, importOutline, moveTopic } from '../lib/actions';
import type { Topic, TopicStatus } from '../lib/types';

export function CoursesPage() {
  const d = useData();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-800">Courses</h1>
        <p className="text-sm text-ink-500">Completion here is the share of syllabus topics you have completed — not hours studied.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {d.courses.map((c) => {
          const p = courseProgress(d.topics.filter((t) => t.course_id === c.id));
          return (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`} className="card block p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-extrabold text-navy-800">{c.code}</div>
                    <div className="text-sm text-ink-700">{c.title}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{c.units} units · {c.department}{!c.included && ' · excluded from semester total'}</div>
                  </div>
                  <div className="text-right text-xl font-bold tabular-nums text-navy-800">{p.total ? pctText(Math.round(p.pct)) : '—'}</div>
                </div>
                <div className="mt-3"><ProgressBar pct={p.pct} label={`${c.code} completion`} /></div>
                <div className="mt-1.5 text-xs text-ink-500">
                  {p.total ? `${p.completed} completed · ${p.inProgress} in progress · ${p.notStarted} remaining of ${p.total}` : 'No topics tracked yet'}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CourseDetail() {
  const { id } = useParams();
  const d = useData();
  const { store } = useApp();
  const course = d.courseById.get(id ?? '');
  const topics = useMemo(() => d.topics.filter((t) => t.course_id === id), [d.topics, id]);
  const kids = useMemo(() => childrenMap(topics), [topics]);
  const [newTitle, setNewTitle] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  if (!course) return <Card>Course not found. <Link className="underline" to="/courses">Back</Link></Card>;
  const p = courseProgress(topics);

  const rows: Array<{ t: Topic; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of kids.get(parent) ?? []) { rows.push({ t, depth }); walk(t.id, depth + 1); }
  };
  walk(null, 0);

  const add = () => {
    try { addTopic(store, course.id, newTitle, null); setNewTitle(''); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-5">
      <Link to="/courses" className="text-sm font-semibold text-navy-700">← Courses</Link>
      <Card>
        <h1 className="text-2xl font-extrabold text-navy-800">{course.code}</h1>
        <p className="text-sm text-ink-700">{course.title}</p>
        <p className="text-xs text-ink-500">{course.units} units · {course.department}</p>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-3xl font-extrabold text-navy-800">{p.total ? pctText(Math.round(p.pct * 10) / 10) : '—'}</span>
          <span className="text-sm text-ink-500">syllabus completion</span>
        </div>
        <ProgressBar pct={p.pct} label={`${course.code} syllabus completion`} height="h-3" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total topics" value={p.total} />
          <Stat label="Completed" value={p.completed} tone="ok" />
          <Stat label="In progress" value={p.inProgress} tone="warn" />
          <Stat label="Remaining" value={p.notStarted} />
        </div>
        <label className="mt-4 flex min-h-[44px] items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[#163659]" checked={course.included} onChange={(e) => store.put('courses', { id: course.id, included: e.target.checked })} />
          Include in semester completion
        </label>
      </Card>

      <Card>
        <SectionTitle action={<button className="btn-ghost !min-h-[36px]" onClick={() => setImporting(true)}>Import outline</button>}>Syllabus topics</SectionTitle>
        {rows.length === 0 && (
          <Empty>
            No topics yet. Official topics come from your course outline — use <b>Import outline</b> to paste it, headings are kept exactly as written. You can also add your own topics below.
          </Empty>
        )}
        <ul className="space-y-2">
          {rows.map(({ t, depth }, i) => (
            <TopicRow key={t.id} t={t} depth={depth} hasKids={!!kids.get(t.id)?.length} derived={effectiveStatus(t, kids)} first={i === 0} />
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <input className="input" aria-label="New topic title" maxLength={500} placeholder="Add a personal topic" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn-primary" onClick={add} disabled={!newTitle.trim()}>Add</button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-bad-700">{error}</p>}
      </Card>

      {importing && <ImportModal courseId={course.id} onClose={() => setImporting(false)} />}
    </div>
  );
}

function TopicRow({ t, depth, hasKids, derived }: { t: Topic; depth: number; hasKids: boolean; derived: TopicStatus; first: boolean }) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState('');
  const [title, setTitle] = useState(t.title);
  const status = hasKids ? derived : t.status;
  const confirmDelete = () => {
    const n = hasKids ? ' and its subtopics' : '';
    if (window.confirm(`Delete “${t.title}”${n}? Past session records that studied it keep their own copy of the title.`)) deleteTopic(store, t);
  };
  return (
    <li style={{ marginLeft: depth * 16 }} className="rounded-lg border border-slate-200 p-2">
      <div className="flex items-center gap-2">
        <button className="flex min-h-[44px] flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={cx('flex-1 text-sm', depth === 0 && 'font-semibold')}>{t.title}</span>
          {t.is_official ? <span className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-bold text-navy-700">OFFICIAL</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-500">PERSONAL</span>}
        </button>
        {hasKids ? <TopicBadge status={status} /> : (
          <select aria-label={`Status of ${t.title}`} className="input !min-h-[40px] !w-auto !px-2" value={t.status} onChange={(e) => store.put('syllabus_topics', { id: t.id, status: e.target.value as TopicStatus })}>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          {hasKids && <p className="text-xs text-ink-500">Status is derived from its subtopics.</p>}
          <div>
            <label className="label">Title</label>
            <div className="flex gap-2">
              <input aria-label="Topic title" className="input" maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
              <button className="btn-ghost" disabled={!title.trim() || title === t.title} onClick={() => store.put('syllabus_topics', { id: t.id, title: title.trim() })}>Save</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Page / slide reference</label>
              <input aria-label="Page / slide reference" className="input" maxLength={200} defaultValue={t.page_ref} onBlur={(e) => e.target.value !== t.page_ref && store.put('syllabus_topics', { id: t.id, page_ref: e.target.value })} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input aria-label="Topic notes" className="input" maxLength={1000} defaultValue={t.notes} onBlur={(e) => e.target.value !== t.notes && store.put('syllabus_topics', { id: t.id, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <input className="input" aria-label={`Add subtopic under ${t.title}`} maxLength={500} placeholder="Add personal subtopic" value={sub} onChange={(e) => setSub(e.target.value)} />
            <button className="btn-ghost" disabled={!sub.trim()} onClick={() => { addTopic(store, t.course_id, sub, t.id); setSub(''); }}>Add</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost !min-h-[36px]" onClick={() => moveTopic(store, t, -1)}>↑ Move up</button>
            <button className="btn-ghost !min-h-[36px]" onClick={() => moveTopic(store, t, 1)}>↓ Move down</button>
            <button className="btn-danger !min-h-[36px]" onClick={confirmDelete}>Delete</button>
          </div>
        </div>
      )}
    </li>
  );
}

function ImportModal({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const { store } = useApp();
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(true);
  const parsed = useMemo(() => parseOutline(text, keep), [text, keep]);
  return (
    <Modal title="Import course outline" onClose={onClose}>
      <p className="mb-2 text-xs text-ink-500">Paste the topic headings exactly as they appear in your course outline, one per line. Indent (or use 1.1 numbering) to make subtopics. They are saved as <b>official</b> topics, unchanged, all “not started”.</p>
      <textarea className="input min-h-[180px] py-2 font-mono text-xs" aria-label="Outline text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Topic heading\n  Subtopic\n  Subtopic\nNext topic heading'} />
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep numbering in titles</label>
      {parsed.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs">
          <div className="mb-1 font-semibold text-ink-700">{parsed.length} topics will be added:</div>
          {parsed.map((p, i) => <div key={i} style={{ marginLeft: p.depth * 14 }}>• {p.title}</div>)}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!parsed.length} onClick={() => { importOutline(store, courseId, text, keep); onClose(); }}>Import {parsed.length || ''} topics</button>
      </div>
    </Modal>
  );
}
