/** Minimal accessible SVG charts. Deliberately dependency-free. */
import { fmtHours } from '../lib/time';

export function BarChart({
  data, height = 140, color = '#1d4373', ariaLabel, unit = 'h', fmt = (n: number) => fmtHours(n * 3600),
}: {
  data: Array<{ label: string; value: number; sub?: string }>;
  height?: number; color?: string; ariaLabel: string; unit?: string; fmt?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = Math.max(data.length * 22, 280);
  const pad = 18;
  const bw = (w - 8) / data.length;
  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${w} ${height + pad}`} className="w-full min-w-[280px]" style={{ height: height + pad }}>
        <line x1="0" x2={w} y1={height} y2={height} stroke="#cbd5e1" />
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * (height - 16));
          const x = 4 + i * bw;
          return (
            <g key={i}>
              <title>{`${d.label}: ${fmt(d.value)}${unit}${d.sub ? ` (${d.sub})` : ''}`}</title>
              <rect x={x + 2} y={height - h} width={Math.max(4, bw - 4)} height={h} rx="2" fill={d.value > 0 ? color : '#e2e8f0'} />
              {data.length <= 16 || i % 2 === 0 ? (
                <text x={x + bw / 2} y={height + 12} textAnchor="middle" fontSize="9" fill="#5b6b7f">{d.label}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal stacked bar: completed / in progress / not started. */
export function StackedBar({ completed, inProgress, notStarted, label }: { completed: number; inProgress: number; notStarted: number; label: string }) {
  const total = completed + inProgress + notStarted;
  const seg = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div role="img" aria-label={`${label}: ${completed} completed, ${inProgress} in progress, ${notStarted} not started`} className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="bg-ok-600" style={{ width: `${seg(completed)}%` }} />
      <div className="bg-warn-600" style={{ width: `${seg(inProgress)}%` }} />
    </div>
  );
}
