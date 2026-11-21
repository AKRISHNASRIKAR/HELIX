'use client';

import { useState } from 'react';
import type { RevenuePoint } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { Legend } from './charts';

/** Actual revenue vs forecast band, with the anomaly window shaded and a hover crosshair. */
export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = 260;
  const pad = { l: 44, r: 8, t: 12, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const lo = Math.floor(Math.min(...data.map((d) => Math.min(d.revenue, d.lower))) / 20_000) * 20_000;
  const hi = Math.ceil(Math.max(...data.map((d) => Math.max(d.revenue, d.upper))) / 20_000) * 20_000;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  const line = (key: 'revenue' | 'forecast') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const band =
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.upper).toFixed(1)}`).join('') +
    [...data]
      .map((d, i) => ({ d, i }))
      .reverse()
      .map(({ d, i }) => `L${x(i).toFixed(1)},${y(d.lower).toFixed(1)}`)
      .join('') +
    'Z';
  const area = `${line('revenue')}L${x(data.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`;

  const anomalyIdx = data.map((d, i) => (d.isAnomaly ? i : -1)).filter((i) => i >= 0);
  const a0 = anomalyIdx[0];
  const a1 = anomalyIdx[anomalyIdx.length - 1];
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) / 4) * i);
  const h = hover == null ? null : data[hover]!;

  return (
    <div className="relative">
      <Legend
        items={[
          { label: 'Actual revenue', color: 'var(--series-1)' },
          { label: 'Forecast', color: 'var(--text-muted)', dashed: true },
          { label: '80% interval', color: 'var(--band)' },
          { label: 'Anomaly window', color: 'var(--anomaly-fill)' },
        ]}
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Daily revenue versus forecast, last 90 days"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" className="fill-[var(--text-muted)] text-[10px]">
              {formatCurrency(t)}
            </text>
          </g>
        ))}
        {a0 != null && a1 != null && (
          <g>
            <rect
              x={x(a0) - 4}
              y={pad.t}
              width={x(a1) - x(a0) + 8}
              height={ih}
              fill="var(--anomaly-fill)"
              rx={4}
            />
            <text x={x(a0) - 8} y={pad.t + 12} textAnchor="end" className="fill-[var(--text-bad)] text-[10px] font-semibold">
              −22% vs forecast
            </text>
          </g>
        )}
        <path d={band} fill="var(--band)" />
        <path d={area} fill="url(#rev-fill)" />
        <path d={line('forecast')} fill="none" stroke="var(--text-muted)" strokeWidth={1.25} strokeDasharray="4 3" />
        <path d={line('revenue')} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {anomalyIdx.map((i) => (
          <circle key={i} cx={x(i)} cy={y(data[i]!.revenue)} r={4} fill="var(--status-critical)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        {data.map((d, i) =>
          i % 15 === 0 ? (
            <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" className="fill-[var(--text-muted)] text-[10px]">
              {formatShortDate(d.date)}
            </text>
          ) : null,
        )}
        {h && hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-muted)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.revenue)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > data.length * 0.7 ? 'calc(-100% - 12px)' : '12px'})`,
          }}
        >
          <p className="font-medium text-[var(--text-primary)]">{formatShortDate(h.date)}</p>
          <p className="mt-1 tabular-nums text-[var(--text-secondary)]">
            Actual <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(h.revenue, false)}</span>
          </p>
          <p className="tabular-nums text-[var(--text-secondary)]">Forecast {formatCurrency(h.forecast, false)}</p>
          {h.isAnomaly && <p className="mt-1 font-medium text-[var(--text-bad)]">● Anomaly flagged</p>}
        </div>
      )}
    </div>
  );
}
