'use client';

import type { ReactNode } from 'react';
import { evidenceVisual, type SeriesPoint } from '../../../../../lib/trace';
import {
  CorrelationScale,
  DeltaBars,
  EventTimeline,
  ForecastChart,
  KpiCompare,
  RankingBars,
  SeriesChart,
  ValueVsExpected,
  fmtPct,
  shortDay,
} from './charts';

/**
 * A mini chart for one evidence row, picked from its `data.kind`. Returns
 * null for evidence without numbers to plot (the caller shows the summary).
 */
export function EvidenceVisual({ data, series }: { data: unknown; series?: SeriesPoint[] | null }) {
  const v = evidenceVisual(data);
  if (!v) return null;
  switch (v.kind) {
    case 'anomaly': {
      const a = v.anomaly;
      const s = series;
      const bad = a.severity === 'CRITICAL' || a.direction === 'drop';
      return (
        <div className="space-y-2">
          <Caption>
            {a.metricName} on {shortDay(a.date)}
            {a.changePercent != null && <Strong bad={bad}>{fmtPct(a.changePercent)}</Strong>}
          </Caption>
          {s && s.length > 1 ? (
            <SeriesChart series={s} highlight={a.date} expected={a.expected} unit={a.unit} height={64} bad={bad} />
          ) : a.expected != null ? (
            <ValueVsExpected value={a.value} expected={a.expected} unit={a.unit} bad={bad} />
          ) : null}
        </div>
      );
    }
    case 'segment': {
      const s = v.segment;
      return (
        <div className="space-y-2">
          <Caption>
            {v.neutral ? `Every ${s.column} moved with the total` : `Change by ${s.column} vs expected`}
            {s.total?.deltaPercent != null && <Strong bad={!v.neutral}>{fmtPct(s.total.deltaPercent)} overall</Strong>}
          </Caption>
          <DeltaBars slices={s.slices} unit={s.unit} highlight={s.top?.value} neutral={v.neutral} />
        </div>
      );
    }
    case 'kpi':
      return (
        <div className="space-y-2">
          <Caption>
            {v.kpi.metricName}, 7 days vs the 7 before
            {v.kpi.changePercent != null && <Strong>{fmtPct(v.kpi.changePercent)}</Strong>}
          </Caption>
          <KpiCompare kpi={v.kpi} />
        </div>
      );
    case 'forecast':
      return (
        <div className="space-y-2">
          <Caption>Next {v.forecast.points.length} days, with 95% range</Caption>
          <ForecastChart forecast={v.forecast} />
        </div>
      );
    case 'event':
      return v.event.date ? (
        <div>
          <Caption>
            {v.event.label}
            {v.event.status && <Strong>{v.event.status.replace(/_/g, ' ')}</Strong>}
          </Caption>
          <EventTimeline day={v.event.date} main={v.event} />
        </div>
      ) : null;
    case 'correlation':
      return (
        <div className="space-y-2">
          <Caption>
            {v.correlation.metricName} vs {v.correlation.otherMetric}
          </Caption>
          <CorrelationScale correlation={v.correlation} />
        </div>
      );
    case 'ranking':
      return (
        <div className="space-y-2">
          <Caption>Root-cause candidates by score</Caption>
          <RankingBars ranking={v.ranking} />
        </div>
      );
  }
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-[var(--text-muted)]">{children}</p>;
}

function Strong({ children, bad = false }: { children: ReactNode; bad?: boolean }) {
  return <span className={`font-semibold tabular-nums ${bad ? 'text-[var(--text-bad)]' : 'text-[var(--text-primary)]'}`}>{children}</span>;
}
