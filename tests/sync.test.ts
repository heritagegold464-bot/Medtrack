import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDB } from '../src/lib/db';
import { NetworkError, Store, type PushResult, type Remote } from '../src/lib/store';
import type { AnyRow, TableName } from '../src/lib/types';
import { TABLES } from '../src/lib/types';
import { seedIfEmpty, syncOfficialOutline } from '../src/lib/seed';
import { closeDay, ensureCurrentDay, pauseTimer, recordOf, saveSession, sessionsOfDay, startTimer } from '../src/lib/actions';
import { currentDayRef } from '../src/lib/engine';
import type { ReadingSession } from '../src/lib/types';

/** In-memory stand-in for Supabase with the same semantics: server-owned version, version-gated updates, no deletes. */
class FakeServer implements Remote {
  tables = new Map<TableName, Map<string, AnyRow>>();
  online = true;
  clock = 1000;
  constructor() { for (const t of TABLES) this.tables.set(t, new Map()); }
  private guard() { if (!this.online) throw new NetworkError('offline'); }
  private stamp() { return new Date(1_700_000_000_000 + ++this.clock * 1000).toISOString(); }
  async insert(table: TableName, row: AnyRow): Promise<PushResult> {
    this.guard();
    const m = this.tables.get(table)!;
    if (m.has(row.id)) return { ok: false, reason: 'duplicate' };
    const stored = { ...row, version: 1, updated_at: this.stamp() } as AnyRow;
    m.set(row.id, stored);
    return { ok: true, row: structuredClone(stored) };
  }
  async update(table: TableName, id: string, base: number, row: AnyRow): Promise<PushResult> {
    this.guard();
    const cur = this.tables.get(table)!.get(id);
    if (!cur) return { ok: false, reason: 'missing' };
    if (cur.version !== base) return { ok: false, reason: 'conflict' };
    const stored = { ...row, version: cur.version + 1, updated_at: this.stamp(), created_at: cur.created_at } as AnyRow;
    this.tables.get(table)!.set(id, stored);
    return { ok: true, row: structuredClone(stored) };
  }
  async fetchOne(table: TableName, id: string) { this.guard(); const r = this.tables.get(table)!.get(id); return r ? structuredClone(r) : null; }
  async fetchSince(table: TableName, since: string | null) {
    this.guard();
    return [...this.tables.get(table)!.values()].filter((r) => !since || r.updated_at >= since).map((r) => structuredClone(r));
  }
}

let n = 0;
async function device(server: FakeServer, user = 'u1') {
  const db = await LocalDB.open(`test-${++n}`);
  const s = new Store(user, db, server, `dev-${n}`);
  await s.load();
  return s;
}

describe('sync', () => {
  let server: FakeServer;
  beforeEach(() => { server = new FakeServer(); });

  it('honest initial state: seeded, Day 1 open, nothing completed (spec §15)', async () => {
    const a = await device(server);
    seedIfEmpty(a, 'Student');
    const day = ensureCurrentDay(a)!;
    expect(day.cycle_number).toBe(1);
    expect(day.day_number).toBe(1);
    expect(a.rows('courses')).toHaveLength(11);
    expect(a.rows('cycle_templates')).toHaveLength(11);
    expect(a.rows('reading_sessions').every((s) => s.status === 'pending')).toBe(true);
    expect(a.rows('syllabus_topics').every((t) => t.status === 'not_started')).toBe(true);
  });

  it('seeds the official outline: 130 official topics, all not started, no duplicates on re-run or second device', async () => {
    const a = await device(server);
    seedIfEmpty(a, 'S');
    expect(a.rows('syllabus_topics')).toHaveLength(130);
    expect(a.rows('syllabus_topics').every((t) => t.is_official && t.status === 'not_started')).toBe(true);
    expect(syncOfficialOutline(a)).toBe(0);
    ensureCurrentDay(a); await a.sync();
    const b = await device(server); await b.sync();
    expect(syncOfficialOutline(b)).toBe(0);
    expect(b.rows('syllabus_topics')).toHaveLength(130);
    // a topic the user deleted is not resurrected
    const t = a.rows('syllabus_topics')[0]; a.softDelete('syllabus_topics', t.id);
    expect(syncOfficialOutline(a)).toBe(0);
    expect(a.rows('syllabus_topics')).toHaveLength(129);
  });

  it('syncs to a second device (acceptance 2) without duplicating seeds', async () => {
    const a = await device(server);
    seedIfEmpty(a, 'Student');
    ensureCurrentDay(a);
    await a.sync();
    expect(a.pendingCount()).toBe(0);

    const b = await device(server);
    await b.sync();
    expect(b.rows('courses')).toHaveLength(11);
    expect(seedIfEmpty(b, 'Student')).toBe(false); // already has data -> no re-seed
    expect(b.rows('cycle_days')).toHaveLength(1);
  });

  it('two devices seeding independently merge instead of duplicating', async () => {
    const a = await device(server);
    const b = await device(server);
    seedIfEmpty(a, 'S'); ensureCurrentDay(a);
    seedIfEmpty(b, 'S'); ensureCurrentDay(b);
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.rows('courses')).toHaveLength(11);
    expect(b.rows('courses')).toHaveLength(11);
    expect(b.rows('cycle_days')).toHaveLength(1);
    expect(b.rows('reading_sessions')).toHaveLength(2);
    expect(a.unresolvedConflicts()).toHaveLength(0);
    expect(b.unresolvedConflicts()).toHaveLength(0);
    expect(server.tables.get('courses')!.size).toBe(11);
  });

  it('offline records are kept and sync after reconnection (acceptance 12)', async () => {
    const a = await device(server);
    seedIfEmpty(a, 'S'); ensureCurrentDay(a);
    await a.sync();

    server.online = false;
    const day = ensureCurrentDay(a)!;
    const [primary] = sessionsOfDay(a, day.id);
    saveSession(a, { sessionId: primary.id, status: 'partial', seconds: 6000, pages: '1-20', slides: '', reflection: 'ok', topics: [] });
    await a.sync();
    expect(a.status.state).toBe('offline');
    expect(a.pendingCount()).toBeGreaterThan(0);
    expect((server.tables.get('reading_sessions')!.get(primary.id) as ReadingSession).status).toBe('pending');

    server.online = true;
    await a.sync();
    expect(a.pendingCount()).toBe(0);
    expect((server.tables.get('reading_sessions')!.get(primary.id) as ReadingSession).status).toBe('partial');
    expect((server.tables.get('study_records')!.values().next().value as { actual_seconds: number }).actual_seconds).toBe(6000);
  });

  it('pending changes survive an app restart (IndexedDB)', async () => {
    const db = await LocalDB.open('restart-db');
    const a = new Store('u1', db, server, 'd');
    await a.load();
    seedIfEmpty(a, 'S'); ensureCurrentDay(a);
    await new Promise((r) => setTimeout(r, 50)); // let persistence flush
    const again = new Store('u1', db, server, 'd');
    await again.load();
    expect(again.rows('courses')).toHaveLength(11);
    expect(again.pendingCount()).toBe(a.pendingCount());
    await again.sync();
    expect(server.tables.get('courses')!.size).toBe(11);
  });

  it('conflicting edits are detected, not silently overwritten (acceptance 13)', async () => {
    const a = await device(server);
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    await a.sync();
    const b = await device(server);
    await b.sync();
    const sid = sessionsOfDay(a, day.id)[0].id;

    // Both devices record the SAME session differently, offline from each other.
    saveSession(a, { sessionId: sid, status: 'completed', seconds: 10800, pages: '', slides: '', reflection: 'A', topics: [] });
    saveSession(b, { sessionId: sid, status: 'partial', seconds: 3600, pages: '', slides: '', reflection: 'B', topics: [] });
    await a.sync();
    await b.sync();

    // A won the race and is on the server; B's different record is held for review, not applied.
    expect((server.tables.get('reading_sessions')!.get(sid) as ReadingSession).status).toBe('completed');
    const conflicts = b.unresolvedConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.table === 'reading_sessions' && (c.local as { status: string }).status === 'partial')).toBe(true);
    expect(b.get('reading_sessions', sid)!.status).toBe('partial'); // local copy preserved

    // Resolve: keep the other device's completed record.
    for (const c of b.unresolvedConflicts()) await b.resolveConflict(c.key, 'theirs');
    await b.sync();
    expect(b.get('reading_sessions', sid)!.status).toBe('completed');
    expect(b.unresolvedConflicts()).toHaveLength(0);
    expect(b.conflicts().every((c) => c.resolution === 'theirs')).toBe(true); // history retained
  });

  it("'keep mine' rebases and overwrites only after an explicit decision", async () => {
    const a = await device(server);
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    await a.sync();
    const b = await device(server); await b.sync();
    const sid = sessionsOfDay(a, day.id)[0].id;
    a.put('reading_sessions', { id: sid, status: 'missed' });
    b.put('reading_sessions', { id: sid, status: 'partial' });
    await a.sync(); await b.sync();
    const c = b.unresolvedConflicts().find((x) => x.table === 'reading_sessions')!;
    await b.resolveConflict(c.key, 'mine');
    await b.sync();
    expect((server.tables.get('reading_sessions')!.get(sid) as ReadingSession).status).toBe('partial');
    expect(b.pendingCount()).toBe(0);
  });

  it('an edit made while a push is in flight is not lost', async () => {
    const a = await device(server);
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    await a.sync();
    const sid = sessionsOfDay(a, day.id)[0].id;
    a.put('reading_sessions', { id: sid, status: 'in_progress' });
    const orig = server.update.bind(server);
    let injected = false;
    server.update = async (...args) => {
      const r = await orig(...args);
      if (!injected && args[0] === 'reading_sessions') { injected = true; a.put('reading_sessions', { id: sid, status: 'partial' }, { noSync: true }); }
      return r;
    };
    await a.sync();
    expect(a.get('reading_sessions', sid)!.status).toBe('partial');
    expect((server.tables.get('reading_sessions')!.get(sid) as ReadingSession).status).toBe('partial');
  });
});

describe('actions end-to-end', () => {
  it('primary completion leaves secondary pending; day advances only on close or both complete', async () => {
    const server = new FakeServer();
    const a = await device(server);
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    const [p, s] = sessionsOfDay(a, day.id);
    saveSession(a, { sessionId: p.id, status: 'completed', seconds: 10800, pages: '', slides: '', reflection: '', topics: [] });
    expect(a.get('reading_sessions', s.id)!.status).toBe('pending');
    expect(a.get('cycle_days', day.id)!.status).toBe('open');
    expect(ensureCurrentDay(a)!.id).toBe(day.id); // does not advance past the unfinished session

    closeDay(a, day.id, 'ran out of time');
    expect(a.get('reading_sessions', s.id)!.status).toBe('missed');
    expect(a.get('reading_sessions', p.id)!.status).toBe('completed');
    const closed = a.get('cycle_days', day.id)!;
    expect(closed.status).toBe('closed');
    expect(closed.close_reason).toBe('reviewed');
    const next = currentDayRef(a.rows('cycle_days'), 11);
    expect(next.kind).toBe('open');
    expect(next.kind === 'open' && next.day.day_number).toBe(2);
  });

  it('completing both sessions auto-closes and opens the next day', async () => {
    const a = await device(new FakeServer());
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    const [p, s] = sessionsOfDay(a, day.id);
    saveSession(a, { sessionId: p.id, status: 'completed', seconds: 10800, pages: '', slides: '', reflection: '', topics: [] });
    saveSession(a, { sessionId: s.id, status: 'completed', seconds: 7200, pages: '', slides: '', reflection: '', topics: [] });
    expect(a.get('cycle_days', day.id)!.close_reason).toBe('completed');
    expect(a.rows('cycle_days').filter((d) => d.status === 'open').map((d) => d.day_number)).toEqual([2]);
  });

  it('rejects "completed" with zero recorded time; partial keeps exact time', async () => {
    const a = await device(new FakeServer());
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    const [p] = sessionsOfDay(a, day.id);
    expect(() => saveSession(a, { sessionId: p.id, status: 'completed', seconds: 0, pages: '', slides: '', reflection: '', topics: [] })).toThrow();
    saveSession(a, { sessionId: p.id, status: 'partial', seconds: 6000, pages: '', slides: '', reflection: '', topics: [] });
    expect(recordOf(a, p.id)!.actual_seconds).toBe(6000);
    expect(a.get('reading_sessions', p.id)!.planned_minutes).toBe(180);
  });

  it('topic logs update topic progress; deleting a topic keeps the log and its title', async () => {
    const a = await device(new FakeServer());
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    const [p] = sessionsOfDay(a, day.id);
    const t1 = a.put('syllabus_topics', { course_id: p.course_id, parent_id: null, title: 'Brachial plexus', is_official: true, status: 'not_started', notes: '', page_ref: '', position: 0 });
    a.put('syllabus_topics', { course_id: p.course_id, parent_id: null, title: 'Axilla', is_official: true, status: 'not_started', notes: '', page_ref: '', position: 1 });
    saveSession(a, {
      sessionId: p.id, status: 'partial', seconds: 3600, pages: '', slides: '', reflection: '',
      topics: [{ topic_id: t1.id, status_after: 'completed', confidence: 4, minutes: 40, pages: '3-9', notes: '' }],
    });
    expect(a.get('syllabus_topics', t1.id)!.status).toBe('completed');
    a.softDelete('syllabus_topics', t1.id);
    const log = a.rows('session_topic_logs')[0];
    expect(log.topic_title).toBe('Brachial plexus');
    expect(a.rows('syllabus_topics').some((t) => t.id === t1.id)).toBe(false);
  });

  it('timer records actual elapsed time, pausing preserves it', async () => {
    const a = await device(new FakeServer());
    seedIfEmpty(a, 'S'); const day = ensureCurrentDay(a)!;
    const [p, s] = sessionsOfDay(a, day.id);
    startTimer(a, p.id);
    expect(a.get('reading_sessions', p.id)!.status).toBe('in_progress');
    // pretend 100 minutes elapsed
    a.put('study_records', { id: recordOf(a, p.id)!.id, timer_running_since: new Date(Date.now() - 6000 * 1000).toISOString() });
    startTimer(a, s.id); // auto-pauses the other timer, keeping its time
    expect(recordOf(a, p.id)!.actual_seconds).toBeGreaterThanOrEqual(6000);
    expect(recordOf(a, p.id)!.timer_running_since).toBeNull();
    pauseTimer(a, s.id);
  });
});
