import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AnyRow, TableName } from './types';
import { NetworkError, type PushResult, type Remote } from './store';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

/** Only the public anon key is ever used in the browser. Access is enforced by row-level security. */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anon!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Columns the server owns. Never sent by the client.
const SERVER_COLS = ['version', 'updated_at'];
const strip = (row: AnyRow, extra: string[] = []) => {
  const o: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>) };
  for (const k of [...SERVER_COLS, ...extra]) delete o[k];
  return o;
};

interface PgErr { code?: string; message: string; details?: string; status?: number }
const isNetwork = (e: PgErr | null, status: number) =>
  !!e && (status === 0 || /failed to fetch|networkerror|load failed|network request failed/i.test(e.message));

export class SupabaseRemote implements Remote {
  constructor(private sb: SupabaseClient) {}

  async insert(table: TableName, row: AnyRow): Promise<PushResult> {
    const { data, error, status } = await this.sb.from(table).insert(strip(row)).select().single();
    if (isNetwork(error, status)) throw new NetworkError(error!.message);
    if (error) {
      if (error.code === '23505') return { ok: false, reason: 'duplicate' };
      return { ok: false, reason: 'error', message: error.message };
    }
    return { ok: true, row: data as AnyRow };
  }

  async update(table: TableName, id: string, baseVersion: number, row: AnyRow): Promise<PushResult> {
    const { data, error, status } = await this.sb
      .from(table)
      .update(strip(row, ['id', 'user_id', 'created_at']))
      .eq('id', id)
      .eq('version', baseVersion) // optimistic concurrency: applies only if nobody else changed it
      .select();
    if (isNetwork(error, status)) throw new NetworkError(error!.message);
    if (error) return { ok: false, reason: 'error', message: error.message };
    if (!data || data.length === 0) {
      const { data: exists, error: e2, status: s2 } = await this.sb.from(table).select('id').eq('id', id).maybeSingle();
      if (isNetwork(e2, s2)) throw new NetworkError(e2!.message);
      return { ok: false, reason: exists ? 'conflict' : 'missing' };
    }
    return { ok: true, row: data[0] as AnyRow };
  }

  async fetchOne(table: TableName, id: string): Promise<AnyRow | null> {
    const { data, error, status } = await this.sb.from(table).select('*').eq('id', id).maybeSingle();
    if (isNetwork(error, status)) throw new NetworkError(error!.message);
    if (error) throw new Error(error.message);
    return (data as AnyRow) ?? null;
  }

  async fetchSince(table: TableName, since: string | null): Promise<AnyRow[]> {
    const out: AnyRow[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      let q = this.sb.from(table).select('*').order('updated_at', { ascending: true }).order('id').range(from, from + page - 1);
      if (since) q = q.gte('updated_at', since);
      const { data, error, status } = await q;
      if (isNetwork(error, status)) throw new NetworkError(error!.message);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as AnyRow[]));
      if (!data || data.length < page) break;
    }
    return out;
  }
}
