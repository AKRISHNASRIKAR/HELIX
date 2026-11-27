import Link from 'next/link';
import type { AnomalyRecord } from '../../../lib/api';
import { anomalyChange, anomalyMetricName, formatMetric, groupAnomaliesByDay, severityMeta } from '../../../lib/monitoring';
import { formatDelta, formatUtcDay } from '../../../lib/format';
import { Stagger } from '../../../components/motion';
import { linkClass } from '../../../components/ui';

/** Recent anomalies as a vertical timeline, one node per UTC day, severity glyph per anomaly. */
export function AnomalyTimeline({ anomalies }: { anomalies: AnomalyRecord[] }) {
  const days = groupAnomaliesByDay(anomalies);
  return (
    <ol className="relative max-h-[560px] overflow-y-auto pr-1">
      <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-[var(--border-strong)] via-[var(--border)] to-transparent" />
      {days.map(({ day, items }) => {
        const worst = items.reduce((a, b) => (severityMeta(b.severity).rank > severityMeta(a.severity).rank ? b : a));
        const critical = severityMeta(worst.severity).rank >= 4;
        return (
          <li key={day} className="relative pb-5 pl-7 last:pb-1">
            <span
              aria-hidden
              className={`absolute left-0 top-1 grid h-[15px] w-[15px] place-items-center rounded-full border bg-[var(--surface)] ${
                critical ? 'border-[var(--status-critical)] shadow-[0_0_12px_-1px_var(--status-critical)]' : 'border-[var(--border-strong)]'
              }`}
            >
              <span className={`h-[5px] w-[5px] rounded-full ${critical ? 'bg-[var(--status-critical)]' : 'bg-[var(--text-muted)]'}`} />
            </span>
            <p className="flex items-baseline gap-2">
              <time dateTime={day} className="text-sm font-semibold tracking-tight">
                {formatUtcDay(day)}
              </time>
              <span className="text-[11px] text-[var(--text-muted)]">
                {items.length} anomal{items.length === 1 ? 'y' : 'ies'}
              </span>
            </p>
            <Stagger as="ul" className="mt-2 space-y-1.5" step={0.05}>
              {items.map((a) => {
                const sev = severityMeta(a.severity);
                const change = anomalyChange(a);
                return (
                  <div
                    key={a.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2 transition-colors hover:border-[var(--border-strong)] ${
                      sev.rank >= 4 ? 'border-[var(--status-critical)]/30 bg-[var(--anomaly-fill)]' : 'border-[var(--border)] bg-[var(--surface-2)]'
                    }`}
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-center text-sm leading-none" style={{ color: sev.color }} title={sev.label}>
                      {sev.glyph}
                      <span className="sr-only">{sev.label}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{anomalyMetricName(a)}</p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-[var(--text-muted)]">
                        {formatMetric(a.value, a.unit)}
                        {a.expectedValue != null && <> vs {formatMetric(a.expectedValue, a.unit)} expected</>}
                        {a.investigationId && (
                          <>
                            {' · '}
                            <Link href={`/investigations/${a.investigationId}`} className={linkClass}>
                              investigation →
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    {change != null && (
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${change < 0 ? 'text-[var(--text-bad)]' : 'text-[var(--text-primary)]'}`}>
                        {formatDelta(change)}
                      </span>
                    )}
                  </div>
                );
              })}
            </Stagger>
          </li>
        );
      })}
    </ol>
  );
}
