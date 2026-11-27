'use client';

import type { Kpi } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Sparkline } from '../charts';
import { CountUp, SpotlightCard } from '../motion';

export type NumberUnit = Kpi['unit'] | 'percentPoints' | 'currencyExact';

/** Formatter per unit; lives client-side because CountUp takes a function. */
export function formatUnit(unit: NumberUnit, n: number): string {
  switch (unit) {
    case 'currency':
      return formatCurrency(n);
    case 'currencyExact':
      return formatCurrency(n, false);
    case 'percent':
      return `${(n * 100).toFixed(2)}%`;
    case 'percentPoints':
      return `${n.toFixed(1)}%`;
    case 'minutes':
      return `${Math.round(n)} min`;
    default:
      return Math.round(n).toLocaleString('en-US');
  }
}

/** Animated number for server components (which cannot pass a format function). */
export function AnimatedNumber({
  value,
  unit = 'count',
  duration,
  className,
}: {
  value: number;
  unit?: NumberUnit;
  duration?: number;
  className?: string;
}) {
  return <CountUp value={value} format={(n) => formatUnit(unit, n)} duration={duration} className={className} />;
}

/** Rates of bad things (refunds, anomalies, time to answer) are better when they fall. */
const LOWER_IS_BETTER = new Set(['refund_rate', 'anomalies', 'mttr']);

export function KpiCard({ kpi, index = 0, caption }: { kpi: Kpi; index?: number; caption?: string }) {
  const good = LOWER_IS_BETTER.has(kpi.key) ? kpi.delta <= 0 : kpi.delta >= 0;
  const flat = Math.abs(kpi.delta) < 0.0005;
  return (
    <SpotlightCard className="h-full p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{kpi.label}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
            flat
              ? 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
              : good
                ? 'bg-[var(--surface-2)] text-[var(--text-primary)]'
                : 'bg-[var(--anomaly-fill)] text-[var(--text-bad)]'
          }`}
        >
          {flat ? '0.0%' : `${kpi.delta > 0 ? '+' : '-'}${Math.abs(kpi.delta * 100).toFixed(1)}%`}
        </span>
      </div>
      <p className="mt-4 text-[34px] font-semibold leading-none tracking-tight">
        <AnimatedNumber value={kpi.value} unit={kpi.unit} duration={1.4 + index * 0.1} />
      </p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">{caption ?? 'vs the previous period'}</p>
      <div className="mt-4 -mb-1">
        <Sparkline values={kpi.spark} tone={good || flat ? 'neutral' : 'bad'} width={240} height={44} delay={0.15 * index} fluid />
      </div>
    </SpotlightCard>
  );
}
