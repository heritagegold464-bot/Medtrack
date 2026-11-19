import { openDB, type IDBPDatabase } from 'idb';
import { TABLES, type AnyRow, type TableName } from './types';

export interface OutboxEntry {
  key: string; // `${table}:${id}`
  table: TableName;
  id: string;
  /** Server version this edit was based on. null = row has never been inserted on the server. */
  base_version: number | null;
  queued_at: string;
  attempts: number;
  last_error?: string;
}

export interface ConflictRecord {
  key: string;
  table: TableName;
  id: string;
  local: AnyRow;
  remote: AnyRow;
  detected_at: string;
  resolution: null | 'mine' | 'theirs';
  resolved_at: string | null;
}

/** Thin wrapper over IndexedDB. One database per signed-in user so accounts never mix on a device. */
export class LocalDB {
  private constructor(private db: IDBPDatabase) {}

  static async open(name: string): Promise<LocalDB> {
    const db = await openDB(name, 1, {
      upgrade(d) {
        for (const t of TABLES) d.createObjectStore(t, { keyPath: 'id' });
        d.createObjectStore('outbox', { keyPath: 'key' });
        d.createObjectStore('conflicts', { keyPath: 'key' });
        d.createObjectStore('meta');
      },
    });
    return new LocalDB(db);
  }

  getAll<T = AnyRow>(store: string): Promise<T[]> {
    return this.db.getAll(store) as Promise<T[]>;
  }
  put(store: string, value: unknown): Promise<unknown> {
    return this.db.put(store, value);
  }
  async putMany(store: string, values: unknown[]): Promise<void> {
    if (!values.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    await Promise.all([...values.map((v) => tx.store.put(v)), tx.done]);
  }
  delete(store: string, key: string): Promise<void> {
    return this.db.delete(store, key);
  }
  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.get('meta', key) as Promise<T | undefined>;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', value, key);
  }
  close() {
    this.db.close();
  }
}
