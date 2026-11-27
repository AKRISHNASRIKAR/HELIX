'use client';

import { CountUp } from '../../../components/motion';
import { formatMs } from '../../../lib/trace';

/** Task count, success rate and average duration, counting up from zero. */
export function AgentStats({ tasks, successRate, avgMs }: { tasks: number; successRate: number | null; avgMs: number | null }) {
  const items = [
    { label: 'Tasks run', value: <CountUp value={tasks} /> },
    {
      label: 'Succeeded',
      value: successRate == null ? '-' : <CountUp value={successRate * 100} format={(n) => `${Math.round(n)}%`} />,
    },
    {
      label: 'Avg time',
      value: avgMs == null ? '-' : <CountUp value={avgMs} format={(n) => formatMs(n) ?? '-'} />,
    },
  ];
  return (
    <dl className="grid grid-cols-3 divide-x divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
      {items.map((it) => (
        <div key={it.label} className="px-3 py-3">
          <dt className="text-[11px] text-[var(--text-muted)]">{it.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
