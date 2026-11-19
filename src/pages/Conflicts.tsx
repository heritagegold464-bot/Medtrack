import { Link } from 'react-router-dom';
import { useApp, useStoreVersion } from '../lib/app';
import { Card, Empty, SectionTitle } from '../components/ui';
import type { ConflictRecord } from '../lib/db';

const SKIP = new Set(['id', 'user_id', 'version', 'created_at', 'updated_at', 'deleted_at']);

function Diff({ c }: { c: ConflictRecord }) {
  const l = c.local as unknown as Record<string, unknown>;
  const r = c.remote as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(l), ...Object.keys(r)])].filter((k) => !SKIP.has(k) && JSON.stringify(l[k]) !== JSON.stringify(r[k]));
  return (
    <table className="mt-2 w-full text-xs">
      <thead><tr className="text-left text-ink-500"><th className="py-1">Field</th><th>This device</th><th>Other device</th></tr></thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-slate-100 align-top"><td className="py-1 pr-2 font-semibold">{k}</td><td className="pr-2">{String(l[k] ?? '—')}</td><td>{String(r[k] ?? '—')}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ConflictsPage() {
  const { store } = useApp();
  useStoreVersion();
  const open = store.unresolvedConflicts();
  const done = store.conflicts().filter((c) => c.resolution);
  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm font-semibold text-navy-700">← Settings</Link>
      <div>
        <h1 className="text-2xl font-extrabold text-navy-800">Sync conflicts</h1>
        <p className="text-sm text-ink-500">The same record was changed on two devices. Nothing has been overwritten — choose which version to keep.</p>
      </div>
      {open.length === 0 && <Empty>No unresolved conflicts.</Empty>}
      {open.map((c) => (
        <Card key={c.key}>
          <div className="text-sm font-bold text-navy-800">{c.table.replace(/_/g, ' ')}</div>
          <Diff c={c} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => void store.resolveConflict(c.key, 'theirs')}>Keep other device</button>
            <button className="btn-primary" onClick={() => void store.resolveConflict(c.key, 'mine')}>Keep this device</button>
          </div>
        </Card>
      ))}
      {done.length > 0 && (
        <section>
          <SectionTitle>Resolved</SectionTitle>
          <ul className="space-y-2">
            {done.map((c) => <li key={c.key} className="card p-3 text-xs text-ink-700">{c.table} · kept {c.resolution === 'mine' ? 'this device' : 'other device'} · {c.resolved_at?.slice(0, 16).replace('T', ' ')}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
