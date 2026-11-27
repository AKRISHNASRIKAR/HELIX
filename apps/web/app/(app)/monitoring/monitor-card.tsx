'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Monitor, MonitorAnomaly, MonitorRunResult, MonitorSeries } from '../../../lib/api';
import { runMonitorNow } from '../../../lib/actions/monitors';
import {
  anomalyChange,
  asMonitorAnomaly,
  buildSparkline,
  describeAggregation,
  formatMetric,
  monitorStatusLabel,
  monitorStatusTone,
  radarBlips,
  runOutcome,
  severityMeta,
  shiftDay,
  type MonitorTone,
} from '../../../lib/monitoring';
import { formatDelta, formatRelative, formatShortDate, formatUtcDay } from '../../../lib/format';
import { audioUnlocked } from '../../../lib/sound';
import { useSound } from '../../../components/experience';
import { CountUp, EASE } from '../../../components/motion';
import { POLL_EVENT } from '../../../components/notification-toaster';
import { buttonClass, linkClass } from '../../../components/ui';
import { useMonitorLive, type LivePhase } from './monitoring-live';
import { DeleteMonitorButton, MonitorToggle } from './monitor-actions';

const TONE: Record<MonitorTone, { dot: string; text: string }> = {
  good: { dot: 'bg-[var(--status-good)]', text: 'text-[var(--text-good)]' },
  warn: { dot: 'bg-[var(--status-critical)]', text: 'text-[var(--text-primary)]' },
  bad: { dot: 'bg-[var(--status-critical)]', text: 'text-[var(--text-bad)]' },
  info: { dot: 'bg-[var(--accent)]', text: 'text-[var(--text-primary)]' },
  muted: { dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-muted)]' },
};

const SWEEP_IDLE_S = 4.5;
const SWEEP_FAST_S = 1.1;
const MIN_SCAN_MS = 2_200;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ radar */

function Radar({ series, fast, alert }: { series: MonitorSeries | null; fast: boolean; alert: boolean }) {
  const reduce = useReducedMotion();
  const blips = useMemo(() => (series ? radarBlips(series.series, series.anomalies) : []), [series]);
  const picked = series?.picked?.date ?? null;
  return (
    <div className="relative aspect-square w-full max-w-[148px] shrink-0" aria-hidden>
      <div
        className={`absolute inset-0 rounded-full border bg-[var(--surface-2)] transition-[border-color,box-shadow] duration-500 ${
          alert ? 'border-[var(--status-critical)] shadow-[0_0_40px_-6px_var(--status-critical)]' : 'border-[var(--border-strong)] shadow-[inset_0_0_30px_var(--glow)]'
        }`}
      />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        {[32, 62, 92].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray={r === 92 ? undefined : '2 4'} />
        ))}
        <path d="M100 6v188M6 100h188" stroke="var(--border)" strokeWidth="1" />
      </svg>
      {!reduce && (
        <motion.div
          key={fast ? 'fast' : 'idle'}
          className="absolute inset-[3%] rounded-full"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg 290deg, var(--glow) 320deg, ${alert ? 'var(--status-critical)' : 'var(--glow-strong)'} 360deg)`,
            maskImage: 'radial-gradient(circle, var(--text-primary) 69%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(circle, var(--text-primary) 69%, transparent 70%)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: fast ? SWEEP_FAST_S : SWEEP_IDLE_S, repeat: Infinity, ease: 'linear' }}
        />
      )}
      {blips.map((b) => {
        const isPicked = b.date === picked;
        const rad = ((b.angle - 90) * Math.PI) / 180;
        const left = 50 + Math.cos(rad) * b.radius * 46;
        const top = 50 + Math.sin(rad) * b.radius * 46;
        const color = isPicked ? 'var(--status-critical)' : 'var(--text-secondary)';
        return (
          <span
            key={b.date}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            {isPicked && <span className="helix-ping absolute inset-0 rounded-full" style={{ background: color }} />}
            <span
              className={`relative block rounded-full ${isPicked ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5 opacity-70'}`}
              style={{ background: color, boxShadow: isPicked ? '0 0 10px 2px var(--status-critical)' : undefined }}
            />
          </span>
        );
      })}
      <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
    </div>
  );
}

/* -------------------------------------------------------------- sparkline */

const W = 600;
const H = 120;

function Sparkline({ data, scanning, unit }: { data: MonitorSeries; scanning: boolean; unit: string | null | undefined }) {
  const reduce = useReducedMotion();
  const spark = useMemo(() => buildSparkline(data.series, W, H, 8), [data]);
  const windowStart = shiftDay(data.seriesEnd, data.lookbackDays);
  const x0 = windowStart ? (spark.xOf(windowStart) ?? null) : null;
  const x1 = data.seriesEnd ? spark.xOf(data.seriesEnd) : null;
  const picked = data.picked;
  const px = picked ? spark.xOf(picked.date) : null;
  const py = picked ? spark.yOf(picked.value) : null;
  const pe = picked ? spark.yOf(Math.min(Math.max(picked.expectedValue, spark.min), spark.max)) : null;
  const others = data.anomalies.filter((a) => a.date !== picked?.date);
  const first = data.series[0]?.date;
  const last = data.series[data.series.length - 1]?.date;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const gradId = `spark-${data.monitorId}`;

  return (
    <figure className="relative">
      <div className="relative h-[120px] w-full">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--series-1)', stopOpacity: 0.18 }} />
              <stop offset="100%" style={{ stopColor: 'var(--series-1)', stopOpacity: 0 }} />
            </linearGradient>
            {/* Draws the line left to right (pathLength breaks with non-scaling strokes). */}
            <clipPath id={`${gradId}-clip`}>
              <motion.rect
                x="-10"
                y="-10"
                height={H + 20}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: W + 20 }}
                transition={{ duration: 1.6, ease: EASE }}
              />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {x0 != null && x1 != null && <rect x={x0} y="0" width={Math.max(2, x1 - x0)} height={H} fill="var(--band)" />}
          <motion.path
            d={spark.area}
            fill={`url(#${gradId})`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.4 }}
          />
          <path
            d={spark.line}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            clipPath={`url(#${gradId}-clip)`}
          />
          {px != null && py != null && pe != null && (
            <>
              <line x1={px} x2={px} y1="0" y2={H} stroke="var(--status-critical)" strokeWidth="1" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
              <line x1={px} x2={px} y1={pe} y2={py} stroke="var(--status-critical)" strokeWidth="2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>

        {/* Markers in HTML so they stay round while the SVG stretches. */}
        {others.map((a) => {
          const x = spark.xOf(a.date);
          if (x == null) return null;
          return (
            <span
              key={a.date}
              title={`${severityMeta(a.severity).label} ${a.direction} on ${formatUtcDay(a.date)}`}
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--text-secondary)] bg-[var(--surface)]"
              style={{ left: pct(x, W), top: pct(spark.yOf(a.value), H) }}
            />
          );
        })}
        {picked && px != null && py != null && pe != null && (
          <>
            <span
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[var(--status-critical)]"
              style={{ left: pct(px, W), top: pct(pe, H) }}
              title="Expected"
            />
            <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(px, W), top: pct(py, H) }}>
              <span className="helix-ping absolute inset-0 rounded-full bg-[var(--status-critical)]" />
              <span className="relative block h-3 w-3 rounded-full bg-[var(--status-critical)] shadow-[0_0_14px_3px_var(--status-critical)]" />
            </span>
            <span
              className={`absolute top-0 whitespace-nowrap rounded-md border border-[var(--status-critical)]/50 bg-[var(--anomaly-fill)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-bad)] backdrop-blur ${
                px > W * 0.7 ? '-translate-x-[calc(100%+8px)]' : 'translate-x-2'
              }`}
              style={{ left: pct(px, W) }}
            >
              {severityMeta(picked.severity).glyph} {formatShortDate(picked.date)}
              {anomalyChange(picked) != null && ` · ${formatDelta(anomalyChange(picked)!)}`}
            </span>
          </>
        )}

        {scanning && !reduce && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 w-[2px] bg-[var(--accent)]"
            style={{ boxShadow: '0 0 18px 4px var(--glow-strong)' }}
            initial={{ left: '0%', opacity: 0 }}
            animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>
      <figcaption className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--text-muted)] tabular-nums">
        <span>{first ? formatShortDate(first) : ''}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-[var(--band)]" /> watch window, last {data.lookbackDays}d
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full border border-[var(--text-secondary)]" /> other anomalies
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <span className="h-2 w-2 rounded-full bg-[var(--status-critical)]" /> acted on
          </span>
        </span>
        <span>{last ? formatShortDate(last) : ''}</span>
      </figcaption>
      <span className="sr-only">
        Daily series of {data.monitorName} from {first} to {last}
        {picked ? `, anomaly on ${picked.date}: ${formatMetric(picked.value, unit)} vs expected ${formatMetric(picked.expectedValue, unit)}` : ', no anomaly in the watch window'}
      </span>
    </figure>
  );
}

/* ---------------------------------------------------------- run sequence */

type Seq =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'found' | 'opening' | 'opened' | 'deduped' | 'limited'; result: MonitorRunResult; anomaly: MonitorAnomaly }
  | { phase: 'clear'; result: MonitorRunResult }
  | { phase: 'error'; message: string };

function AnomalyHit({ anomaly, unit }: { anomaly: MonitorAnomaly; unit: string | null | undefined }) {
  const reduce = useReducedMotion();
  const sev = severityMeta(anomaly.severity);
  const change = anomalyChange(anomaly);
  const fmt = (n: number) => formatMetric(n, unit);
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, x: 40, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE }}
      className="rounded-xl border border-[var(--status-critical)]/50 bg-[var(--anomaly-fill)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: sev.color }}>
          <span aria-hidden>{sev.glyph}</span> {sev.label} {anomaly.direction}
        </p>
        <p className="text-xs font-medium text-[var(--text-secondary)]">{formatUtcDay(anomaly.date)}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Actual</p>
          <CountUp value={anomaly.value} format={fmt} className="text-4xl font-semibold tracking-tight text-[var(--text-bad)]" />
        </div>
        <div className="pb-1 text-[var(--text-muted)]">vs</div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Expected</p>
          <CountUp value={anomaly.expectedValue} format={fmt} className="text-2xl font-semibold tracking-tight text-[var(--text-secondary)]" />
        </div>
        {change != null && (
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Change</p>
            <CountUp
              value={change * 100}
              format={(n) => formatDelta(n / 100)}
              className={`text-3xl font-semibold tracking-tight ${change < 0 ? 'text-[var(--text-bad)]' : 'text-[var(--text-primary)]'}`}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function DedupeDiagram({ anomaly, investigationId, monitorName }: { anomaly: MonitorAnomaly; investigationId?: string | null; monitorName: string }) {
  const reduce = useReducedMotion();
  const node = 'rounded-lg border px-2.5 py-2 text-[11px] leading-tight';
  const arrow = (delay: number) => (
    <motion.span
      aria-hidden
      className="relative h-px flex-1 min-w-4 bg-[var(--border-strong)]"
      initial={reduce ? false : { scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      style={{ transformOrigin: 'left' }}
    >
      <span className="absolute -right-0.5 -top-[3px] h-[7px] w-[7px] rotate-45 border-r border-t border-[var(--border-strong)]" />
    </motion.span>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`${node} border-[var(--status-critical)]/50 bg-[var(--anomaly-fill)]`}>
          <p className="font-semibold text-[var(--text-bad)]">This run</p>
          <p className="text-[var(--text-secondary)]">
            {anomaly.direction} on {formatShortDate(anomaly.date)}
          </p>
        </motion.div>
        {arrow(0.2)}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className={`${node} border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] font-mono`}
        >
          <p className="font-sans font-semibold text-[var(--text-primary)]">Same key</p>
          <p className="text-[var(--text-secondary)]">
            {monitorName} · {anomaly.date} · {anomaly.direction}
          </p>
        </motion.div>
        {arrow(0.55)}
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7, type: 'spring', stiffness: 300, damping: 20 }}
          className={`${node} border-[var(--accent)] bg-[var(--surface-raised)] shadow-[0_0_24px_-6px_var(--glow-strong)]`}
        >
          <p className="font-semibold text-[var(--text-primary)]">1 investigation</p>
          <p className="text-[var(--text-secondary)]">{investigationId ? 'already open' : 'cooling down'}</p>
        </motion.div>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        Same anomaly, same investigation. HELIX never opens a duplicate, so your team is not paged twice for one problem.
      </p>
    </div>
  );
}

function OutcomeBanner({ icon, title, body, tone }: { icon: 'check' | 'x' | 'pause'; title: string; body?: string; tone: 'good' | 'bad' | 'muted' }) {
  const reduce = useReducedMotion();
  const color = tone === 'good' ? 'var(--status-good)' : tone === 'bad' ? 'var(--status-critical)' : 'var(--text-secondary)';
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
    >
      <motion.span
        initial={reduce ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 16 }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2"
        style={{ borderColor: color, color, boxShadow: `0 0 24px -6px ${color}` }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {icon === 'check' ? (
            <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.15 }} />
          ) : icon === 'x' ? (
            <path d="M6 6l12 12M18 6 6 18" />
          ) : (
            <path d="M9 6v12M15 6v12" />
          )}
        </svg>
      </motion.span>
      <div className="min-w-0">
        <p className="text-lg font-semibold tracking-tight">{title}</p>
        {body && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{body}</p>}
      </div>
    </motion.div>
  );
}

function WatchLinks({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/investigations/${id}?play=1`} className={`${buttonClass('primary', 'sm')} !px-4 !py-2 !text-sm`}>
        <span className="relative inline-flex h-2 w-2" aria-hidden>
          <span className="helix-ping absolute inset-0 rounded-full bg-[var(--accent-contrast)]" />
          <span className="relative h-2 w-2 rounded-full bg-[var(--accent-contrast)]" />
        </span>
        Watch it run →
      </Link>
      <Link href={`/investigations/${id}`} className={`text-xs ${linkClass}`}>
        Open the result
      </Link>
    </div>
  );
}

function RunSequence({ seq, unit, monitorName, onReset }: { seq: Seq; unit: string | null | undefined; monitorName: string; onReset: () => void }) {
  const reduce = useReducedMotion();
  if (seq.phase === 'idle') return null;
  return (
    <motion.div
      key="seq"
      initial={reduce ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="space-y-3 border-t border-[var(--border)] pt-4" aria-live="polite">
        {seq.phase === 'scanning' && (
          <div className="flex items-center gap-3">
            <span className="relative grid h-9 w-9 place-items-center">
              <span className="helix-ping absolute inset-0 rounded-full bg-[var(--glow-strong)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Scanning {monitorName}</p>
              <p className="text-xs text-[var(--text-muted)]">Comparing every day to what was expected...</p>
              <div className="helix-shimmer mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]" />
            </div>
          </div>
        )}

        {'anomaly' in seq && <AnomalyHit anomaly={seq.anomaly} unit={unit} />}

        {seq.phase === 'opening' && (
          <div>
            <p className="text-sm font-semibold">Opening investigation</p>
            <p className="text-xs text-[var(--text-muted)]">Handing it to the Analytics, Finance, Customer and Product agents</p>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <motion.div
                className="helix-shimmer absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
                style={{ boxShadow: '0 0 16px var(--glow-strong)' }}
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: reduce ? 0 : 1.6, ease: EASE }}
              />
            </div>
          </div>
        )}

        {seq.phase === 'opened' && seq.result.investigationId && (
          <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            <p className="text-sm font-semibold">Investigation opened. Your team was notified.</p>
            <WatchLinks id={seq.result.investigationId} />
          </motion.div>
        )}

        {seq.phase === 'deduped' && (
          <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <p className="text-lg font-semibold tracking-tight">Already investigated</p>
            <DedupeDiagram anomaly={seq.anomaly} investigationId={seq.result.investigationId} monitorName={monitorName} />
            {seq.result.investigationId ? <WatchLinks id={seq.result.investigationId} /> : <p className="text-xs text-[var(--text-muted)]">{seq.result.message}</p>}
          </motion.div>
        )}

        {seq.phase === 'limited' && <OutcomeBanner icon="pause" tone="muted" title="Daily limit reached" body={seq.result.message} />}
        {seq.phase === 'clear' && <OutcomeBanner icon="check" tone="good" title="All clear" body={seq.result.message} />}
        {seq.phase === 'error' && <OutcomeBanner icon="x" tone="bad" title="Run failed" body={seq.message} />}

        {seq.phase !== 'scanning' && seq.phase !== 'found' && seq.phase !== 'opening' && (
          <button type="button" onClick={onReset} className={`text-xs ${linkClass}`}>
            Done
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ card */

export function MonitorCard({ monitor, series, sound }: { monitor: Monitor; series: MonitorSeries | null; sound: boolean }) {
  const [seq, setSeq] = useState<Seq>({ phase: 'idle' });
  const [flash, setFlash] = useState(0);
  const play = useSound();
  const { set: setLive } = useMonitorLive();
  const reduce = useReducedMotion();
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const publish = useCallback(
    (phase: LivePhase, detail: string | null = null) => setLive({ monitorName: monitor.name, phase, detail }),
    [monitor.name, setLive],
  );

  // Ambient sweep sound: occasional, only while the tab is visible and audio is unlocked.
  useEffect(() => {
    if (!sound) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && audioUnlocked() && !running.current) play('scan');
    }, SWEEP_IDLE_S * 2 * 1000);
    return () => window.clearInterval(id);
  }, [sound, play]);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSeq({ phase: 'scanning' });
    publish('scanning');
    play('scan');
    const started = Date.now();
    const scanTick = window.setInterval(() => play('scan'), 700);
    let res: Awaited<ReturnType<typeof runMonitorNow>>;
    try {
      res = await runMonitorNow(monitor.id);
    } catch (err) {
      res = { ok: false, error: (err as Error).message || 'The run failed.' };
    }
    await wait(Math.max(0, MIN_SCAN_MS - (Date.now() - started)));
    window.clearInterval(scanTick);
    if (!mounted.current) return;

    try {
      if (!res.ok) {
        setSeq({ phase: 'error', message: res.error });
        publish('error', res.error);
        play('error');
        return;
      }
      const result = res.result;
      const outcome = runOutcome(result.status);
      const anomaly = asMonitorAnomaly(result.anomaly);
      if (outcome === 'clear') {
        setSeq({ phase: 'clear', result });
        publish('clear');
        play('success');
        return;
      }
      if (outcome === 'error' || !anomaly) {
        setSeq({ phase: 'error', message: result.message || monitorStatusLabel(result.status) });
        publish('error', result.message);
        play('error');
        return;
      }
      const detail = `${severityMeta(anomaly.severity).label} ${anomaly.direction} on ${formatUtcDay(anomaly.date)}`;
      setSeq({ phase: 'found', result, anomaly });
      setFlash((f) => f + 1);
      publish('found', detail);
      play('alert');
      await wait(reduce ? 300 : 1_900);
      if (!mounted.current) return;

      if (outcome === 'opened') {
        setSeq({ phase: 'opening', result, anomaly });
        publish('opening', detail);
        play('launch');
        window.dispatchEvent(new Event(POLL_EVENT));
        await wait(reduce ? 200 : 1_700);
        if (!mounted.current) return;
        setSeq({ phase: 'opened', result, anomaly });
        publish('opened', detail);
        play('success');
      } else if (outcome === 'deduped') {
        setSeq({ phase: 'deduped', result, anomaly });
        publish('deduped', detail);
        play('message');
      } else {
        setSeq({ phase: 'limited', result, anomaly });
        publish('limited', detail);
      }
    } finally {
      running.current = false;
    }
  }, [monitor.id, play, publish, reduce]);

  const reset = useCallback(() => {
    setSeq({ phase: 'idle' });
    publish('idle');
  }, [publish]);

  const tone = TONE[monitorStatusTone(monitor.lastStatus)];
  const scanning = seq.phase === 'scanning';
  const alert = seq.phase !== 'idle' && seq.phase !== 'scanning' && 'anomaly' in seq;
  const busy = scanning || seq.phase === 'found' || seq.phase === 'opening';
  const picked = series?.picked ?? null;

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border bg-[var(--surface)] p-5 shadow-[var(--shadow)] transition-[border-color,box-shadow] duration-500 ${
        busy ? 'helix-beam border-[var(--border-strong)] shadow-[var(--shadow-lg)]' : alert ? 'border-[var(--status-critical)]/50' : 'border-[var(--border)] hover:border-[var(--border-strong)]'
      } ${monitor.enabled ? '' : 'opacity-80'}`}
      aria-label={`Monitor ${monitor.name}`}
    >
      <AnimatePresence>
        {flash > 0 && !reduce && (
          <motion.div
            key={flash}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 bg-[var(--status-critical)]"
            initial={{ opacity: 0.35 }}
            animate={{ opacity: [0.35, 0, 0.2, 0] }}
            transition={{ duration: 0.9, times: [0, 0.35, 0.55, 1] }}
            onAnimationComplete={() => setFlash(0)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Radar series={series} fast={scanning} alert={alert} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold tracking-tight">{monitor.name}</h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                {describeAggregation(monitor)} by {monitor.timeColumn} ·{' '}
                {monitor.dataSource ? (
                  <Link href={`/data-sources/${monitor.dataSource.id}`} className={linkClass}>
                    {monitor.dataSource.name}
                  </Link>
                ) : (
                  monitor.dataSourceId.slice(0, 8)
                )}
                .{monitor.tableName}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium ${tone.text}`}>
              <span className="relative inline-flex h-1.5 w-1.5">
                {monitor.enabled && <span className={`helix-ping absolute inset-0 rounded-full ${tone.dot}`} />}
                <span className={`relative h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              </span>
              {monitor.enabled ? monitorStatusLabel(monitor.lastStatus) : 'Paused'}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {[
              { k: 'Last run', v: monitor.lastRunAt ? formatRelative(monitor.lastRunAt) : 'never' },
              { k: 'Threshold', v: `${severityMeta(monitor.minSeverity).glyph} ${severityMeta(monitor.minSeverity).label}+` },
              { k: 'Window', v: `last ${monitor.lookbackDays}d` },
              { k: 'Cooldown', v: `${monitor.cooldownHours}h` },
            ].map((d) => (
              <div key={d.k}>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{d.k}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">{d.v}</dd>
              </div>
            ))}
          </dl>

          {picked && seq.phase === 'idle' && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-bad)]">
                {severityMeta(picked.severity).glyph} {formatUtcDay(picked.date)}
              </span>{' '}
              {formatMetric(picked.value, monitor.unit)} vs expected {formatMetric(picked.expectedValue, monitor.unit)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">
        {series ? (
          <Sparkline data={series} scanning={scanning} unit={monitor.unit} />
        ) : (
          <div className="grid h-[120px] place-items-center rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)]">
            Series unavailable. The analytics engine did not answer.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void run()} disabled={busy} data-silent className={`${buttonClass('primary', 'sm')} !px-4 !py-2 !text-sm`}>
            {busy ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent-contrast)] border-t-transparent" aria-hidden />
                Running...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                  <path d="M7 4.5v15l12-7.5z" />
                </svg>
                Run now
              </>
            )}
          </button>
          {monitor.latestInvestigation && (
            <Link href={`/investigations/${monitor.latestInvestigation.id}`} className={`text-xs ${linkClass}`}>
              Latest investigation ({monitor.investigationsCount ?? 1}) →
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[var(--text-muted)]">{monitor.enabled ? 'On' : 'Off'}</span>
          <MonitorToggle id={monitor.id} name={monitor.name} enabled={monitor.enabled} />
          <DeleteMonitorButton id={monitor.id} name={monitor.name} />
        </div>
      </div>

      <AnimatePresence>{seq.phase !== 'idle' && <RunSequence seq={seq} unit={monitor.unit} monitorName={monitor.name} onReset={reset} />}</AnimatePresence>
    </article>
  );
}
