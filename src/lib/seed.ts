import type { Store } from './store';
import type { Course, CycleTemplate, NotificationPrefs, Profile, Topic } from './types';
import { DEFAULT_SCHEDULE, SEED_COURSES, SEED_TIMETABLE } from '../data/defaults';
import { OFFICIAL_OUTLINE, type OutlineTopic } from '../data/courseOutline';
import { detId } from './ids';
import { TZ } from './time';

/**
 * Seed a brand-new account. Idempotent and multi-device safe: ids are deterministic, so two devices
 * seeding at once produce identical records that merge instead of duplicating.
 * Honest start: no sessions completed, no topics completed, cycle Day 1 not started.
 */
export function seedIfEmpty(store: Store, displayName: string) {
  if (store.rows('courses').length > 0 || store.get('profiles', store.userId)) return false;
  const u = store.userId;

  store.put('profiles', {
    id: u, display_name: displayName, timezone: TZ, ...DEFAULT_SCHEDULE,
  } as Partial<Profile> & { id: string });

  store.put('notification_preferences', {
    id: detId(u, 'notification_preferences'),
    primary_reminder: true, secondary_reminder: true, accountability_reminder: true,
    overdue_reminder: true, overdue_after_minutes: 30, incomplete_reminder: true, unrecorded_reminder: false,
  } as Partial<NotificationPrefs> & { id: string });

  const courseId = new Map<string, string>();
  SEED_COURSES.forEach((c, i) => {
    const id = detId(u, `course:${c.code}`);
    courseId.set(c.code, id);
    store.put('courses', { id, ...c, position: i, included: true } as Partial<Course> & { id: string });
  });

  SEED_TIMETABLE.forEach(([p, s], i) => {
    store.put('cycle_templates', {
      id: detId(u, `template:${i + 1}`), day_number: i + 1,
      primary_course_id: courseId.get(p)!, secondary_course_id: courseId.get(s)!,
    } as Partial<CycleTemplate> & { id: string });
  });

  const addTopics = (code: string, topics: OutlineTopic[], parent: string | null, path: string) => {
    topics.forEach((t, i) => {
      const id = detId(u, `topic:${code}:${path}${i}`);
      store.put('syllabus_topics', {
        id, course_id: courseId.get(code)!, parent_id: parent, title: t.title, is_official: true,
        status: 'not_started', notes: '', page_ref: '', position: i,
      } as Partial<Topic> & { id: string });
      if (t.children?.length) addTopics(code, t.children, id, `${path}${i}.`);
    });
  };
  for (const [code, topics] of Object.entries(OFFICIAL_OUTLINE)) addTopics(code, topics, null, '');
  return true;
}

/**
 * Add any official outline topic this account does not have yet. Ids are deterministic, so this is
 * idempotent across devices, and a topic the user deleted (soft-deleted, still present) is NOT re-added.
 */
export function syncOfficialOutline(store: Store): number {
  const u = store.userId;
  let added = 0;
  const existing = new Set(store.allRows('syllabus_topics').map((t) => t.id));
  for (const course of store.rows('courses')) {
    const outline = OFFICIAL_OUTLINE[course.code];
    if (!outline?.length) continue;
    const walk = (topics: OutlineTopic[], parent: string | null, path: string) =>
      topics.forEach((t, i) => {
        const id = detId(u, `topic:${course.code}:${path}${i}`);
        if (!existing.has(id)) {
          store.put('syllabus_topics', {
            id, course_id: course.id, parent_id: parent, title: t.title, is_official: true,
            status: 'not_started', notes: '', page_ref: '', position: i,
          } as Partial<Topic> & { id: string });
          added++;
        }
        if (t.children?.length) walk(t.children, id, `${path}${i}.`);
      });
    walk(outline, null, '');
  }
  return added;
}
