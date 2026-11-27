'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { AnimatePresence, EASE, LiveDot, motion } from '../../../../../components/motion';
import { useSound } from '../../../../../components/experience';
import type { InvestigationTrace } from '../../../../../lib/api';
import { formatMs } from '../../../../../lib/trace';
import { beatsBetween, buildTimeline, nodePan, stageAt, type Beat } from '../../../../../lib/theater';
import { FindingsFeed } from './findings-feed';
import { Reveal } from './reveal';
import { Stage } from './stage';

const SPEEDS = [0.5, 1, 2] as const;

const clockText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * "Run theater": plays the real run back at watchable speed. The page passes
 * the trace (re-fetched by AutoRefresh while the run is live); playback is a
 * single clock driven by requestAnimationFrame, and everything on stage is
 * derived from it with `stageAt`, so pause, seek, speed and skip stay exact.
 */
export function RunTheater({
  trace,
  investigationId,
  autoplay = true,
}: {
  trace: InvestigationTrace | null;
  investigationId: string;
  autoplay?: boolean;
}) {
  if (!trace) {
    return (
      <TheaterFrame investigationId={investigationId}>
        <div className="grid min-h-[280px] place-items-center p-8 text-center">
          <div>
            <p className="text-lg font-semibold">The run is getting ready</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              The trace is not available yet. This page refreshes while the investigation runs.
            </p>
          </div>
        </div>
      </TheaterFrame>
    );
  }
  return <Theater trace={trace} investigationId={investigationId} autoplay={autoplay} />;
}

function Theater({ trace, investigationId, autoplay }: { trace: InvestigationTrace; investigationId: string; autoplay: boolean }) {
  const timeline = useMemo(() => buildTimeline(trace), [trace]);
  const reduce = useReducedMotion();
  const play = useSound();
  const live = !timeline.complete;

  const [t, setT] = useState(() => (live || reduce ? timeline.total : 0));
  const [playing, setPlaying] = useState(() => !live && !reduce && autoplay);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [run, setRun] = useState(0);
  const [instant, setInstant] = useState(!!reduce);
  const tRef = useRef(t);
  const speedRef = useRef(speed);
  const lastCue = useRef<Record<string, number>>({});
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const seek = useCallback((next: number) => {
    tRef.current = next;
    setT(next);
  }, []);

  const fire = useCallback(
    (beats: Beat[]) => {
      // A big jump (skip, slow frame) would fire a burst: only keep the reveal.
      const list = beats.length > 4 ? beats.filter((b) => b.kind === 'rootCause') : beats;
      const now = performance.now();
      for (const b of list) {
        if (!b.cue) continue;
        const gap = b.cue === 'evidence' ? 140 : 70;
        if (now - (lastCue.current[b.cue] ?? 0) < gap) continue;
        lastCue.current[b.cue] = now;
        play(b.cue, { pan: nodePan(timeline.layout, b.node) });
      }
    },
    [play, timeline.layout],
  );

  // The clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last) * speedRef.current;
      last = now;
      const prev = tRef.current;
      const next = Math.min(timeline.total, prev + dt);
      tRef.current = next;
      setT(next);
      fire(beatsBetween(timeline, prev === 0 ? -1 : prev, next));
      if (next >= timeline.total) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeline, fire]);

  // A live run that just finished: play it from the top.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) {
      seek(0);
      setInstant(false);
      setRun((r) => r + 1);
      setPlaying(!reduce);
      if (reduce) seek(timeline.total);
    } else if (live) {
      seek(timeline.total);
    }
    wasLive.current = live;
  }, [live, timeline.total, reduce, seek]);

  const replay = useCallback(() => {
    seek(0);
    setInstant(false);
    setRun((r) => r + 1);
    setPlaying(true);
  }, [seek]);

  const skip = useCallback(() => {
    const prev = tRef.current;
    seek(timeline.total);
    setPlaying(false);
    setInstant(true);
    if (timeline.revealAt != null && prev < timeline.revealAt) play('rootCause');
  }, [seek, timeline, play]);

  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (tRef.current >= timeline.total) {
      replay();
      return;
    }
    setPlaying(true);
  }, [playing, timeline.total, replay]);

  const state = stageAt(timeline, t);
  const dimmed = state.phase === 'synth' || state.phase === 'reveal';
  const showReveal = timeline.revealAt != null && t >= timeline.revealAt;
  const realTotal = formatMs(timeline.realTotal);
  const chapterNumber = state.chapterIndex + 1;

  return (
    <TheaterFrame investigationId={investigationId} live={live}>
      {/* HUD */}
      <div className="relative grid gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-6 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            {trace.investigation.triggerType === 'ANOMALY_DETECTED' ? 'Opened by a monitor' : 'The question'}
          </p>
          <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{trace.investigation.question}</h2>
          <div className="mt-3 h-6 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={live ? 'live' : (state.chapter?.title ?? 'start')}
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
              >
                {live ? (
                  <>
                    <LiveDot /> Live: agents are working right now. Playback starts when the run completes.
                  </>
                ) : (
                  <>
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-contrast)]">
                      {Math.max(1, chapterNumber)}
                    </span>
                    {state.chapter?.title ?? 'Ready'}
                  </>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:gap-3 lg:w-[380px]">
          <Stat label="Evidence" value={state.evidenceCount} of={timeline.evidenceTotal} />
          <Stat label="Findings" value={state.findings.length} of={timeline.findingTotal} />
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Real time</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums leading-tight">{formatMs(state.realMs) ?? '0ms'}</dd>
            {realTotal && <dd className="text-[10px] text-[var(--text-muted)]">of {realTotal}</dd>}
          </div>
        </dl>
      </div>

      {/* Stage + findings */}
      <div className="relative grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative min-w-0">
          <div className="helix-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl"
            style={{ background: 'radial-gradient(ellipse at 88% 14%, transparent 10%, var(--canvas) 70%)' }}
            animate={{ opacity: dimmed ? 0.55 : 0 }}
            transition={{ duration: 0.8 }}
          />
          <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="min-w-[720px]">
              <Stage layout={timeline.layout} state={state} dimmed={dimmed} />
            </div>
          </div>
          <AnimatePresence>
            {state.phase === 'plan' && timeline.beats[1] && (
              <Caption key="plan" title={timeline.beats[1].label} detail={timeline.beats[1].detail} />
            )}
            {state.phase === 'synth' && (
              <Caption
                key="synth"
                title="Coordinator weighs the evidence"
                detail={timeline.beats.find((b) => b.kind === 'synthesize')?.detail ?? null}
              />
            )}
          </AnimatePresence>
        </div>
        <FindingsFeed findings={state.findings} total={timeline.findingTotal} dimmed={dimmed} />
      </div>

      {/* Climax */}
      <AnimatePresence>
        {showReveal && (
          <ScrollOnMount className="px-4 pb-4 sm:px-6 sm:pb-6" key={`reveal-${run}`}>
            <Reveal timeline={timeline} investigationId={investigationId} onReplay={replay} instant={instant} />
          </ScrollOnMount>
        )}
      </AnimatePresence>
      {!live && timeline.complete && !timeline.rootCause && t >= timeline.total && (
        <p className="px-6 pb-6 text-sm text-[var(--text-secondary)]">
          This run finished without a root cause ({trace.investigation.status.toLowerCase().replace(/_/g, ' ')}).
        </p>
      )}

      {/* Transport controls */}
      {!live && (
        <Controls
          t={t}
          total={timeline.total}
          chapters={timeline.chapters}
          playing={playing}
          speed={speed}
          onToggle={toggle}
          onSeek={(v) => {
            seek(v);
            setInstant(v >= (timeline.revealAt ?? Infinity));
          }}
          onSpeed={setSpeed}
          onSkip={skip}
          onReplay={replay}
        />
      )}
    </TheaterFrame>
  );
}

function TheaterFrame({
  children,
  investigationId,
  live = false,
}: {
  children: ReactNode;
  investigationId: string;
  live?: boolean;
}) {
  // Bring the stage to the top of the screen when it opens: the header above
  // it would otherwise push the diagram below the fold on a laptop.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <motion.section
      ref={ref}
      style={{ scrollMarginTop: 16 }}
      initial={{ opacity: 0, y: 16, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="helix-beam relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
      aria-label="Run theater"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 sm:px-6">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          <LiveDot tone={live ? 'accent' : 'good'} />
          {live ? 'Run theater, live' : 'Run theater, replaying the real run'}
        </p>
        <Link
          href={`/investigations/${investigationId}`}
          scroll={false}
          className="grid h-7 w-7 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--canvas)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-label="Close the run theater"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Link>
      </div>
      {children}
    </motion.section>
  );
}

function Stat({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: 12, opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="text-xl font-semibold tabular-nums leading-tight"
          >
            {value}
          </motion.span>
        </AnimatePresence>
        <span className="text-[11px] text-[var(--text-muted)]">/ {of}</span>
      </dd>
    </div>
  );
}

function Caption({ title, detail }: { title: string; detail: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-2.5 text-center shadow-[var(--shadow-lg)]"
    >
      <p className="text-sm font-semibold">{title}</p>
      {detail && <p className="text-xs text-[var(--text-secondary)]">{detail}</p>}
    </motion.div>
  );
}

const ctrl =
  'grid h-9 min-w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:scale-95';

function Controls({
  t,
  total,
  chapters,
  playing,
  speed,
  onToggle,
  onSeek,
  onSpeed,
  onSkip,
  onReplay,
}: {
  t: number;
  total: number;
  chapters: { at: number; title: string }[];
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: (s: (typeof SPEEDS)[number]) => void;
  onSkip: () => void;
  onReplay: () => void;
}) {
  const done = t >= total;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 sm:px-6">
      <button
        type="button"
        onClick={onToggle}
        className={`${ctrl} !bg-[var(--accent)] !text-[var(--accent-contrast)] !border-[var(--accent)]`}
        aria-label={playing ? 'Pause' : done ? 'Replay' : 'Play'}
        data-silent
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M7 5v14l12-7z" />
          </svg>
        )}
      </button>
      <button type="button" onClick={onReplay} className={ctrl} aria-label="Replay from the start">
        ↺
      </button>

      <div className="relative min-w-[160px] flex-1">
        <div className="relative h-1.5 rounded-full bg-[var(--grid)]">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${(t / total) * 100}%` }} />
          {chapters.map((c) => (
            <span
              key={c.at + c.title}
              title={c.title}
              className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--text-muted)]"
              style={{ left: `${(c.at / total) * 100}%` }}
              aria-hidden
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={total}
          step={50}
          value={Math.round(t)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Playback position"
          className="absolute inset-x-0 -top-2 h-5 w-full cursor-pointer opacity-0"
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
        {clockText(t)} / {clockText(total)}
      </span>

      <div className="flex rounded-lg border border-[var(--border)] p-0.5" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            aria-pressed={speed === s}
            className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              speed === s ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
      <button type="button" onClick={onSkip} disabled={done} className={`${ctrl} disabled:opacity-40`} data-silent>
        Skip to result ⇥
      </button>
    </div>
  );
}

/** Scrolls itself into view once, shortly after it mounts (the root cause reveal). */
function ScrollOnMount({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
