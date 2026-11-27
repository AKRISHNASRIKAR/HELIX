'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatShortDate } from '../lib/format';
import { useSound } from './experience';
import { EASE } from './motion';
import { makeThrottle, useMeasuredWidth } from './dashboard/use-measure';

/**
 * Hand-rolled, animated SVG charts (no chart library). Colours come only from
 * the CSS tokens in globals.css: monochrome ink and greys, with red reserved
 * for "something broke". Every chart animates in once when it scrolls into
 * view and respects prefers-reduced-motion.
 */

// ------------------------------------------------------------------ sparkline

export function Sparkline({
  values,
  tone = 'neutral',
  width = 120,
  height = 36,
  delay = 0,
  fluid = false,
}: {
  values: number[];
  tone?: 'good' | 'bad' | 'neutral';
  width?: number;
  height?: number;
  delay?: number;
  /** Stretch to the container width (no end dot, strokes stay crisp). */
  fluid?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  const reduce = useReducedMotion();
  if (values.length < 2) return <svg ref={ref} width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (width - 6) + 3,
    height - 4 - ((v - min) / span) * (height - 8),
  ]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x!.toFixed(1)},${y!.toFixed(1)}`).join('');
  const area = `${line}L${width - 3},${height}L3,${height}Z`;
  const stroke = tone === 'bad' ? 'var(--status-critical)' : 'var(--series-1)';
  const last = pts[pts.length - 1]!;
  const show = inView || reduce;
  return (
    <svg
      ref={ref}
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      aria-hidden
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: stroke, stopOpacity: 0.22 }} />
          <stop offset="100%" style={{ stopColor: stroke, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#sg-${id})`}
        initial={reduce ? false : { opacity: 0 }}
        animate={show ? { opacity: 1 } : {}}
        transition={{ duration: 0.8, delay: delay + 0.6 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? false : { pathLength: 0 }}
        animate={show ? { pathLength: 1 } : {}}
        transition={{ duration: 1.1, delay, ease: EASE }}
      />
      {!fluid && (
      <motion.circle
        cx={last[0]}
        cy={last[1]}
        r={3}
        fill={stroke}
        stroke="var(--surface)"
        strokeWidth={1.5}
        initial={reduce ? false : { scale: 0 }}
        animate={show ? { scale: 1 } : {}}
        transition={{ duration: 0.3, delay: delay + 1.05 }}
      />
      )}
    </svg>
  );
}

// -------------------------------------------------------------------- legend

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; area?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.area ? (
            <span className="h-2.5 w-3.5 rounded-[3px]" style={{ background: it.color }} />
          ) : (
            <span
              className="h-0 w-4"
              style={{ borderTop: `2px ${it.dashed ? 'dashed' : 'solid'} ${it.color}` }}
            />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- throughput

const SEGMENT_KEYS = [
  { key: 'anomaly', label: 'Opened by a monitor', color: 'var(--series-1)' },
  { key: 'question', label: 'Asked by a person', color: 'var(--series-2)' },
  { key: 'scheduled', label: 'Scheduled', color: 'var(--series-3)' },
] as const;

export function ThroughputChart({
  data,
}: {
  data: { date: string; anomaly: number; question: number; scheduled: number }[];
}) {
  const [box, W] = useMeasuredWidth<HTMLDivElement>(380);
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const H = 210;
  const pad = { l: 24, r: 4, t: 14, b: 22 };
  const totals = data.map((d) => d.anomaly + d.question + d.scheduled);
  const max = Math.max(2, Math.ceil(Math.max(0, ...totals) / 2) * 2);
  const innerH = H - pad.t - pad.b;
  const step = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(26, step * 0.62);
  const base = pad.t + innerH;
  const y = (v: number) => base - (v / max) * innerH;
  const total = totals.reduce((a, b) => a + b, 0);
  const show = inView || reduce;
  const h = hover == null ? null : data[hover];

  return (
    <div ref={box}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {total}
          <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">in 14 days</span>
        </p>
        <p className="min-h-[1rem] text-right text-[11px] text-[var(--text-secondary)]">
          {h
            ? `${formatShortDate(h.date)}: ${h.anomaly} monitor, ${h.question} asked, ${h.scheduled} scheduled`
            : 'Hover a bar'}
        </p>
      </div>
      <svg ref={ref} width={W} height={H} className="block" role="img" aria-label="Investigations per day by trigger">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const cx = pad.l + step * i + (step - barW) / 2;
          return (
            <g
              key={d.date}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              opacity={hover == null || hover === i ? 1 : 0.45}
              style={{ transition: 'opacity 150ms' }}
            >
              <rect x={pad.l + step * i} y={pad.t} width={step} height={innerH} fill="transparent" />
              {SEGMENT_KEYS.map((s) => {
                const v = d[s.key];
                const y0 = y(acc + v);
                const hgt = y(acc) - y0;
                acc += v;
                if (v === 0) return null;
                return (
                  <motion.rect
                    key={s.key}
                    x={cx}
                    width={barW}
                    rx={2}
                    fill={s.color}
                    initial={reduce ? false : { y: base, height: 0 }}
                    animate={show ? { y: y0, height: Math.max(0, hgt - 1) } : {}}
                    transition={{ duration: 0.7, delay: 0.04 * i, ease: EASE }}
                  />
                );
              })}
              {(i % 2 === 0 || data.length <= 8) && (
                <text x={cx + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                  {formatShortDate(d.date).replace(/^\w+ /, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-3">
        <Legend items={SEGMENT_KEYS.map((s) => ({ label: s.label, color: s.color, area: true }))} />
      </div>
    </div>
  );
}

// --------------------------------------------------------------- segment bars

export function SegmentBars({
  data,
  format = 'currency',
}: {
  data: { segment: string; current: number; previous: number }[];
  format?: 'currency' | 'count';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const max = Math.max(1, ...data.flatMap((d) => [d.current, d.previous]));
  const fmt = (v: number) => (format === 'currency' ? formatCurrency(v) : v.toLocaleString('en-US'));
  const show = inView || reduce;
  return (
    <div ref={ref} className="space-y-4">
      {data.map((d, i) => {
        const delta = d.previous ? d.current / d.previous - 1 : 0;
        const down = delta < 0;
        return (
          <div key={d.segment}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium capitalize">{d.segment}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{fmt(d.current)}</span>
                <span className={`ml-2 text-xs ${down ? 'text-[var(--text-bad)]' : 'text-[var(--text-secondary)]'}`}>
                  {delta >= 0 ? '+' : '-'}
                  {Math.abs(delta * 100).toFixed(1)}%
                </span>
              </span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--grid)]">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: down ? 'var(--status-critical)' : 'var(--series-1)' }}
                initial={reduce ? false : { width: 0 }}
                animate={show ? { width: `${(d.current / max) * 100}%` } : {}}
                transition={{ duration: 0.9, delay: 0.08 * i, ease: EASE }}
              />
              <motion.div
                className="absolute inset-y-[-2px] w-[2px] bg-[var(--text-muted)]"
                title={`Previous: ${fmt(d.previous)}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={show ? { opacity: 1 } : {}}
                transition={{ delay: 0.9 + 0.08 * i }}
                style={{ left: `calc(${(d.previous / max) * 100}% - 1px)` }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--text-muted)]">Bar: this period. Tick: previous period.</p>
    </div>
  );
}

// -------------------------------------------------------------------- heatmap

/** Severity bands of the anomaly detector (|z| 3..4 warning, 4..6 serious, 6+ critical). */
export function severityForZ(z: number, threshold = 3): 'critical' | 'serious' | 'warning' | null {
  if (z >= 6) return 'critical';
  if (z >= 4) return 'serious';
  if (z >= threshold) return 'warning';
  return null;
}

function cellStyle(v: number, threshold: number) {
  const sev = severityForZ(v, threshold);
  if (sev) {
    const alpha = sev === 'critical' ? 1 : sev === 'serious' ? 0.72 : 0.46;
    return { background: 'var(--status-critical)', opacity: alpha, glow: sev === 'critical' };
  }
  return { background: 'var(--series-1)', opacity: 0.05 + Math.min(1, v / threshold) * 0.28, glow: false };
}

export function AnomalyHeatmap({
  metrics,
  days,
  cells,
  threshold = 3,
  highlightDay,
}: {
  metrics: string[];
  days: string[];
  cells: number[][];
  threshold?: number;
  highlightDay?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const play = useSound();
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const STEP = 0.018;
  const order = (r: number, c: number) => c * metrics.length + r;

  // Soft "evidence" ticks as flagged cells appear, throttled so they never pile up.
  const flaggedCells = useMemo(
    () =>
      cells.flatMap((row, r) =>
        row.map((v, c) => ({ r, c, v })).filter((x) => x.v >= threshold),
      ),
    [cells, threshold],
  );
  useEffect(() => {
    if (!inView || reduce) return;
    const tick = makeThrottle(110);
    const timers = flaggedCells.map(({ r, c }) =>
      window.setTimeout(
        () => tick(() => play('evidence', { pan: (c / Math.max(1, days.length - 1)) * 1.6 - 0.8 })),
        order(r, c) * STEP * 1000 + 120,
      ),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // play is stable per mute state; re-running on mute toggle is not wanted.
  }, [inView, reduce, flaggedCells]);

  const h = hover ? { metric: metrics[hover.r]!, day: days[hover.c]!, v: cells[hover.r]![hover.c]! } : null;
  const hl = highlightDay ? days.indexOf(highlightDay) : -1;
  const show = inView || reduce;

  return (
    <div ref={ref}>
      <div className="mb-3 flex min-h-[1.25rem] flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">
          {h ? (
            <>
              <span className="font-medium text-[var(--text-primary)]">{h.metric}</span> on {formatShortDate(h.day)}:{' '}
              <span className="tabular-nums font-semibold">|z| {h.v.toFixed(1)}</span>
              {severityForZ(h.v, threshold) && (
                <span className="ml-1.5 text-[var(--text-bad)]">{severityForZ(h.v, threshold)}</span>
              )}
            </>
          ) : (
            'Each square is one day. Red means the detector flagged it.'
          )}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[520px] items-center gap-[3px]"
          style={{ gridTemplateColumns: `minmax(92px,auto) repeat(${days.length}, minmax(0,1fr))` }}
          onMouseLeave={() => setHover(null)}
        >
          {metrics.map((m, r) => (
            <div key={m} className="contents">
              <div className="truncate pr-2 text-xs font-medium text-[var(--text-secondary)]">{m}</div>
              {days.map((d, c) => {
                const v = cells[r]?.[c] ?? 0;
                const s = cellStyle(v, threshold);
                const active = hover?.r === r && hover?.c === c;
                return (
                  <motion.div
                    key={d}
                    onMouseEnter={() => setHover({ r, c })}
                    title={`${m} · ${formatShortDate(d)} · |z| ${v.toFixed(1)}`}
                    className={`relative h-9 rounded-[5px] sm:h-11 ${c === hl ? 'ring-1 ring-[var(--text-bad)] ring-offset-1 ring-offset-[var(--surface)]' : ''}`}
                    style={{
                      background: s.background,
                      boxShadow: s.glow ? '0 0 14px -2px var(--status-critical)' : undefined,
                      outline: active ? '2px solid var(--accent)' : undefined,
                      outlineOffset: 1,
                    }}
                    initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                    animate={show ? { opacity: s.opacity, scale: 1 } : {}}
                    transition={{ duration: 0.35, delay: order(r, c) * STEP, ease: EASE }}
                  />
                );
              })}
            </div>
          ))}
          <div />
          {days.map((d, c) => (
            <div
              key={d}
              className={`pt-1 text-center text-[10px] tabular-nums ${c === hl ? 'font-semibold text-[var(--text-bad)]' : 'text-[var(--text-muted)]'}`}
            >
              {c === hl || c % 7 === 0 || c === days.length - 1 ? formatShortDate(d).replace(/^\w+ /, '') : ''}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--series-1)] opacity-20" /> normal
        </span>
        {(['warning', 'serious', 'critical'] as const).map((sev) => (
          <span key={sev} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[3px] bg-[var(--status-critical)]"
              style={{ opacity: sev === 'critical' ? 1 : sev === 'serious' ? 0.72 : 0.46 }}
            />
            {sev}
          </span>
        ))}
        {hl >= 0 && <span className="ml-auto text-[var(--text-bad)]">Outlined: the day revenue broke</span>}
      </div>
    </div>
  );
}
