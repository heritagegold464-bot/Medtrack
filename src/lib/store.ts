/**
 * Offline-first store.
 *
 *  - Memory is the working copy; every write is mirrored to IndexedDB so nothing is lost on reload.
 *  - Every write also lands in an OUTBOX. The outbox survives restarts and is drained when online.
 *  - Updates are sent with the server version they were based on. If the server row moved on in the
 *    meantime (another device edited it) the update is NOT applied: a conflict is recorded and the user
 *    decides. Nothing is ever silently overwritten, and the server has no DELETE (soft-delete only).
 */
import { LocalDB, type ConflictRecord, type OutboxEntry } from './db';
import { TABLES, type AnyRow, type RowMap, type TableName } from './types';
import { uuid } from './ids';

export class NetworkError extends Error {}

export type PushResult =
  | { ok: true; row: AnyRow }
  | { ok: false; reason: 'duplicate' | 'conflict' | 'missing' | 'error'; message?: string };

export interface Remote {
  /** Throw NetworkError when the network is unreachable. */
  insert(table: TableName, row: AnyRow): Promise<PushResult>;
  update(table: TableName, id: string, baseVersion: number, row: AnyRow): Promise<PushResult>;
  fetchOne(table: TableName, id: string): Promise<AnyRow | null>;
  fetchSince(table: TableName, since: string | null): Promise<AnyRow[]>;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';
  lastSyncAt: string | null;
  error?: string;
}

const META_KEYS = new Set(['version', 'created_at', 'updated_at', 'client_updated_at']);
const ISO = /^\d{4}-\d\d-\d\dT/;
const norm = (v: unknown): unknown => (typeof v === 'string' && ISO.test(v) ? Date.parse(v) : v ?? null);

/** Do two rows hold the same business data (ignoring version/timestamps)? */
export function sameContent(a: AnyRow, b: AnyRow): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) {
    if (META_KEYS.has(k)) continue;
    if (norm(ra[k]) !== norm(rb[k])) return false;
  }
  return true;
}

const PULL_OVERLAP_MS = 5000;

export class Store {
  private mem = new Map<TableName, Map<string, AnyRow>>();
  private outbox = new Map<string, OutboxEntry>();
  private conflictMap = new Map<string, ConflictRecord>();
  private listeners = new Set<() => void>();
  private tableVer = new Map<TableName, number>();
  private snapCache = new Map<TableName, { v: number; rows: AnyRow[] }>();
  private persistChain: Promise<unknown> = Promise.resolve();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private syncAgain = false;
  private metaVer = 0;
  status: SyncStatus = { state: 'idle', lastSyncAt: null };
  persistError: string | null = null;

  constructor(
    readonly userId: string,
    private db: LocalDB,
    private remote: Remote | null,
    readonly deviceId: string,
  ) {
    for (const t of TABLES) {
      this.mem.set(t, new Map());
      this.tableVer.set(t, 0);
    }
    if (!remote) this.status = { state: 'disabled', lastSyncAt: null };
  }

  // ---------------------------------------------------------------- loading
  async load(): Promise<void> {
    for (const t of TABLES) {
      const m = this.mem.get(t)!;
      for (const r of await this.db.getAll(t)) m.set(r.id, r);
      this.bump(t);
    }
    for (const o of await this.db.getAll<OutboxEntry>('outbox')) this.outbox.set(o.key, o);
    for (const c of await this.db.getAll<ConflictRecord>('conflicts')) this.conflictMap.set(c.key, c);
    this.status.lastSyncAt = (await this.db.getMeta<string>('lastSyncAt')) ?? null;
    this.emit();
  }

  // ---------------------------------------------------------------- subscriptions
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.metaVer++;
    for (const l of this.listeners) l();
  }
  private bump(t: TableName) {
    this.tableVer.set(t, (this.tableVer.get(t) ?? 0) + 1);
  }
  /** Changes whenever anything (rows, outbox, conflicts, status) changes. */
  metaVersion = () => this.metaVer;

  // ---------------------------------------------------------------- reads
  /** Live (non-deleted) rows. The returned array is stable until the table changes. */
  rows<T extends TableName>(table: T): RowMap[T][] {
    const v = this.tableVer.get(table)!;
    const c = this.snapCache.get(table);
    if (c && c.v === v) return c.rows as RowMap[T][];
    const rows = [...this.mem.get(table)!.values()].filter((r) => !r.deleted_at);
    this.snapCache.set(table, { v, rows });
    return rows as RowMap[T][];
  }
  /** Including soft-deleted rows (history lookups). */
  allRows<T extends TableName>(table: T): RowMap[T][] {
    return [...this.mem.get(table)!.values()] as RowMap[T][];
  }
  get<T extends TableName>(table: T, id: string): RowMap[T] | undefined {
    return this.mem.get(table)!.get(id) as RowMap[T] | undefined;
  }
  pendingCount = () => this.outbox.size;
  failedEntries = () => [...this.outbox.values()].filter((o) => o.last_error);
  conflicts = () => [...this.conflictMap.values()];
  unresolvedConflicts = () => this.conflicts().filter((c) => !c.resolution);

  // ---------------------------------------------------------------- writes
  private persist(fn: () => Promise<unknown>) {
    this.persistChain = this.persistChain.then(fn).catch((e) => {
      this.persistError = e instanceof Error ? e.message : String(e);
      this.emit();
    });
    return this.persistChain;
  }

  /** Insert or update a row locally and queue it for the server. Synchronous for the UI; durable shortly after. */
  put<T extends TableName>(table: T, patch: Partial<RowMap[T]> & { id?: string }, opts: { noSync?: boolean } = {}): RowMap[T] {
    const m = this.mem.get(table)!;
    const id = patch.id ?? uuid();
    const prev = m.get(id) as RowMap[T] | undefined;
    let now = new Date().toISOString();
    // Strictly increasing per row, so "was this row edited since I sent it?" is always answerable.
    if (prev && prev.client_updated_at >= now) now = new Date(Date.parse(prev.client_updated_at) + 1).toISOString();
    const row = {
      ...(prev ?? {}),
      ...patch,
      id,
      user_id: this.userId,
      version: prev?.version ?? 0,
      created_at: prev?.created_at ?? now,
      updated_at: prev?.updated_at ?? now,
      client_updated_at: now,
      deleted_at: 'deleted_at' in patch ? ((patch as { deleted_at?: string | null }).deleted_at ?? null) : prev?.deleted_at ?? null,
    } as RowMap[T];
    if (!prev) row.client_updated_at = row.created_at; // an untouched, freshly-created row
    m.set(id, row);
    this.bump(table);

    const key = `${table}:${id}`;
    const existing = this.outbox.get(key);
    const entry: OutboxEntry = existing ?? {
      key, table, id,
      base_version: prev && prev.version > 0 ? prev.version : null,
      queued_at: now, attempts: 0,
    };
    entry.last_error = undefined;
    this.outbox.set(key, entry);
    this.persist(async () => {
      await this.db.put(table, row);
      await this.db.put('outbox', entry);
    });
    this.emit();
    if (!opts.noSync) this.scheduleSync();
    return row;
  }

  softDelete<T extends TableName>(table: T, id: string) {
    const prev = this.get(table, id);
    if (!prev) return;
    this.put(table, { id, deleted_at: new Date().toISOString() } as unknown as Partial<RowMap[T]> & { id: string });
  }

  // ---------------------------------------------------------------- sync
  scheduleSync(delay = 800) {
    if (!this.remote) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.sync(), delay);
  }

  private setStatus(s: Partial<SyncStatus>) {
    this.status = { ...this.status, ...s };
    this.emit();
  }

  async sync(): Promise<void> {
    if (!this.remote) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus({ state: 'offline' });
      return;
    }
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    this.setStatus({ state: 'syncing', error: undefined });
    try {
      do {
        this.syncAgain = false;
        await this.pushAll();
        await this.pullAll();
      } while (this.syncAgain);
      const at = new Date().toISOString();
      await this.persist(() => this.db.setMeta('lastSyncAt', at));
      this.setStatus({ state: 'idle', lastSyncAt: at });
    } catch (e) {
      if (e instanceof NetworkError) this.setStatus({ state: 'offline' });
      else this.setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.syncing = false;
    }
  }

  private async pushAll() {
    const remote = this.remote!;
    const order = (t: TableName) => TABLES.indexOf(t);
    const entries = [...this.outbox.values()]
      .filter((e) => !this.conflictMap.get(e.key) || this.conflictMap.get(e.key)!.resolution)
      .sort((a, b) => order(a.table) - order(b.table) || a.queued_at.localeCompare(b.queued_at));

    for (const e of entries) {
      const local = this.get(e.table, e.id);
      if (!local) {
        await this.dropOutbox(e.key);
        continue;
      }
      let res: PushResult =
        e.base_version === null ? await remote.insert(e.table, local) : await remote.update(e.table, e.id, e.base_version, local);
      if (!res.ok && res.reason === 'missing') res = await remote.insert(e.table, local);

      if (res.ok) {
        await this.applyServerRow(e, local, res.row);
      } else if (res.reason === 'duplicate' || res.reason === 'conflict') {
        const server = await remote.fetchOne(e.table, e.id);
        if (!server) {
          this.markFailed(e, 'Server reported a conflict but the record could not be read.');
        } else if (sameContent(local, server)) {
          await this.adopt(e, server); // both devices ended up with identical data: nothing to decide
        } else if (res.reason === 'duplicate' && local.client_updated_at === local.created_at) {
          await this.adopt(e, server); // our copy was never touched: take the server's
        } else {
          await this.recordConflict(e, local, server);
        }
      } else {
        this.markFailed(e, res.message ?? 'Unknown error');
      }
    }
  }

  private markFailed(e: OutboxEntry, msg: string) {
    e.attempts++;
    e.last_error = msg;
    this.persist(() => this.db.put('outbox', e));
    this.emit();
  }

  private async dropOutbox(key: string) {
    this.outbox.delete(key);
    await this.persist(() => this.db.delete('outbox', key));
  }

  /** The server accepted our row. Keep any edit the user made while the request was in flight. */
  private async applyServerRow(e: OutboxEntry, sent: AnyRow, server: AnyRow) {
    const cur = this.get(e.table, e.id)!;
    const m = this.mem.get(e.table)!;
    if (cur.client_updated_at !== sent.client_updated_at) {
      const merged = { ...cur, version: server.version, updated_at: server.updated_at, created_at: server.created_at } as AnyRow;
      m.set(e.id, merged);
      e.base_version = server.version;
      e.last_error = undefined;
      this.persist(async () => {
        await this.db.put(e.table, merged);
        await this.db.put('outbox', e);
      });
      this.syncAgain = true;
    } else {
      m.set(e.id, server);
      this.persist(() => this.db.put(e.table, server));
      await this.dropOutbox(e.key);
    }
    this.bump(e.table);
    this.emit();
  }

  private async adopt(e: OutboxEntry, server: AnyRow) {
    this.mem.get(e.table)!.set(e.id, server);
    this.persist(() => this.db.put(e.table, server));
    await this.dropOutbox(e.key);
    this.bump(e.table);
    this.emit();
  }

  private async recordConflict(e: OutboxEntry, local: AnyRow, remote: AnyRow) {
    const c: ConflictRecord = {
      key: e.key, table: e.table, id: e.id, local, remote,
      detected_at: new Date().toISOString(), resolution: null, resolved_at: null,
    };
    this.conflictMap.set(e.key, c);
    this.persist(() => this.db.put('conflicts', c));
    this.emit();
  }

  private async pullAll() {
    const remote = this.remote!;
    for (const table of TABLES) {
      const cursor = (await this.db.getMeta<string>(`cursor:${table}`)) ?? null;
      const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
      const rows = await remote.fetchSince(table, since);
      if (!rows.length) continue;
      const m = this.mem.get(table)!;
      const writes: AnyRow[] = [];
      let max = cursor ?? '';
      for (const r of rows) {
        if (!max || Date.parse(r.updated_at) > Date.parse(max)) max = r.updated_at;
        if (this.outbox.has(`${table}:${r.id}`)) continue; // local edit pending: reconciled on push
        const local = m.get(r.id);
        if (!local || r.version > local.version) {
          m.set(r.id, r);
          writes.push(r);
        }
      }
      if (writes.length) {
        this.bump(table);
        await this.persist(() => this.db.putMany(table, writes));
      }
      await this.persist(() => this.db.setMeta(`cursor:${table}`, max));
      if (writes.length) this.emit();
    }
  }

  // ---------------------------------------------------------------- conflict resolution
  async resolveConflict(key: string, choice: 'mine' | 'theirs') {
    const c = this.conflictMap.get(key);
    if (!c || c.resolution) return;
    const remote = (await this.remote?.fetchOne(c.table, c.id).catch(() => null)) ?? c.remote;
    c.remote = remote;
    c.resolution = choice;
    c.resolved_at = new Date().toISOString();
    this.persist(() => this.db.put('conflicts', c));
    if (choice === 'theirs') {
      this.mem.get(c.table)!.set(c.id, remote);
      this.persist(() => this.db.put(c.table, remote));
      this.outbox.delete(key);
      this.persist(() => this.db.delete('outbox', key));
      this.bump(c.table);
      this.emit();
    } else {
      const entry = this.outbox.get(key) ?? { key, table: c.table, id: c.id, base_version: null, queued_at: c.resolved_at, attempts: 0 };
      entry.base_version = remote.version; // rebase onto what the server has now
      entry.last_error = undefined;
      this.outbox.set(key, entry);
      const cur = this.get(c.table, c.id) ?? c.local;
      this.persist(async () => {
        await this.db.put('outbox', entry);
        await this.db.put(c.table, cur);
      });
      this.emit();
      this.scheduleSync(50);
    }
  }

  /** Full local export (for backup / data management). Includes soft-deleted rows and conflicts. */
  exportAll() {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: this.userId };
    for (const t of TABLES) out[t] = this.allRows(t);
    out.pending_changes = [...this.outbox.values()];
    out.conflicts = this.conflicts();
    return out;
  }
}
