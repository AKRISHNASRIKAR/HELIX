'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { agentLabel, replayLanes, type ReplayMarker, type ReplayStep, type ReplayStepKind } from '../../../../lib/trace';
import type { Cue } from '../../../../lib/sound';
import { useSound } from '../../../../components/experience';
import { AnimatePresence, EASE, motion } from '../../../../components/motion';
import { buttonClass } from '../../../../components/ui';
import { ConfidenceMeter } from './result/charts';

const KIND_LABEL: Record<ReplayStepKind, string> = {
  question: 'Trigger',
  plan: 'Plan',
  dispatch: 'Dispatch',
  result: 'Result',
  findings: 'Findings',
  rootCause: 'Root cause',
  recommendations: 'Recommendations',
  summary: 'Summary',
};

/** Plain-words caption for what happens at each kind of step. */
const KIND_CAPTION: Record<ReplayStepKind, string> = {
  question: 'The investigation starts',
  plan: 'The Coordinator decides which agents to ask',
  dispatch: 'Tasks are sent to the agents',
  result: 'An agent reports back',
  findings: 'More findings come in',
  rootCause: 'The Coordinator names the root cause',
  recommendations: 'HELIX suggests what to do',
  summary: 'Done',
};

const STEP_MS = 2200;
const SPEEDS = [0.5, 1, 2] as const;

function clock(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function cueFor(step: ReplayStep): Cue {
  switch (step.kind) {
    case 'question':
      return 'launch';
    case 'dispatch':
      return 'agentStart';
    case 'result':
      return /FAIL|ERROR/.test(step.status ?? '') ? 'error' : step.items.length > 0 ? 'finding' : 'message';
    case 'findings':
      return 'finding';
    case 'rootCause':
      return 'rootCause';
    case 'recommendations':
      return 'notify';
    case 'summary':
      return 'success';
    default:
      return 'message';
  }
}

/**
 * Timeline player for a reconstructed run: a stage card for the current
 * step, swimlanes per agent with a moving playhead and step markers, and a
 * step log that follows along. Plays a cue as the playhead crosses each step.
 */
export function ReplayPlayer({ steps }: { steps: ReplayStep[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const pos = useMotionValue(0);
  const listRef = useRef<HTMLOListElement>(null);
  const quiet = useRef(true);
  const play = useSound();
  const reduce = useReducedMotion();
  const last = Math.max(0, steps.length - 1);
  const { lanes, markers } = useMemo(() => replayLanes(steps), [steps]);
  const playheadLeft = useTransform(pos, (p) => `${last === 0 ? 0 : (p / last) * 100}%`);

  // Continuous playhead while playing; the step index follows its floor.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can precede the performance.now() taken above, so never step backwards.
      const next = Math.min(last, pos.get() + (Math.max(0, now - prev) / STEP_MS) * speed);
      prev = now;
      pos.set(next);
      const i = Math.max(0, Math.min(last, Math.floor(next + 1e-6)));
      setIndex((cur) => (cur === i ? cur : i));
      if (next >= last) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, last, pos]);

  // Cue for the step the playhead just reached (not on first render or while scrubbing).
  useEffect(() => {
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    const s = steps[index];
    if (!s) return;
    const lane = lanes.indexOf((s.agentType ?? 'COORDINATOR').toUpperCase());
    play(cueFor(s), { pan: lane >= 0 && lanes.length > 1 ? -0.6 + (1.2 * lane) / (lanes.length - 1) : 0 });
    // play and lanes are stable enough; the cue is keyed on the index only.
  }, [index]);

  // Keep the current step visible inside the log without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-step="${index}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top - list.clientHeight / 2 + el.offsetHeight / 2, behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [index, reduce]);

  if (steps.length === 0) return null;
  const current = steps[Math.max(0, Math.min(index, last))] ?? steps[0]!;

  const seek = (i: number, silent = false) => {
    const clamped = Number.isFinite(i) ? Math.max(0, Math.min(last, Math.round(i))) : 0;
    if (silent && clamped !== index) quiet.current = true;
    pos.set(clamped);
    setIndex(clamped);
  };
  const togglePlay = () => {
    if (!playing) {
      const from = index >= last ? 0 : index;
      if (index >= last) seek(0, true);
      play(cueFor(steps[from]!));
    }
    setPlaying((p) => !p);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      setPlaying(false);
      seek(index + (e.key === 'ArrowRight' ? 1 : -1));
    }
    if (e.key === ' ' && e.target === e.currentTarget) {
      e.preventDefault();
      togglePlay();
    }
  };

  return (
    <div className="space-y-4" onKeyDown={onKey} tabIndex={-1}>
      {/* Stage */}
      <section
        aria-live="polite"
        aria-label="Current replay step"
        className={`relative min-h-[220px] overflow-hidden rounded-3xl border bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)] sm:p-6 ${
          current.kind === 'rootCause' ? 'helix-beam border-[var(--border-strong)]' : 'border-[var(--border)]'
        }`}
      >
        <div className="helix-dots pointer-events-none absolute inset-0 opacity-30" aria-hidden />
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            className="relative"
            initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -8, filter: 'blur(4px)' }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 tracking-wide text-[var(--accent-contrast)]">
                {index + 1} / {steps.length}
              </span>
              {KIND_LABEL[current.kind]}
              {current.wave != null && <span>wave {current.wave + 1}</span>}
              {clock(current.at) && <span className="normal-case tracking-normal">{clock(current.at)}</span>}
            </div>
            <p className="mt-3 text-xs text-[var(--text-muted)]">{KIND_CAPTION[current.kind]}</p>
            <h3
              className={`mt-1 text-xl font-semibold leading-snug tracking-tight sm:text-2xl ${
                /FAIL/.test(current.status ?? '') ? 'text-[var(--text-bad)]' : ''
              }`}
            >
              {current.title}
            </h3>
            {current.description && (
              <p
                className={`mt-2 max-w-4xl whitespace-pre-line leading-relaxed text-[var(--text-secondary)] ${
                  current.kind === 'rootCause' ? 'text-base text-[var(--text-primary)]' : 'text-sm'
                }`}
              >
                {current.description}
              </p>
            )}

            {current.messages.length > 0 && (
              <ul className="mt-4 grid gap-2 md:grid-cols-2">
                {current.messages.map((m, i) => (
                  <motion.li
                    key={m.id}
                    initial={reduce ? false : { opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.12, duration: 0.4, ease: EASE }}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{agentLabel(m.from)}</span>
                      <span className="relative h-px flex-1 bg-[var(--border-strong)]" aria-hidden>
                        <motion.span
                          className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--glow-strong)]"
                          initial={{ left: '0%' }}
                          animate={reduce ? { left: '100%' } : { left: ['0%', '100%'] }}
                          transition={{ duration: 0.9, delay: 0.2 + i * 0.12, ease: EASE }}
                        />
                      </span>
                      <span className="font-semibold">{agentLabel(m.to)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                          m.type === 'ERROR' ? 'bg-[var(--anomaly-fill)] text-[var(--text-bad)]' : 'bg-[var(--canvas)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {m.type}
                      </span>
                      {m.transport && (
                        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">via {m.transport}</span>
                      )}
                      {clock(m.at) && <span className="ml-auto text-[10px] text-[var(--text-muted)]">{clock(m.at)}</span>}
                    </div>
                    {m.detail && <p className="mt-1 line-clamp-2 text-[var(--text-secondary)]">{m.detail}</p>}
                  </motion.li>
                ))}
              </ul>
            )}

            {current.items.length > 0 && (
              <ul className="mt-4 grid gap-2 md:grid-cols-2">
                {current.items.map((item, i) => (
                  <motion.li
                    key={item.id}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.08, duration: 0.4, ease: EASE }}
                    className="rounded-xl border border-[var(--grid)] bg-[var(--surface-2)] px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] font-medium leading-snug">{item.label}</p>
                      {item.confidence != null && <ConfidenceMeter value={item.confidence} className="shrink-0" />}
                    </div>
                    {item.detail && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{item.detail}</p>}
                  </motion.li>
                ))}
              </ul>
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Controls + swimlanes */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]" aria-label="Replay timeline">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => (setPlaying(false), seek(index - 1))} disabled={index === 0} className={buttonClass('secondary')} aria-label="Previous step">
            ←
          </button>
          <button type="button" onClick={togglePlay} className={`${buttonClass('primary')} min-w-[88px]`} aria-pressed={playing} data-silent>
            {playing ? (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><rect x="1" y="1" width="3" height="8" fill="currentColor" /><rect x="6" y="1" width="3" height="8" fill="currentColor" /></svg>
                Pause
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>
                {index >= last ? 'Replay' : 'Play'}
              </>
            )}
          </button>
          <button type="button" onClick={() => (setPlaying(false), seek(index + 1))} disabled={index >= last} className={buttonClass('secondary')} aria-label="Next step">
            →
          </button>
          <div className="ml-1 inline-flex rounded-lg border border-[var(--border)] p-0.5" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  speed === s ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs tabular-nums text-[var(--text-muted)]">
            Step {index + 1} of {steps.length}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[104px_minmax(0,1fr)]">
              <div />
              <div className="relative mx-3 h-4">
                {steps.map((s, i) => (
                  <span
                    key={s.id}
                    className={`absolute -translate-x-1/2 text-[9px] tabular-nums ${i === index ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                    style={{ left: `${last ? (i / last) * 100 : 0}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[104px_minmax(0,1fr)]">
              <ul aria-hidden>
                {lanes.map((l) => {
                  const live = current.agentType?.toUpperCase() === l || (l === 'COORDINATOR' && !current.agentType);
                  return (
                    <li key={l} className={`flex h-10 items-center gap-2 text-xs ${live ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-[var(--accent)] shadow-[0_0_8px_var(--glow-strong)]' : 'bg-[var(--border-strong)]'}`} />
                      {agentLabel(l)}
                    </li>
                  );
                })}
              </ul>
              <div
                className="relative mx-3 cursor-pointer"
                style={{ height: lanes.length * 40 }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setPlaying(false);
                  seek(Math.round(((e.clientX - r.left) / r.width) * last));
                }}
                role="presentation"
              >
                {lanes.map((l, li) => (
                  <div key={l} className="absolute inset-x-0 h-px bg-[var(--grid)]" style={{ top: li * 40 + 20 }} />
                ))}
                <Connectors markers={markers} lanes={lanes} last={last} index={index} />
                {markers.map((m) => (
                  <Marker key={`${m.step}-${m.lane}`} m={m} top={lanes.indexOf(m.lane) * 40 + 20} left={last ? (m.step / last) * 100 : 0} state={m.step < index ? 'past' : m.step === index ? 'now' : 'future'} onSelect={() => (setPlaying(false), seek(m.step))} title={steps[m.step]?.title ?? ''} />
                ))}
                <motion.div className="pointer-events-none absolute inset-y-[-6px] w-0" style={{ left: playheadLeft }} aria-hidden>
                  <span className="absolute inset-y-0 -left-px w-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--glow-strong)]" />
                  <span className="absolute -left-[5px] -top-1 h-2.5 w-2.5 rotate-45 bg-[var(--accent)]" />
                </motion.div>
              </div>
            </div>
          </div>
        </div>
        <label htmlFor="replay-scrub" className="sr-only">
          Replay position
        </label>
        <input
          id="replay-scrub"
          type="range"
          min={0}
          max={last}
          value={index}
          onChange={(e) => (setPlaying(false), seek(Number(e.target.value), true))}
          className="mt-3 w-full accent-[var(--accent)]"
        />
      </section>

      {/* Step log */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
        <h3 className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Step log</h3>
        <ol ref={listRef} className="relative max-h-[320px] space-y-0.5 overflow-y-auto" aria-label="Replay steps">
          {steps.map((s, i) => {
            const isCurrent = i === index;
            const done = i < index;
            return (
              <li key={s.id} data-step={i}>
                <button
                  type="button"
                  onClick={() => (setPlaying(false), seek(i))}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    isCurrent ? 'bg-[var(--surface-2)] ring-1 ring-[var(--border-strong)]' : 'hover:bg-[var(--surface-2)]'
                  } ${!isCurrent && !done ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums ${
                      s.kind === 'rootCause'
                        ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_10px_var(--glow-strong)]'
                        : /FAIL/.test(s.status ?? '')
                          ? 'bg-[var(--status-critical)] text-[var(--accent-contrast)]'
                          : done || isCurrent
                            ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                            : 'border border-[var(--border-strong)] text-[var(--text-muted)]'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {KIND_LABEL[s.kind]}
                      {clock(s.at) && <span className="ml-1.5 normal-case tracking-normal">{clock(s.at)}</span>}
                    </span>
                    <span className="block truncate text-[13px] font-medium">{s.title}</span>
                  </span>
                  {s.items.length > 0 && s.kind === 'result' && (
                    <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
                      {s.items.length} finding{s.items.length === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** Vertical links between the Coordinator lane and the agents a step dispatches to or hears back from. */
function Connectors({ markers, lanes, last, index }: { markers: ReplayMarker[]; lanes: string[]; last: number; index: number }) {
  const coord = lanes.indexOf('COORDINATOR');
  if (coord < 0) return null;
  return (
    <>
      {markers
        .filter((m) => m.lane !== 'COORDINATOR' && (m.tone === 'start' || m.tone === 'done' || m.tone === 'fail'))
        .map((m) => {
          const li = lanes.indexOf(m.lane);
          const top = Math.min(li, coord) * 40 + 20;
          const h = Math.abs(li - coord) * 40;
          const reached = m.step <= index;
          return (
            <span
              key={`c-${m.step}-${m.lane}`}
              className={`absolute w-px transition-opacity duration-500 ${m.tone === 'start' ? '' : 'border-l border-dashed'} ${
                reached ? 'opacity-100' : 'opacity-25'
              }`}
              style={{
                left: `${last ? (m.step / last) * 100 : 0}%`,
                top,
                height: h,
                background: m.tone === 'start' ? 'var(--border-strong)' : undefined,
                borderColor: m.tone === 'fail' ? 'var(--status-critical)' : 'var(--border-strong)',
              }}
              aria-hidden
            />
          );
        })}
    </>
  );
}

function Marker({
  m,
  top,
  left,
  state,
  onSelect,
  title,
}: {
  m: ReplayMarker;
  top: number;
  left: number;
  state: 'past' | 'now' | 'future';
  onSelect: () => void;
  title: string;
}) {
  const lit = state !== 'future';
  const size = m.tone === 'root' ? 16 : m.tone === 'info' ? 8 : 12;
  const color = m.tone === 'fail' ? 'var(--status-critical)' : 'var(--accent)';
  return (
    <button
      type="button"
      onClick={(e) => (e.stopPropagation(), onSelect())}
      title={`Step ${m.step + 1}: ${title}`}
      aria-label={`Go to step ${m.step + 1}: ${title}`}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ left: `${left}%`, top, width: size, height: size }}
      data-silent
    >
      {state === 'now' && <span className="helix-ping absolute inset-0 rounded-full" style={{ background: color }} aria-hidden />}
      <span
        className={`absolute inset-0 transition-all duration-300 ${m.tone === 'root' ? 'rotate-45 rounded-[3px]' : m.tone === 'info' ? 'rounded-sm' : 'rounded-full'}`}
        style={{
          background: m.tone === 'start' ? 'var(--surface)' : lit ? color : 'var(--surface)',
          border: `2px solid ${lit ? color : 'var(--border-strong)'}`,
          boxShadow: lit && (m.tone === 'root' || state === 'now') ? `0 0 14px ${m.tone === 'fail' ? 'var(--status-critical)' : 'var(--glow-strong)'}` : undefined,
        }}
        aria-hidden
      />
      {m.count > 0 && (
        <span className={`absolute -right-3 -top-3 rounded-full px-1 text-[9px] font-semibold tabular-nums ${lit ? 'bg-[var(--text-primary)] text-[var(--canvas)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>
          {m.count}
        </span>
      )}
    </button>
  );
}
