'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import type { RevenueData, RevenuePoint } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { Legend } from './charts';
import { EASE } from './motion';
import { useMeasuredWidth } from './dashboard/use-measure';

type Projection = NonNullable<RevenueData['projection']>;

/** 1, 2, 2.5 or 5 times a power of ten, at least `raw`. */
function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const pathOf = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/**
 * Actual revenue vs the expected band. The line draws itself in, the band
 * fades up behind it, anomaly days get a marker (red for drops) and the
 * story day gets a pulsing marker with a callout. Hover for a crosshair.
 */
export function RevenueChart({
  data,
  projection,
  highlightDate,
  highlightDeltaPercent,
  height = 300,
}: {
  data: RevenuePoint[];
  projection?: Projection;
  highlightDate?: string | null;
  /** The story's own % change, so the callout matches the headline. */
  highlightDeltaPercent?: number | null;
  height?: number;
}) {
  const id = useId().replace(/:/g, '');
  const [box, W] = useMeasuredWidth<HTMLDivElement>(760);
  const svgRef = useRef<SVGSVGElement>(null);
  const inView = useInView(svgRef, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const show = inView || reduce;

  const proj = projection ?? [];
  const H = height;
  const pad = { l: 48, r: 14, t: 34, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = data.length + proj.length;
  if (data.length < 2) return <div ref={box} />;

  const values = [
    ...data.flatMap((d) => [d.revenue, d.lower, d.upper]),
    ...proj.flatMap((p) => [p.lower, p.upper]),
  ];
  const rawLo = Math.min(...values);
  const rawHi = Math.max(...values);
  const unit = niceStep((rawHi - rawLo) / 4);
  const lo = Math.max(0, Math.floor(rawLo / unit) * unit);
  const hi = Math.max(lo + unit, Math.ceil(rawHi / unit) * unit);
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const actual = pathOf(data.map((d, i) => [x(i), y(d.revenue)]));
  const expected = pathOf(data.map((d, i) => [x(i), y(d.forecast)]));
  const band =
    pathOf(data.map((d, i) => [x(i), y(d.upper)])) +
    data
      .map((d, i) => [x(i), y(d.lower)] as [number, number])
      .reverse()
      .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`)
      .join('') +
    'Z';
  const area = `${actual}L${x(data.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`;
  const j0 = data.length - 1;
  const projLine = proj.length
    ? pathOf([[x(j0), y(data[j0]!.revenue)], ...proj.map((p, k) => [x(j0 + 1 + k), y(p.value)] as [number, number])])
    : '';
  const projBand = proj.length
    ? pathOf([[x(j0), y(data[j0]!.revenue)], ...proj.map((p, k) => [x(j0 + 1 + k), y(p.upper)] as [number, number])]) +
      [...proj]
        .map((p, k) => [x(j0 + 1 + k), y(p.lower)] as [number, number])
        .reverse()
        .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`)
        .join('') +
      `L${x(j0).toFixed(1)},${y(data[j0]!.revenue).toFixed(1)}Z`
    : '';

  const anomalies = data.map((d, i) => ({ d, i })).filter(({ d }) => d.isAnomaly);
  const hi0 = highlightDate ? data.findIndex((d) => d.date === highlightDate) : -1;
  const story = hi0 >= 0 ? data[hi0]! : null;
  const storyPct = highlightDeltaPercent ?? (story && story.forecast ? (story.revenue / story.forecast - 1) * 100 : null);
  const ticks = Array.from({ length: Math.round((hi - lo) / unit) + 1 }, (_, i) => lo + unit * i);
  const monthTicks = data
    .map((d, i) => ({ d, i }))
    .filter(({ d }, k) => d.date.endsWith('-01') || (k === 0 && Number(d.date.slice(8)) < 20));
  const h = hover == null ? null : hover < data.length ? { kind: 'actual' as const, p: data[hover]! } : { kind: 'proj' as const, p: proj[hover - data.length]! };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / iw) * (n - 1));
    setHover(i < 0 || i >= n ? null : i);
  };

  const DRAW = 1.8;
  const calloutX = story ? Math.min(Math.max(x(hi0), pad.l + 70), W - pad.r - 70) : 0;

  return (
    <div ref={box} className="relative">
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className="block touch-none select-none"
        role="img"
        aria-label="Daily revenue against the expected band"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`ra-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--series-1)', stopOpacity: 0.16 }} />
            <stop offset="100%" style={{ stopColor: 'var(--series-1)', stopOpacity: 0 }} />
          </linearGradient>
          <clipPath id={`rc-${id}`}>
            <motion.rect
              x={0}
              y={0}
              height={H}
              initial={reduce ? false : { width: 0 }}
              animate={show ? { width: W } : {}}
              transition={{ duration: DRAW, ease: EASE }}
            />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)" className="tabular-nums">
              {formatCurrency(t)}
            </text>
          </g>
        ))}
        {monthTicks.map(({ d, i }) => (
          <text key={d.date} x={x(i)} y={H - 8} fontSize={10} fill="var(--text-muted)" textAnchor="start">
            {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
          </text>
        ))}

        {/* Expected band and line */}
        <motion.path
          d={band}
          fill="var(--band)"
          initial={reduce ? false : { opacity: 0 }}
          animate={show ? { opacity: 1 } : {}}
          transition={{ duration: 0.9 }}
        />
        <motion.path
          d={expected}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={1.25}
          strokeDasharray="4 4"
          initial={reduce ? false : { opacity: 0 }}
          animate={show ? { opacity: 0.9 } : {}}
          transition={{ duration: 0.9, delay: 0.2 }}
        />

        {/* Forecast after the last day */}
        {proj.length > 0 && (
          <motion.g
            initial={reduce ? false : { opacity: 0 }}
            animate={show ? { opacity: 1 } : {}}
            transition={{ duration: 0.6, delay: DRAW }}
          >
            <rect x={x(j0)} y={pad.t} width={x(n - 1) - x(j0)} height={ih} fill="var(--surface-2)" opacity={0.6} />
            <path d={projBand} fill="var(--band)" />
            <path d={projLine} fill="none" stroke="var(--series-2)" strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" />
            <text x={x(j0) + 6} y={pad.t + 12} fontSize={10} fill="var(--text-muted)">
              forecast
            </text>
          </motion.g>
        )}

        {/* Actual revenue: area wipes in, line draws itself */}
        <g clipPath={`url(#rc-${id})`}>
          <path d={area} fill={`url(#ra-${id})`} />
        </g>
        <motion.path
          d={actual}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={show ? { pathLength: 1 } : {}}
          transition={{ duration: DRAW, ease: EASE }}
        />

        {/* Anomaly markers */}
        {anomalies.map(({ d, i }) => {
          const drop = d.revenue < d.forecast;
          const isStory = i === hi0;
          const delay = (i / data.length) * DRAW;
          return (
            <motion.g
              key={d.date}
              initial={reduce ? false : { opacity: 0 }}
              animate={show ? { opacity: 1 } : {}}
              transition={{ duration: 0.4, delay, ease: EASE }}
            >
              {drop && <line x1={x(i)} x2={x(i)} y1={y(d.forecast)} y2={y(d.revenue)} stroke="var(--status-critical)" strokeWidth={1} strokeDasharray="2 2" />}
              {isStory && (
                <circle cx={x(i)} cy={y(d.revenue)} r={6} fill="var(--status-critical)" className="helix-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              )}
              <circle
                cx={x(i)}
                cy={y(d.revenue)}
                r={isStory ? 5.5 : 4}
                fill={drop ? 'var(--status-critical)' : 'var(--surface)'}
                stroke={drop ? 'var(--surface)' : 'var(--series-1)'}
                strokeWidth={2}
              />
            </motion.g>
          );
        })}

        {/* Callout for the story day */}
        {story && (
          <motion.g
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={show ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: DRAW + 0.1, ease: EASE }}
          >
            <line x1={x(hi0)} x2={x(hi0)} y1={pad.t - 6} y2={y(Math.max(story.forecast, story.upper))} stroke="var(--status-critical)" strokeWidth={1} opacity={0.6} />
            <rect x={calloutX - 66} y={pad.t - 30} width={132} height={22} rx={11} fill="var(--status-critical)" />
            <text x={calloutX} y={pad.t - 15} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--accent-contrast)" className="tabular-nums">
              {storyPct !== null ? `${storyPct.toFixed(1)}%` : 'Anomaly'} on {formatShortDate(story.date)}
            </text>
          </motion.g>
        )}

        {/* Crosshair */}
        {hover != null && h && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-strong)" />
            <circle
              cx={x(hover)}
              cy={y(h.kind === 'actual' ? h.p.revenue : h.p.value)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {hover != null && h && (
        <div
          className="pointer-events-none absolute top-8 z-10 w-48 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs shadow-[var(--shadow-lg)]"
          style={{ left: Math.min(Math.max(x(hover) + 12, 0), W - 200) }}
        >
          <p className="font-semibold">
            {formatShortDate(h.p.date)}
            {h.kind === 'proj' && <span className="ml-1.5 font-normal text-[var(--text-muted)]">forecast</span>}
          </p>
          {h.kind === 'actual' ? (
            <dl className="mt-2 space-y-1 tabular-nums">
              <div className="flex justify-between">
                <dt className="text-[var(--text-secondary)]">Revenue</dt>
                <dd className={`font-semibold ${h.p.isAnomaly && h.p.revenue < h.p.forecast ? 'text-[var(--text-bad)]' : ''}`}>
                  {formatCurrency(h.p.revenue, false)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--text-secondary)]">Expected</dt>
                <dd>{formatCurrency(h.p.forecast, false)}</dd>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <dt>Normal range</dt>
                <dd>
                  {formatCurrency(h.p.lower)} to {formatCurrency(h.p.upper)}
                </dd>
              </div>
              {h.p.isAnomaly && (
                <p className="pt-1 font-medium text-[var(--text-bad)]">
                  Flagged{h.p.zScore != null ? `, z ${h.p.zScore.toFixed(1)}` : ''}
                </p>
              )}
            </dl>
          ) : (
            <dl className="mt-2 space-y-1 tabular-nums">
              <div className="flex justify-between">
                <dt className="text-[var(--text-secondary)]">Forecast</dt>
                <dd className="font-semibold">{formatCurrency(h.p.value, false)}</dd>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <dt>Interval</dt>
                <dd>
                  {formatCurrency(h.p.lower)} to {formatCurrency(h.p.upper)}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}

      <div className="mt-3">
        <Legend
          items={[
            { label: 'Revenue', color: 'var(--series-1)' },
            { label: 'Expected', color: 'var(--series-2)', dashed: true },
            { label: 'Normal range', color: 'var(--band)', area: true },
            { label: 'Flagged drop', color: 'var(--status-critical)', area: true },
            ...(proj.length ? [{ label: 'Forecast', color: 'var(--series-3)', dashed: true }] : []),
          ]}
        />
      </div>
    </div>
  );
}
