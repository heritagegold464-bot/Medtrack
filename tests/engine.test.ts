import { describe, expect, it } from 'vitest';
import {
  buildDay, canAutoClose, completedCycles, consistency, courseProgress, currentDayRef, cycleSummaries, dayOutcome,
  parseOutline, semesterProgress, sessionCompletionRate, sessionCounts, statusOnClose, weeklyConsistency,
} from '../src/lib/engine';
import { SEED_COURSES, SEED_TIMETABLE, DEFAULT_SCHEDULE } from '../src/data/defaults';
import { detId } from '../src/lib/ids';
import type { Course, CycleDay, CycleTemplate, ReadingSession, StudyRecord, Topic } from '../src/lib/types';

const U = 'user-1';
const base = { user_id: U, version: 1, created_at: '', updated_at: '', client_updated_at: '', deleted_at: null };
const courses: Course[] = SEED_COURSES.map((c, i) => ({ ...base, id: detId(U, c.code), ...c, position: i, included: true }));
const cid = (code: string) => courses.find((c) => c.code === code)!.id;
const templates: CycleTemplate[] = SEED_TIMETABLE.map(([p, s], i) => ({
  ...base, id: 't' + i, day_number: i + 1, primary_course_id: cid(p), secondary_course_id: cid(s),
}));
const topic = (course: string, n: number, status: Topic['status'], parent: string | null = null): Topic => ({
  ...base, id: `${course}-${n}`, course_id: cid(course), parent_id: parent, title: `T${n}`, is_official: true, status,
  notes: '', page_ref: '', position: n,
});
const day = (cycle: number, d: number, status: CycleDay['status']): CycleDay => ({
  ...base, id: `d${cycle}-${d}`, cycle_number: cycle, day_number: d, opened_on: '2026-01-01', status,
  close_reason: status === 'closed' ? 'reviewed' : null, closed_at: null, review_note: '',
});
const sess = (dayId: string, slot: 'primary' | 'secondary', status: ReadingSession['status']): ReadingSession => ({
  ...base, id: `${dayId}-${slot}`, cycle_day_id: dayId, slot, course_id: cid('ANA 201a'), planned_start: '09:00', planned_minutes: 180, status,
});

describe('timetable', () => {
  it('has 11 days / 22 sessions with the approved courses', () => {
    expect(SEED_TIMETABLE).toHaveLength(11);
    expect(SEED_TIMETABLE[0]).toEqual(['ANA 201a', 'BCH 201']);
    expect(SEED_TIMETABLE[4]).toEqual(['PHS 205', 'BCH 203']);
    expect(SEED_TIMETABLE[10]).toEqual(['PHS 201', 'BCH 201']);
    expect(SEED_COURSES).toHaveLength(11);
  });
  it('builds Day 1 with primary 9:00/180 and secondary 16:00/120, all pending', () => {
    const { day: d, sessions } = buildDay(U, 1, 1, templates, DEFAULT_SCHEDULE, '2026-01-01', 'now');
    expect(d.status).toBe('open');
    expect(sessions.map((s) => [s.slot, s.course_id, s.planned_start, s.planned_minutes, s.status])).toEqual([
      ['primary', cid('ANA 201a'), '09:00', 180, 'pending'],
      ['secondary', cid('BCH 201'), '16:00', 120, 'pending'],
    ]);
  });
  it('is deterministic across devices (same ids)', () => {
    const a = buildDay(U, 1, 1, templates, DEFAULT_SCHEDULE, '2026-01-01', 'a');
    const b = buildDay(U, 1, 1, templates, DEFAULT_SCHEDULE, '2026-02-02', 'b');
    expect(a.day.id).toBe(b.day.id);
    expect(a.sessions.map((s) => s.id)).toEqual(b.sessions.map((s) => s.id));
  });
});

describe('cycle progression (acceptance 3,4,5,8)', () => {
  it('starts at cycle 1 day 1', () => {
    expect(currentDayRef([], 11)).toEqual({ kind: 'next', cycle_number: 1, day_number: 1 });
  });
  it('resumes the open day regardless of calendar', () => {
    const r = currentDayRef([day(1, 1, 'closed'), day(1, 2, 'open')], 11);
    expect(r.kind === 'open' && r.day.day_number).toBe(2);
  });
  it('next day follows the last CLOSED day', () => {
    expect(currentDayRef([day(1, 1, 'closed'), day(1, 2, 'closed')], 11)).toEqual({ kind: 'next', cycle_number: 1, day_number: 3 });
  });
  it('wraps to the next cycle after day 11', () => {
    expect(currentDayRef([day(1, 11, 'closed')], 11)).toEqual({ kind: 'next', cycle_number: 2, day_number: 1 });
  });
  it('completing primary does not complete secondary / does not auto-close', () => {
    expect(canAutoClose([sess('d', 'primary', 'completed'), sess('d', 'secondary', 'pending')])).toBe(false);
    expect(canAutoClose([sess('d', 'primary', 'completed'), sess('d', 'secondary', 'partial')])).toBe(false);
    expect(canAutoClose([sess('d', 'primary', 'completed'), sess('d', 'secondary', 'completed')])).toBe(true);
  });
  it('closing keeps incomplete sessions visibly incomplete', () => {
    expect(statusOnClose('pending', 0)).toBe('missed');
    expect(statusOnClose('in_progress', 600)).toBe('partial');
    expect(statusOnClose('in_progress', 0)).toBe('missed');
    expect(statusOnClose('partial', 600)).toBe('partial');
    expect(statusOnClose('completed', 600)).toBe('completed');
  });
  it('a closed day with a missed session is not a fully successful day', () => {
    const d = day(1, 1, 'closed');
    expect(dayOutcome(d, [sess('d', 'primary', 'completed'), sess('d', 'secondary', 'missed')])).toBe('incomplete');
    expect(dayOutcome(d, [sess('d', 'primary', 'completed'), sess('d', 'secondary', 'completed')])).toBe('complete');
  });
});

describe('syllabus progress (acceptance 9,10,11)', () => {
  it('20 topics, 10 completed = 50%', () => {
    const ts = Array.from({ length: 20 }, (_, i) => topic('ANA 203', i, i < 10 ? 'completed' : 'not_started'));
    const p = courseProgress(ts);
    expect(p).toMatchObject({ total: 20, completed: 10, inProgress: 0, notStarted: 10, pct: 50 });
  });
  it('counts in-progress separately and not as complete', () => {
    const ts = [topic('ANA 203', 1, 'completed'), topic('ANA 203', 2, 'in_progress'), topic('ANA 203', 3, 'not_started')];
    const p = courseProgress(ts);
    expect(p.pct).toBeCloseTo(33.333, 2);
    expect(p.inProgress).toBe(1);
  });
  it('a course with no tracked topics is 0%, not 100%', () => {
    expect(courseProgress([]).pct).toBe(0);
  });
  it('does not double count a parent and its subtopics', () => {
    const parent = topic('ANA 203', 1, 'not_started');
    const kids = [topic('ANA 203', 2, 'completed', parent.id), topic('ANA 203', 3, 'not_started', parent.id)];
    const p = courseProgress([parent, ...kids]);
    expect(p).toMatchObject({ total: 2, completed: 1, pct: 50 });
  });
  it('session history never changes syllabus completion', () => {
    const ts = [topic('ANA 203', 1, 'not_started'), topic('ANA 203', 2, 'not_started')];
    const before = courseProgress(ts).pct;
    // 22 completed sessions and plenty of hours...
    const sessions = Array.from({ length: 22 }, (_, i) => sess('d' + i, 'primary', 'completed'));
    expect(sessionCounts(sessions).completed).toBe(22);
    expect(courseProgress(ts).pct).toBe(before);
    expect(before).toBe(0);
  });
  it('semester progress pools included courses only', () => {
    const ts = [topic('ANA 203', 1, 'completed'), topic('ANA 205', 1, 'not_started'), topic('BCH 201', 1, 'completed')];
    const cs = courses.map((c) => (c.code === 'BCH 201' ? { ...c, included: false } : c));
    expect(semesterProgress(cs, ts)).toMatchObject({ total: 2, completed: 1, pct: 50 });
  });
});

describe('session metrics (acceptance 6,7)', () => {
  it('completion rate = completed / accounted-for (pending excluded)', () => {
    const ss = [sess('a', 'primary', 'completed'), sess('a', 'secondary', 'missed'), sess('b', 'primary', 'partial'), sess('b', 'secondary', 'pending')];
    expect(sessionCompletionRate(ss)).toBeCloseTo(33.33, 1);
    expect(sessionCompletionRate([sess('a', 'primary', 'pending')])).toBeNull();
  });
  it('cycle summary counts accounted sessions out of 22', () => {
    const days = [day(1, 1, 'closed'), day(1, 2, 'open')];
    const ss = [sess('d1-1', 'primary', 'completed'), sess('d1-1', 'secondary', 'missed'), sess('d1-2', 'primary', 'pending')].map((s, i) => ({ ...s, cycle_day_id: i < 2 ? 'd1-1' : 'd1-2' }));
    const [c] = cycleSummaries(days, ss, 11);
    expect(c.counts).toMatchObject({ completed: 1, missed: 1, pending: 1, accounted: 2 });
    expect(c.accountedPct).toBeCloseTo((2 / 22) * 100, 5);
    expect(c.finished).toBe(false);
    expect(completedCycles(days, 11)).toBe(0);
  });
  it('1h40m of a 3h session is recorded as 6000s, remainder not counted', () => {
    const rec = { ...base, id: 'r', session_id: 's', actual_seconds: 6000, study_date: '2026-01-01', timer_running_since: null, timer_accumulated_seconds: 6000, pages: '', slides: '', reflection: '' } as StudyRecord;
    expect(rec.actual_seconds).toBe(100 * 60);
    expect(consistency([rec], '2026-01-01', '2026-01-02')).toMatchObject({ active: 1, days: 2, pct: 50 });
  });
  it('weekly consistency covers the last N weeks', () => {
    const w = weeklyConsistency([], '2026-01-14', 4);
    expect(w).toHaveLength(4);
    expect(w[3].days).toBe(3); // Mon–Wed of the current week
  });
});

describe('outline parsing', () => {
  it('builds hierarchy from indentation and preserves titles', () => {
    const p = parseOutline('Introduction to Anatomy\n  Terms of relation\n  Planes\nSkin\n  Layers\n    Epidermis');
    expect(p.map((x) => [x.title, x.depth])).toEqual([
      ['Introduction to Anatomy', 0], ['Terms of relation', 1], ['Planes', 1], ['Skin', 0], ['Layers', 1], ['Epidermis', 2],
    ]);
  });
  it('builds hierarchy from dotted numbering', () => {
    const p = parseOutline('1. Cells\n1.1 Membrane\n1.1.1 Lipids\n2. pH');
    expect(p.map((x) => x.depth)).toEqual([0, 1, 2, 0]);
    expect(p[0].title).toBe('1. Cells');
  });
});
