/**
 * MEDTRACK engine — pure functions, no storage, no UI.
 *
 * Three independent dimensions are computed separately and never merged into one score:
 *   1. Study activity   (study_records.actual_seconds, planned vs actual)
 *   2. Session outcomes (completed / partial / missed)
 *   3. Syllabus coverage (topic completion — NEVER derived from time or sessions)
 */
import type {
  Course, CycleDay, CycleTemplate, Profile, ReadingSession, SessionStatus, StudyRecord, Topic, TopicStatus,
} from './types';
import { addDays, daysBetween } from './time';
import { detId } from './ids';

// ------------------------------------------------------------------ syllabus coverage

export interface CourseProgress {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  /** 0–100, exact (not rounded). 0 when the course has no tracked topics. */
  pct: number;
}

export function childrenMap(topics: Topic[]): Map<string | null, Topic[]> {
  const m = new Map<string | null, Topic[]>();
  const ids = new Set(topics.map((t) => t.id));
  for (const t of topics) {
    // A topic whose parent is missing/deleted is treated as top-level so it is never lost.
    const key = t.parent_id && ids.has(t.parent_id) ? t.parent_id : null;
    const arr = m.get(key) ?? [];
    arr.push(t);
    m.set(key, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  return m;
}

/** Status of a topic, derived from its subtopics when it has any (leaf status otherwise). */
export function effectiveStatus(topic: Topic, kids: Map<string | null, Topic[]>): TopicStatus {
  const sub = kids.get(topic.id);
  if (!sub || sub.length === 0) return topic.status;
  const statuses = sub.map((s) => effectiveStatus(s, kids));
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.every((s) => s === 'not_started')) return 'not_started';
  return 'in_progress';
}

/**
 * Tracked units = LEAF topics only. A parent with subtopics is not counted as a separate unit, so a
 * parent and its children are never double-counted.
 */
export function leafTopics(topics: Topic[]): Topic[] {
  const kids = childrenMap(topics);
  return topics.filter((t) => !(kids.get(t.id)?.length));
}

export function courseProgress(courseTopics: Topic[]): CourseProgress {
  const leaves = leafTopics(courseTopics);
  const completed = leaves.filter((t) => t.status === 'completed').length;
  const inProgress = leaves.filter((t) => t.status === 'in_progress').length;
  const total = leaves.length;
  return {
    total,
    completed,
    inProgress,
    notStarted: total - completed - inProgress,
    pct: total === 0 ? 0 : (completed / total) * 100,
  };
}

export function semesterProgress(courses: Course[], topics: Topic[]): CourseProgress {
  const included = new Set(courses.filter((c) => c.included).map((c) => c.id));
  const sum: CourseProgress = { total: 0, completed: 0, inProgress: 0, notStarted: 0, pct: 0 };
  for (const c of courses) {
    if (!included.has(c.id)) continue;
    const p = courseProgress(topics.filter((t) => t.course_id === c.id));
    sum.total += p.total;
    sum.completed += p.completed;
    sum.inProgress += p.inProgress;
    sum.notStarted += p.notStarted;
  }
  sum.pct = sum.total === 0 ? 0 : (sum.completed / sum.total) * 100;
  return sum;
}

// ------------------------------------------------------------------ cycle progression

export type DayRef =
  | { kind: 'open'; day: CycleDay }
  | { kind: 'next'; cycle_number: number; day_number: number };

export const dayKey = (d: { cycle_number: number; day_number: number }) => d.cycle_number * 1000 + d.day_number;

/**
 * The current day is determined by the LAST PROPERLY CLOSED DAY — never by the calendar.
 * If a day is open it is the current day (resume). Otherwise the day after the last closed day.
 */
export function currentDayRef(days: CycleDay[], cycleLength: number): DayRef {
  const open = days.filter((d) => d.status === 'open').sort((a, b) => dayKey(a) - dayKey(b))[0];
  if (open) return { kind: 'open', day: open };
  const closed = days.filter((d) => d.status === 'closed').sort((a, b) => dayKey(b) - dayKey(a))[0];
  if (!closed) return { kind: 'next', cycle_number: 1, day_number: 1 };
  if (closed.day_number >= cycleLength) return { kind: 'next', cycle_number: closed.cycle_number + 1, day_number: 1 };
  return { kind: 'next', cycle_number: closed.cycle_number, day_number: closed.day_number + 1 };
}

/** Build the day + its two sessions from the (editable) template and schedule. Deterministic ids. */
export function buildDay(
  userId: string,
  cycle_number: number,
  day_number: number,
  templates: CycleTemplate[],
  profile: Pick<Profile, 'primary_time' | 'primary_minutes' | 'secondary_time' | 'secondary_minutes'>,
  today: string,
  nowIso: string,
): { day: CycleDay; sessions: ReadingSession[] } {
  const tpl = templates.find((t) => t.day_number === day_number);
  if (!tpl) throw new Error(`No timetable entry for cycle day ${day_number}`);
  const dayId = detId(userId, `cycle_day:${cycle_number}:${day_number}`);
  const base = { user_id: userId, version: 0, created_at: nowIso, updated_at: nowIso, client_updated_at: nowIso, deleted_at: null };
  const day: CycleDay = {
    ...base, id: dayId, cycle_number, day_number, opened_on: today, status: 'open',
    close_reason: null, closed_at: null, review_note: '',
  };
  const mk = (slot: 'primary' | 'secondary'): ReadingSession => ({
    ...base,
    id: detId(userId, `session:${dayId}:${slot}`),
    cycle_day_id: dayId,
    slot,
    course_id: slot === 'primary' ? tpl.primary_course_id : tpl.secondary_course_id,
    planned_start: slot === 'primary' ? profile.primary_time : profile.secondary_time,
    planned_minutes: slot === 'primary' ? profile.primary_minutes : profile.secondary_minutes,
    status: 'pending',
  });
  return { day, sessions: [mk('primary'), mk('secondary')] };
}

/** Both sessions completed → the day may close by itself. Anything else needs explicit review. */
export function canAutoClose(sessions: ReadingSession[]): boolean {
  const p = sessions.find((s) => s.slot === 'primary');
  const s = sessions.find((s) => s.slot === 'secondary');
  return !!p && !!s && p.status === 'completed' && s.status === 'completed';
}

/**
 * What an explicit "close day" does to each session. Nothing is hidden or upgraded:
 *   pending     → missed   (never started)
 *   in_progress → partial if any time was recorded, else missed
 *   completed / partial / missed → unchanged
 */
export function statusOnClose(status: SessionStatus, actualSeconds: number): SessionStatus {
  if (status === 'pending') return 'missed';
  if (status === 'in_progress') return actualSeconds > 0 ? 'partial' : 'missed';
  return status;
}

export type DayOutcome = 'open' | 'complete' | 'incomplete';
/** A closed day containing any partial or missed session is NEVER shown as fully successful. */
export function dayOutcome(day: CycleDay, sessions: ReadingSession[]): DayOutcome {
  if (day.status === 'open') return 'open';
  return sessions.length > 0 && sessions.every((s) => s.status === 'completed') ? 'complete' : 'incomplete';
}

// ------------------------------------------------------------------ session / study metrics

export interface SessionCounts {
  completed: number;
  partial: number;
  missed: number;
  pending: number;
  inProgress: number;
  total: number;
  /** completed + partial + missed */
  accounted: number;
}

export function sessionCounts(sessions: ReadingSession[]): SessionCounts {
  const c = { completed: 0, partial: 0, missed: 0, pending: 0, inProgress: 0 };
  for (const s of sessions) {
    if (s.status === 'completed') c.completed++;
    else if (s.status === 'partial') c.partial++;
    else if (s.status === 'missed') c.missed++;
    else if (s.status === 'in_progress') c.inProgress++;
    else c.pending++;
  }
  return { ...c, total: sessions.length, accounted: c.completed + c.partial + c.missed };
}

/** Completed sessions / accounted-for planned sessions. null when nothing is accounted for yet. */
export function sessionCompletionRate(sessions: ReadingSession[]): number | null {
  const c = sessionCounts(sessions);
  return c.accounted === 0 ? null : (c.completed / c.accounted) * 100;
}

export const actualSeconds = (records: StudyRecord[]) => records.reduce((a, r) => a + r.actual_seconds, 0);
export const plannedSeconds = (sessions: ReadingSession[]) => sessions.reduce((a, s) => a + s.planned_minutes * 60, 0);

export function secondsByDay(records: StudyRecord[], from: string, to: string): Array<{ date: string; seconds: number }> {
  const m = new Map<string, number>();
  for (const r of records) m.set(r.study_date, (m.get(r.study_date) ?? 0) + r.actual_seconds);
  const out: Array<{ date: string; seconds: number }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, seconds: m.get(d) ?? 0 });
  return out;
}

export function secondsByCourse(records: StudyRecord[], sessions: ReadingSession[], courses: Course[]) {
  const sessCourse = new Map(sessions.map((s) => [s.id, s.course_id]));
  const m = new Map<string, number>();
  for (const r of records) {
    const cid = sessCourse.get(r.session_id);
    if (cid) m.set(cid, (m.get(cid) ?? 0) + r.actual_seconds);
  }
  return courses.map((c) => ({ course: c, seconds: m.get(c.id) ?? 0 }));
}

/** Reading days with recorded study activity / days in the selected period (inclusive). */
export function consistency(records: StudyRecord[], from: string, to: string): { active: number; days: number; pct: number } {
  const days = Math.max(0, daysBetween(from, to) + 1);
  const active = new Set(records.filter((r) => r.actual_seconds > 0 && r.study_date >= from && r.study_date <= to).map((r) => r.study_date)).size;
  return { active, days, pct: days === 0 ? 0 : (active / days) * 100 };
}

/** Last `weeks` weeks (Mon–Sun), oldest first. The current week is partial: days counts only elapsed days. */
export function weeklyConsistency(records: StudyRecord[], today: string, weeks: number) {
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(today, -dow);
  const out: Array<{ weekStart: string; active: number; days: number; pct: number }> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(thisMonday, -7 * w);
    const end = addDays(start, 6) > today ? today : addDays(start, 6);
    out.push({ weekStart: start, ...consistency(records, start, end) });
  }
  return out;
}

export interface CycleSummary {
  cycle_number: number;
  daysClosed: number;
  totalDays: number;
  counts: SessionCounts;
  /** accounted-for sessions / planned sessions in a full cycle */
  accountedPct: number;
  finished: boolean;
}

export function cycleSummaries(days: CycleDay[], sessions: ReadingSession[], cycleLength: number): CycleSummary[] {
  const byCycle = new Map<number, CycleDay[]>();
  for (const d of days) byCycle.set(d.cycle_number, [...(byCycle.get(d.cycle_number) ?? []), d]);
  return [...byCycle.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cycle_number, ds]) => {
      const ids = new Set(ds.map((d) => d.id));
      const ss = sessions.filter((s) => ids.has(s.cycle_day_id));
      const counts = sessionCounts(ss);
      const daysClosed = ds.filter((d) => d.status === 'closed').length;
      return {
        cycle_number, daysClosed, totalDays: cycleLength, counts,
        accountedPct: cycleLength === 0 ? 0 : (counts.accounted / (cycleLength * 2)) * 100,
        finished: daysClosed >= cycleLength,
      };
    });
}

export const completedCycles = (days: CycleDay[], cycleLength: number) =>
  cycleSummaries(days, [], cycleLength).filter((c) => c.finished).length;

// ------------------------------------------------------------------ outline parsing

/**
 * Parse pasted outline text into a topic tree. Hierarchy comes from indentation (2+ spaces or a tab
 * per level) or from numbering depth ("1.", "1.1", "1.1.1"). Titles are preserved as written
 * (leading bullets/numbers are the only thing trimmed from display when `keepNumbering` is false).
 */
export interface ParsedTopic { title: string; depth: number }
export function parseOutline(text: string, keepNumbering = true): ParsedTopic[] {
  const out: ParsedTopic[] = [];
  const indents: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const expanded = raw.replace(/\t/g, '    ');
    const lead = expanded.match(/^ */)![0].length;
    let body = expanded.trim();
    const bullet = body.match(/^([-*•–]\s+)/);
    if (bullet) body = body.slice(bullet[1].length);
    const num = body.match(/^(\d+(?:\.\d+)*)[.)]?\s+/);
    let depth: number;
    if (lead === 0 && num && num[1].includes('.')) {
      depth = num[1].split('.').length - 1;
    } else {
      while (indents.length && lead < indents[indents.length - 1]) indents.pop();
      if (!indents.length || lead > indents[indents.length - 1]) indents.push(lead);
      depth = indents.length - 1;
    }
    if (!keepNumbering && num) body = body.slice(num[0].length);
    out.push({ title: body.trim(), depth: Math.min(depth, (out[out.length - 1]?.depth ?? -1) + 1) });
  }
  return out;
}
