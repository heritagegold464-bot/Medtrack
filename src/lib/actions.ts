import type { Store } from './store';
import type {
  CycleDay, ReadingSession, SessionStatus, StudyRecord, Topic, TopicLog, TopicStatus,
} from './types';
import { buildDay, canAutoClose, currentDayRef, parseOutline, statusOnClose } from './engine';
import { detId } from './ids';
import { zonedDate } from './time';

// ------------------------------------------------------------------ cycle

/** Make sure exactly the right day is open: resume the open one, or open the day after the last closed one. */
export function ensureCurrentDay(store: Store): CycleDay | null {
  const templates = store.rows('cycle_templates');
  const profile = store.get('profiles', store.userId);
  if (!templates.length || !profile) return null;
  const days = store.rows('cycle_days');
  const ref = currentDayRef(days, templates.length);
  if (ref.kind === 'open') return ref.day;
  const now = new Date().toISOString();
  const { day, sessions } = buildDay(store.userId, ref.cycle_number, ref.day_number, templates, profile, zonedDate(), now);
  // Insert the day first, then its sessions (foreign key order is also enforced when pushing).
  const saved = store.put('cycle_days', day);
  for (const s of sessions) store.put('reading_sessions', s);
  return saved;
}

export function sessionsOfDay(store: Store, dayId: string): ReadingSession[] {
  return store.rows('reading_sessions').filter((s) => s.cycle_day_id === dayId).sort((a, b) => (a.slot === 'primary' ? -1 : 1) - (b.slot === 'primary' ? -1 : 1));
}

export function recordOf(store: Store, sessionId: string): StudyRecord | undefined {
  return store.rows('study_records').find((r) => r.session_id === sessionId);
}

export function closeDay(store: Store, dayId: string, note: string): void {
  const day = store.get('cycle_days', dayId);
  if (!day || day.status === 'closed') return;
  const sessions = sessionsOfDay(store, dayId);
  for (const s of sessions) {
    const rec = recordOf(store, s.id);
    if (rec?.timer_running_since) pauseTimer(store, s.id);
    const secs = recordOf(store, s.id)?.actual_seconds ?? 0;
    const next = statusOnClose(s.status, secs);
    if (next !== s.status) store.put('reading_sessions', { id: s.id, status: next });
  }
  const all = sessionsOfDay(store, dayId);
  store.put('cycle_days', {
    id: dayId,
    status: 'closed',
    close_reason: all.every((s) => s.status === 'completed') ? 'completed' : 'reviewed',
    closed_at: new Date().toISOString(),
    review_note: note.trim(),
  });
  ensureCurrentDay(store);
}

function maybeAutoClose(store: Store, dayId: string) {
  const day = store.get('cycle_days', dayId);
  if (day?.status === 'open' && canAutoClose(sessionsOfDay(store, dayId))) closeDay(store, dayId, '');
}

// ------------------------------------------------------------------ timer & session records

export function liveSeconds(rec: StudyRecord | undefined, nowMs = Date.now()): number {
  if (!rec) return 0;
  const extra = rec.timer_running_since ? Math.max(0, Math.floor((nowMs - Date.parse(rec.timer_running_since)) / 1000)) : 0;
  return rec.timer_accumulated_seconds + extra;
}

function upsertRecord(store: Store, sessionId: string, patch: Partial<StudyRecord>): StudyRecord {
  const existing = recordOf(store, sessionId);
  return store.put('study_records', {
    id: existing?.id ?? detId(store.userId, `record:${sessionId}`),
    session_id: sessionId,
    actual_seconds: existing?.actual_seconds ?? 0,
    timer_accumulated_seconds: existing?.timer_accumulated_seconds ?? 0,
    timer_running_since: existing?.timer_running_since ?? null,
    study_date: existing?.study_date ?? zonedDate(),
    pages: existing?.pages ?? '',
    slides: existing?.slides ?? '',
    reflection: existing?.reflection ?? '',
    ...patch,
  });
}

export function startTimer(store: Store, sessionId: string) {
  const s = store.get('reading_sessions', sessionId);
  if (!s || s.status === 'completed') return;
  // Only one timer at a time: pause (and persist) any other running timer instead of losing its time.
  for (const r of store.rows('study_records')) if (r.timer_running_since && r.session_id !== sessionId) pauseTimer(store, r.session_id);
  const rec = recordOf(store, sessionId);
  if (rec?.timer_running_since) return;
  upsertRecord(store, sessionId, { timer_running_since: new Date().toISOString(), study_date: rec?.actual_seconds ? rec.study_date : zonedDate() });
  if (s.status !== 'in_progress') store.put('reading_sessions', { id: sessionId, status: 'in_progress' });
}

export function pauseTimer(store: Store, sessionId: string) {
  const rec = recordOf(store, sessionId);
  if (!rec?.timer_running_since) return;
  const total = liveSeconds(rec);
  upsertRecord(store, sessionId, { timer_running_since: null, timer_accumulated_seconds: total, actual_seconds: total });
}

export interface TopicInput {
  topic_id: string;
  status_after: TopicStatus;
  confidence: number | null;
  minutes: number;
  pages: string;
  notes: string;
}

export interface SaveSessionInput {
  sessionId: string;
  status: Exclude<SessionStatus, 'pending' | 'in_progress'>;
  /** Actual time studied, in seconds. Never inferred from the planned duration. */
  seconds: number;
  pages: string;
  slides: string;
  reflection: string;
  topics: TopicInput[];
}

export function validateSave(i: SaveSessionInput): string | null {
  if (!Number.isFinite(i.seconds) || i.seconds < 0) return 'Study time cannot be negative.';
  if (i.seconds > 24 * 3600) return 'Study time cannot exceed 24 hours.';
  if ((i.status === 'completed' || i.status === 'partial') && i.seconds === 0) {
    return 'Record the time you actually studied before marking the session completed or partial.';
  }
  if (i.status === 'missed' && i.topics.length > 0) return 'A missed session cannot have topics studied. Mark it partial instead.';
  if (i.reflection.length > 2000 || i.pages.length > 500 || i.slides.length > 500) return 'One of the text fields is too long.';
  return null;
}

/** Save the study record, topic logs and session status. Topic progress and session status are independent. */
export function saveSession(store: Store, input: SaveSessionInput): void {
  const err = validateSave(input);
  if (err) throw new Error(err);
  const s = store.get('reading_sessions', input.sessionId);
  if (!s) throw new Error('Session not found');

  const rec = recordOf(store, s.id);
  upsertRecord(store, s.id, {
    actual_seconds: input.seconds,
    timer_accumulated_seconds: input.seconds,
    timer_running_since: null,
    study_date: rec?.study_date ?? zonedDate(),
    pages: input.pages.trim(),
    slides: input.slides.trim(),
    reflection: input.reflection.trim(),
  });

  const keep = new Set(input.topics.map((t) => t.topic_id));
  for (const log of store.rows('session_topic_logs')) {
    if (log.session_id === s.id && !keep.has(log.topic_id)) store.softDelete('session_topic_logs', log.id);
  }
  for (const t of input.topics) {
    const topic = store.get('syllabus_topics', t.topic_id);
    if (!topic) continue;
    store.put('session_topic_logs', {
      id: detId(store.userId, `log:${s.id}:${t.topic_id}`),
      session_id: s.id,
      topic_id: t.topic_id,
      topic_title: topic.title,
      course_id: topic.course_id,
      status_after: t.status_after,
      confidence: t.confidence,
      minutes: Math.max(0, Math.round(t.minutes)),
      pages: t.pages.trim(),
      notes: t.notes.trim(),
      deleted_at: null,
    } as Partial<TopicLog> & { id: string });
    if (topic.status !== t.status_after) store.put('syllabus_topics', { id: topic.id, status: t.status_after });
  }

  store.put('reading_sessions', { id: s.id, status: input.status });
  maybeAutoClose(store, s.cycle_day_id);
}

export function reopenSession(store: Store, sessionId: string) {
  const rec = recordOf(store, sessionId);
  store.put('reading_sessions', { id: sessionId, status: (rec?.actual_seconds ?? 0) > 0 ? 'partial' : 'pending' });
}

// ------------------------------------------------------------------ syllabus management

export function topicsOfCourse(store: Store, courseId: string): Topic[] {
  return store.rows('syllabus_topics').filter((t) => t.course_id === courseId);
}

export function addTopic(store: Store, courseId: string, title: string, parentId: string | null): Topic {
  const t = title.trim();
  if (!t) throw new Error('Topic title is required');
  if (t.length > 500) throw new Error('Topic title is too long');
  const siblings = topicsOfCourse(store, courseId).filter((x) => (x.parent_id ?? null) === parentId);
  return store.put('syllabus_topics', {
    course_id: courseId, parent_id: parentId, title: t, is_official: false, status: 'not_started',
    notes: '', page_ref: '', position: siblings.length,
  });
}

export function moveTopic(store: Store, topic: Topic, dir: -1 | 1) {
  const sibs = topicsOfCourse(store, topic.course_id)
    .filter((x) => (x.parent_id ?? null) === (topic.parent_id ?? null))
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const i = sibs.findIndex((x) => x.id === topic.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return;
  const order = sibs.map((x) => x.id);
  [order[i], order[j]] = [order[j], order[i]];
  order.forEach((id, pos) => {
    const cur = store.get('syllabus_topics', id)!;
    if (cur.position !== pos) store.put('syllabus_topics', { id, position: pos });
  });
}

/** Soft-delete a topic and its subtopics. Session logs keep their own copy of the title, so history survives. */
export function deleteTopic(store: Store, topic: Topic) {
  const all = topicsOfCourse(store, topic.course_id);
  const doomed: string[] = [];
  const walk = (id: string) => {
    doomed.push(id);
    all.filter((t) => t.parent_id === id).forEach((t) => walk(t.id));
  };
  walk(topic.id);
  doomed.forEach((id) => store.softDelete('syllabus_topics', id));
}

/** Import pasted outline text as OFFICIAL topics, exactly as written. */
export function importOutline(store: Store, courseId: string, text: string, keepNumbering: boolean): number {
  const parsed = parseOutline(text, keepNumbering).filter((p) => p.title);
  const stack: Array<string | null> = [];
  const counters = new Map<string | null, number>();
  const existing = topicsOfCourse(store, courseId);
  for (const t of existing) counters.set(t.parent_id ?? null, Math.max(counters.get(t.parent_id ?? null) ?? 0, t.position + 1));
  for (const p of parsed) {
    stack.length = p.depth;
    const parent = p.depth === 0 ? null : stack[p.depth - 1] ?? null;
    const pos = counters.get(parent) ?? 0;
    counters.set(parent, pos + 1);
    const row = store.put('syllabus_topics', {
      course_id: courseId, parent_id: parent, title: p.title.slice(0, 500), is_official: true,
      status: 'not_started', notes: '', page_ref: '', position: pos,
    });
    stack[p.depth] = row.id;
  }
  return parsed.length;
}
