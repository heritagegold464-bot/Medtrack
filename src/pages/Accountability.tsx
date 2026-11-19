import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useData } from '../lib/app';
import { Card, cx } from '../components/ui';
import { detId } from '../lib/ids';
import { fmtDuration, zonedDate } from '../lib/time';
import { actualSeconds } from '../lib/engine';

export default function AccountabilityPage() {
  const d = useData();
  const { store } = useApp();
  const nav = useNavigate();
  const today = zonedDate();
  const existing = d.accountability.find((a) => a.check_date === today);
  const [plan, setPlan] = useState<'yes' | 'partly' | 'no' | null>(existing?.followed_plan ?? null);
  const [obstacle, setObstacle] = useState(existing?.biggest_obstacle ?? '');
  const [tomorrow, setTomorrow] = useState(existing?.tomorrow_commitment ?? '');
  const todayRecs = d.records.filter((r) => r.study_date === today);

  const save = () => {
    if (!plan) return;
    store.put('daily_accountability', {
      id: detId(store.userId, `accountability:${today}`), check_date: today,
      followed_plan: plan, biggest_obstacle: obstacle.trim(), tomorrow_commitment: tomorrow.trim(),
    });
    nav('/');
  };
  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm font-semibold text-navy-700">← Dashboard</Link>
      <h1 className="text-2xl font-extrabold text-navy-800">Daily accountability</h1>
      <Card>
        <p className="text-sm text-ink-700">Recorded study today: <b>{fmtDuration(actualSeconds(todayRecs))}</b> across {todayRecs.length} session(s). This is a record of fact, not a score.</p>
        <div className="label mt-4">Did you follow today's reading plan?</div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {([['yes', 'Yes', 'border-ok-600 bg-ok-50 text-ok-700'], ['partly', 'Partly', 'border-warn-600 bg-warn-50 text-warn-700'], ['no', 'No', 'border-bad-600 bg-bad-50 text-bad-700']] as const).map(([v, l, on]) => (
            <button key={v} role="radio" aria-checked={plan === v} onClick={() => setPlan(v)} className={cx('min-h-[48px] rounded-lg border-2 text-sm font-bold', plan === v ? on : 'border-slate-200 bg-white text-ink-700')}>{l}</button>
          ))}
        </div>
        <label className="label mt-4" htmlFor="ob">Biggest obstacle today</label>
        <input id="ob" className="input" maxLength={500} value={obstacle} onChange={(e) => setObstacle(e.target.value)} />
        <label className="label mt-3" htmlFor="tm">One commitment for tomorrow</label>
        <input id="tm" className="input" maxLength={500} value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
        <button className="btn-primary mt-4 w-full" disabled={!plan} onClick={save}>{existing ? 'Update check' : 'Save check'}</button>
      </Card>
    </div>
  );
}
