'use client';

import { useId } from 'react';
import { useReducedMotion } from 'motion/react';
import { CountUp, EASE, motion } from '../../../../../components/motion';
import type {
  CorrelationView,
  EventView,
  ForecastView,
  KpiView,
  RankingView,
  SeriesPoint,
  SliceView,
} from '../../../../../lib/trace';

/**
 * Small hand-rolled SVG charts for the investigation result screen. Colours
 * are CSS tokens only; red (--status-critical) marks the thing that broke.
 * Every chart draws in once when it scrolls into view.
 */

const VIEW = { once: true, margin: '-40px' } as const;

/**
 * "USD" values as currency, everything else as plain numbers. Compact form is
 * hand-rolled (not Intl compact notation) so server and browser render the
 * same text and hydration matches.
 */
export function fmtValue(v: number, unit: string | null | undefined, compact = true): string {
  const usd = unit === 'USD';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (compact && abs >= 10_000) {
    const [n, suffix] = abs >= 1e9 ? [abs / 1e9, 'B'] : abs >= 1e6 ? [abs / 1e6, 'M'] : [abs / 1e3, 'K'];
    return `${sign}${usd ? '$' : ''}${n.toFixed(1)}${suffix}`;
  }
  const digits = usd ? 0 : abs < 10 ? 2 : 0;
  const body = abs.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/\.0+$/, '');
  return `${sign}${usd ? '$' : ''}${body}`;
}

export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return '';
  return `${p > 0 ? '+' : p < 0 ? '-' : ''}${Math.abs(p).toFixed(digits)}%`;
}

export function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ----------------------------------------------------------- confidence

/** Animated ring with the percentage counting up in the middle. */
export function ConfidenceRing({ value, size = 116, label = 'confidence' }: { value: number; size?: number; label?: string }) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(1, value));
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(pct * 100)}% ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth={7} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - pct) }}
          viewport={VIEW}
          transition={{ duration: 1.6, ease: EASE, delay: 0.2 }}
          style={{ filter: 'drop-shadow(0 0 6px var(--glow-strong))' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <CountUp value={pct * 100} format={(n) => `${Math.round(n)}%`} duration={1.6} className="block text-2xl font-semibold tracking-tight" />
          <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
        </div>
      </div>
    </div>
  );
}

/** Thin bar that fills to the confidence when visible. */
export function ConfidenceMeter({ value, className = '' }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={`${pct}% confidence`}>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--grid)]" aria-hidden>
        <motion.span
          className="block h-full rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--glow-strong)]"
          initial={reduce ? false : { width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={VIEW}
          transition={{ duration: 1, ease: EASE, delay: 0.15 }}
        />
      </span>
      <span className="text-xs font-semibold tabular-nums">{pct}%</span>
    </span>
  );
}

// --------------------------------------------------------------- series

/**
 * Daily series with the anomaly day in red (and the expected value as a
 * hollow dot, so the gap is visible). Other anomaly days are small grey dots.
 */
export function SeriesChart({
  series,
  highlight,
  expected,
  others = [],
  unit,
  height = 96,
  bad = true,
}: {
  bad?: boolean;
  series: SeriesPoint[];
  highlight?: string | null;
  expected?: number | null;
  others?: string[];
  unit?: string | null;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  if (series.length < 2) return null;
  const W = 320;
  const H = height;
  const pad = { l: 4, r: 4, t: 10, b: 6 };
  const values = series.map((p) => p.value);
  const min = Math.min(...values, expected ?? Infinity);
  const max = Math.max(...values, expected ?? -Infinity);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const hi = highlight ? series.findIndex((p) => p.date === highlight) : -1;
  const hp = hi >= 0 ? series[hi]! : null;
  const mark = bad ? 'var(--status-critical)' : 'var(--accent)';
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Daily ${series.length} day series${hp ? `, ${shortDay(hp.date)} highlighted at ${fmtValue(hp.value, unit)}` : ''}`}>
        <defs>
          <linearGradient id={`a-${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <motion.path
          d={area}
          fill={`url(#a-${gid})`}
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={VIEW}
          transition={{ duration: 1, delay: 0.6 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={VIEW}
          transition={{ duration: 1.4, ease: EASE }}
        />
        {others.map((d) => {
          const i = series.findIndex((p) => p.date === d);
          if (i < 0) return null;
          return <circle key={d} cx={x(i)} cy={y(series[i]!.value)} r={2.4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1}><title>{`Other anomaly ${shortDay(d)}`}</title></circle>;
        })}
        {hp && (
          <motion.g
            initial={reduce ? false : { opacity: 0, scale: 0.4 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={VIEW}
            transition={{ duration: 0.5, delay: 1.3, ease: EASE }}
            style={{ transformOrigin: `${x(hi)}px ${y(hp.value)}px` }}
          >
            <line x1={x(hi)} x2={x(hi)} y1={0} y2={H} stroke={mark} strokeOpacity={0.35} strokeDasharray="2 3" />
            {expected != null && (
              <>
                <line x1={x(hi)} x2={x(hi)} y1={y(expected)} y2={y(hp.value)} stroke={mark} strokeWidth={1.5} />
                <circle cx={x(hi)} cy={y(expected)} r={3} fill="var(--surface)" stroke="var(--text-secondary)" strokeWidth={1.2}>
                  <title>{`Expected ${fmtValue(expected, unit, false)}`}</title>
                </circle>
              </>
            )}
            <circle cx={x(hi)} cy={y(hp.value)} r={8} fill={mark} opacity={0.18} className="helix-ping" style={{ transformOrigin: `${x(hi)}px ${y(hp.value)}px` }} />
            <circle cx={x(hi)} cy={y(hp.value)} r={3.8} fill={mark} stroke="var(--surface)" strokeWidth={1.5}>
              <title>{`${shortDay(hp.date)}: ${fmtValue(hp.value, unit, false)}`}</title>
            </circle>
          </motion.g>
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--text-muted)]">
        <span>{shortDay(series[0]!.date)}</span>
        <span>{series.length} days</span>
        <span>{shortDay(series[series.length - 1]!.date)}</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- bars

/** Observed vs expected as two horizontal bars; observed is red when it is a drop. */
export function ValueVsExpected({
  value,
  expected,
  unit,
  bad = true,
  labels = ['Actual', 'Expected'],
}: {
  value: number;
  expected: number;
  unit?: string | null;
  bad?: boolean;
  labels?: [string, string];
}) {
  const reduce = useReducedMotion();
  const max = Math.max(Math.abs(value), Math.abs(expected)) || 1;
  const rows = [
    { label: labels[0], v: value, color: bad ? 'var(--status-critical)' : 'var(--series-1)' },
    { label: labels[1], v: expected, color: 'var(--series-1-soft)' },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
          <span className="text-[var(--text-muted)]">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-[var(--grid)]">
            <motion.span
              className="block h-full rounded-full"
              style={{ background: r.color }}
              initial={reduce ? false : { width: 0 }}
              whileInView={{ width: `${(Math.abs(r.v) / max) * 100}%` }}
              viewport={VIEW}
              transition={{ duration: 0.9, ease: EASE, delay: 0.15 + i * 0.12 }}
            />
          </span>
          <span className="font-medium tabular-nums">{fmtValue(r.v, unit)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Diverging bars of each slice's change against expected. The slice that
 * carries the drop is red, the rest are monochrome.
 */
export function DeltaBars({
  slices,
  unit,
  highlight,
  neutral = false,
}: {
  slices: SliceView[];
  unit?: string | null;
  highlight?: string | null;
  neutral?: boolean;
}) {
  const reduce = useReducedMotion();
  const max = Math.max(...slices.map((s) => Math.abs(s.delta)), 1);
  const sorted = [...slices].sort((a, b) => a.delta - b.delta);
  return (
    <ul className="space-y-1.5">
      {sorted.map((s, i) => {
        const hot = !neutral && s.value === highlight;
        const w = (Math.abs(s.delta) / max) * 50;
        const color = hot ? 'var(--status-critical)' : neutral ? 'var(--series-2)' : 'var(--series-1)';
        return (
          <li key={s.value} className="grid grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-2 text-[11px]">
            <span className={`truncate ${hot ? 'font-semibold text-[var(--text-bad)]' : 'text-[var(--text-secondary)]'}`} title={s.value}>
              {s.value.replace(/_/g, ' ')}
            </span>
            <span className="relative h-3">
              <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" aria-hidden />
              <motion.span
                className="absolute inset-y-0 rounded-sm"
                style={{
                  background: color,
                  boxShadow: hot ? '0 0 10px var(--status-critical)' : undefined,
                  ...(s.delta < 0 ? { right: '50%' } : { left: '50%' }),
                }}
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${w}%` }}
                viewport={VIEW}
                transition={{ duration: 0.8, ease: EASE, delay: 0.2 + i * 0.1 }}
              />
            </span>
            <span className={`text-right tabular-nums ${hot ? 'font-semibold text-[var(--text-bad)]' : 'text-[var(--text-secondary)]'}`}>
              {s.deltaPercent != null ? fmtPct(s.deltaPercent) : fmtValue(s.delta, unit)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------- timeline

/**
 * 72 hour strip (the day before, the anomaly day, the day after) with the
 * drop day shaded red and each event placed at its real UTC time.
 */
export function EventTimeline({ day, main, others = [] }: { day: string; main: EventView; others?: EventView[] }) {
  const reduce = useReducedMotion();
  const start = new Date(`${day.slice(0, 10)}T00:00:00Z`).getTime() - 24 * 3600_000;
  const spanH = 72;
  const pos = (iso: string) => {
    const h = (new Date(iso).getTime() - start) / 3600_000;
    return Number.isFinite(h) ? Math.max(0, Math.min(100, (h / spanH) * 100)) : null;
  };
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const mainPos = pos(main.time);
  const dayLabel = (offset: number) => shortDay(new Date(start + offset * 24 * 3600_000).toISOString());
  return (
    <div className="pt-7" role="img" aria-label={`${main.label} at ${clock(main.time)} UTC on ${shortDay(main.time)}, against the anomaly day ${shortDay(day)}`}>
      <div className="relative h-8 rounded-md bg-[var(--surface-2)] ring-1 ring-[var(--border)]">
        <div className="absolute inset-y-0 left-1/3 w-1/3 bg-[var(--anomaly-fill)] ring-1 ring-[var(--status-critical)]/30" aria-hidden />
        {[1, 2].map((i) => (
          <span key={i} className="absolute inset-y-0 w-px bg-[var(--border-strong)]" style={{ left: `${(i / 3) * 100}%` }} aria-hidden />
        ))}
        {others.map((e) => {
          const p = pos(e.time);
          if (p == null) return null;
          return (
            <span key={`${e.label}-${e.time}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--series-2)] bg-[var(--surface)]" style={{ left: `${p}%` }} title={`${e.label} at ${clock(e.time)} UTC ${shortDay(e.time)}`} />
          );
        })}
        {mainPos != null && (
          <motion.div
            className="absolute inset-y-[-6px] -translate-x-1/2"
            style={{ left: `${mainPos}%` }}
            initial={reduce ? false : { opacity: 0, y: -10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VIEW}
            transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
          >
            <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--accent-contrast)] shadow-[0_0_12px_var(--glow-strong)]">
              {clock(main.time)} UTC
            </span>
            <span className="mx-auto block h-full w-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--glow-strong)]" />
          </motion.div>
        )}
      </div>
      <div className="mt-1 grid grid-cols-3 text-center text-[10px] text-[var(--text-muted)]">
        <span>{dayLabel(0)}</span>
        <span className="font-semibold text-[var(--text-bad)]">{dayLabel(1)} (drop)</span>
        <span>{dayLabel(2)}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------- small visuals

export function ForecastChart({ forecast }: { forecast: ForecastView }) {
  const reduce = useReducedMotion();
  const pts = forecast.points;
  if (pts.length < 2) return null;
  const W = 320;
  const H = 72;
  const lo = Math.min(...pts.map((p) => p.lower ?? p.value));
  const hi = Math.max(...pts.map((p) => p.upper ?? p.value));
  const span = hi - lo || 1;
  const x = (i: number) => 4 + (i / (pts.length - 1)) * (W - 8);
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (H - 12);
  const band = [
    ...pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.upper ?? p.value)}`),
    ...[...pts].reverse().map((p, j) => `L${x(pts.length - 1 - j)},${y(p.lower ?? p.value)}`),
    'Z',
  ].join(' ');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Forecast of ${forecast.metricName} for ${pts.length} days`}>
        <path d={band} fill="var(--band)" />
        <motion.path d={line} fill="none" stroke="var(--series-1)" strokeWidth={1.4} strokeDasharray="4 3" initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={VIEW} transition={{ duration: 1.2, ease: EASE }} />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--text-muted)]">
        <span>{shortDay(pts[0]!.date)}</span>
        <span>{forecast.method ?? 'forecast'}{forecast.mape != null ? `, backtest error ${forecast.mape.toFixed(1)}%` : ''}</span>
        <span>{shortDay(pts[pts.length - 1]!.date)}</span>
      </figcaption>
    </figure>
  );
}

export function CorrelationScale({ correlation }: { correlation: CorrelationView }) {
  const reduce = useReducedMotion();
  const p = ((correlation.coefficient + 1) / 2) * 100;
  return (
    <div role="img" aria-label={`Correlation ${correlation.coefficient.toFixed(2)}`}>
      <div className="relative h-2 rounded-full bg-[var(--grid)]">
        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
        <span className="absolute inset-y-0 rounded-full bg-[var(--band)]" style={{ left: '0%', width: '25%' }} />
        <span className="absolute inset-y-0 rounded-full bg-[var(--band)]" style={{ left: '75%', width: '25%' }} />
        <motion.span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] shadow-[0_0_8px_var(--glow-strong)]"
          initial={reduce ? false : { left: '50%' }}
          whileInView={{ left: `${p}%` }}
          viewport={VIEW}
          transition={{ duration: 1, ease: EASE }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>-1 opposite</span>
        <span className="font-semibold tabular-nums text-[var(--text-primary)]">{correlation.coefficient > 0 ? '+' : ''}{correlation.coefficient.toFixed(2)}</span>
        <span>+1 together</span>
      </div>
    </div>
  );
}

export function RankingBars({ ranking }: { ranking: RankingView }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative space-y-1.5">
      {ranking.candidates.map((c, i) => (
        <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2 text-[11px]">
          <div className="relative h-5 overflow-hidden rounded-md bg-[var(--grid)]">
            <motion.div
              className={`absolute inset-y-0 left-0 rounded-md ${c.selected ? 'bg-[var(--accent)] shadow-[0_0_12px_var(--glow-strong)]' : 'bg-[var(--series-1-soft)]'}`}
              initial={reduce ? false : { width: 0 }}
              whileInView={{ width: `${c.score * 100}%` }}
              viewport={VIEW}
              transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.12 }}
            />
            <span className={`relative z-10 block truncate px-2 leading-5 ${c.selected ? 'font-semibold text-[var(--accent-contrast)]' : 'text-[var(--text-secondary)]'}`} title={c.statement}>
              {c.day ?? c.statement}
            </span>
            {ranking.threshold != null && (
              <span className="absolute inset-y-0 z-20 w-px bg-[var(--text-primary)] opacity-60" style={{ left: `${ranking.threshold * 100}%` }} title={`Threshold ${Math.round(ranking.threshold * 100)}%`} />
            )}
          </div>
          <span className="text-right font-semibold tabular-nums">{Math.round(c.score * 100)}%</span>
        </div>
      ))}
      {ranking.threshold != null && (
        <p className="text-[10px] text-[var(--text-muted)]">Line = {Math.round(ranking.threshold * 100)}% bar a candidate must clear</p>
      )}
    </div>
  );
}

export function KpiCompare({ kpi }: { kpi: KpiView }) {
  if (kpi.baseline == null) return <p className="text-lg font-semibold tabular-nums">{fmtValue(kpi.value, kpi.unit)}</p>;
  return (
    <ValueVsExpected
      value={kpi.value}
      expected={kpi.baseline}
      unit={kpi.unit}
      bad={(kpi.changePercent ?? 0) < -15}
      labels={['This week', 'Last week']}
    />
  );
}
