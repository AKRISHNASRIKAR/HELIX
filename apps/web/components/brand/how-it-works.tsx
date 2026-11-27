'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { AnimatePresence, EASE, motion } from '../motion';

/**
 * Looping four-step "how it works" story for the sign-in screen. Each step
 * has a big caption and a small drawn animation. Pure illustration: no
 * numbers are shown, only words. Hovering pauses; the step dots jump.
 */

const STEPS = [
  { title: 'Connect data', caption: 'Orders, payments, deploys. CSV, Postgres, MCP or GitHub.' },
  { title: 'Ask or detect', caption: 'Ask why a metric moved, or let a monitor catch it.' },
  { title: 'Agents investigate', caption: 'Specialist agents dig in parallel and share findings.' },
  { title: 'Root cause, with evidence', caption: 'A plain answer you can check, step by step.' },
] as const;

const STEP_MS = 4200;

export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = STEPS[step] ?? STEPS[0];
  const reduce = useReducedMotion();

  useEffect(() => {
    if (paused || reduce) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => window.clearTimeout(id);
  }, [step, paused, reduce]);

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="flex items-center gap-2" role="tablist" aria-label="How HELIX works">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={`Step ${i + 1}: ${s.title}`}
            onClick={() => setStep(i)}
            className="group relative h-1 flex-1 overflow-hidden rounded-full bg-[var(--border-strong)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {i < step && <span className="absolute inset-0 bg-[var(--text-muted)]" />}
            {i === step && (
              <motion.span
                key={`${step}-${paused}`}
                className="absolute inset-y-0 left-0 bg-[var(--accent)] shadow-[0_0_8px_var(--glow-strong)]"
                initial={{ width: reduce || paused ? '100%' : '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: reduce || paused ? 0 : STEP_MS / 1000, ease: 'linear' }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_150px] items-center gap-6 xl:grid-cols-[minmax(0,1fr)_190px]">
        <div className="relative min-h-[148px]" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <p className="font-mono text-xs tracking-widest text-[var(--text-muted)]">
                {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
              </p>
              <h3 className="mt-2 text-4xl font-semibold leading-[1.05] tracking-tight xl:text-5xl">{current.title}</h3>
              <p className="mt-3 max-w-sm text-[15px] text-[var(--text-secondary)]">{current.caption}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="relative aspect-square rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 shadow-[var(--shadow)] backdrop-blur">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              {step === 0 && <ConnectArt />}
              {step === 1 && <DetectArt />}
              {step === 2 && <AgentsArt />}
              {step === 3 && <RootCauseArt />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

const draw = (delay: number, duration = 0.8) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1 },
  transition: { pathLength: { delay, duration, ease: EASE }, opacity: { delay, duration: 0.2 } },
});

const pop = (delay: number) => ({
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { delay, type: 'spring' as const, stiffness: 320, damping: 20 },
});

/** Three sources wire into one hub. */
function ConnectArt() {
  const sources = [
    { y: 30, label: 'CSV' },
    { y: 60, label: 'SQL' },
    { y: 90, label: 'MCP' },
  ];
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
      {sources.map((s, i) => (
        <g key={s.label}>
          <motion.rect x="10" y={s.y - 9} width="30" height="18" rx="4" fill="var(--surface-2)" stroke="var(--border-strong)" {...pop(0.1 + i * 0.15)} />
          <motion.text x="25" y={s.y + 3} textAnchor="middle" fontSize="7" fontFamily="var(--font-mono)" fill="var(--text-secondary)" {...pop(0.1 + i * 0.15)}>
            {s.label}
          </motion.text>
          <motion.path d={`M40 ${s.y} C 62 ${s.y}, 66 60, 84 60`} fill="none" stroke="var(--series-1)" strokeWidth="1.2" {...draw(0.5 + i * 0.15)} />
          <circle r="1.8" fill="var(--series-1)">
            <animateMotion dur="1.4s" begin={`${1 + i * 0.25}s`} repeatCount="indefinite" path={`M40 ${s.y} C 62 ${s.y}, 66 60, 84 60`} />
          </circle>
        </g>
      ))}
      <motion.circle cx="94" cy="60" r="11" fill="var(--accent)" {...pop(0.9)} />
      <motion.path d="M90 54c0 4 8 4 8 8M98 54c0 4-8 4-8 8" stroke="var(--accent-contrast)" strokeWidth="1.4" fill="none" strokeLinecap="round" {...draw(1.1, 0.5)} />
    </svg>
  );
}

/** A metric line drops; a question mark lands on the dip. Red marks the break. */
function DetectArt() {
  const line = 'M10 70 L28 62 L44 66 L60 56 L72 60 L82 92 L94 64 L110 60';
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
      {[40, 60, 80, 100].map((y) => (
        <line key={y} x1="10" x2="110" y1={y} y2={y} stroke="var(--grid)" strokeWidth="0.8" />
      ))}
      <motion.path d={line} fill="none" stroke="var(--series-1)" strokeWidth="1.8" strokeLinejoin="round" {...draw(0.1, 1.2)} />
      <motion.circle cx="82" cy="92" r="4" fill="var(--status-critical)" {...pop(1.2)} />
      <circle cx="82" cy="92" r="4" fill="none" stroke="var(--status-critical)" className="helix-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      <motion.g {...pop(1.5)}>
        <rect x="60" y="18" width="44" height="18" rx="9" fill="var(--accent)" />
        <text x="82" y="30" textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--accent-contrast)">
          Why?
        </text>
      </motion.g>
      <motion.path d="M82 36 L82 84" stroke="var(--border-strong)" strokeDasharray="2 2" {...draw(1.6, 0.5)} />
    </svg>
  );
}

/** Coordinator fans out to three agents after Analytics; pulses travel the edges. */
function AgentsArt() {
  const nodes = [
    { x: 20, y: 60, l: 'C' },
    { x: 50, y: 60, l: 'A' },
    { x: 88, y: 28, l: 'F' },
    { x: 92, y: 60, l: 'Cu' },
    { x: 88, y: 92, l: 'P' },
  ];
  const edges = [
    { d: 'M28 60 L42 60', delay: 0.4 },
    { d: 'M58 58 C 70 44, 74 32, 80 29', delay: 0.9 },
    { d: 'M58 60 L84 60', delay: 0.9 },
    { d: 'M58 62 C 70 76, 74 88, 80 91', delay: 0.9 },
  ];
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
      {edges.map((e) => (
        <g key={e.d}>
          <motion.path d={e.d} fill="none" stroke="var(--border-strong)" strokeWidth="1.2" {...draw(e.delay, 0.5)} />
          <circle r="1.8" fill="var(--series-1)">
            <animateMotion dur="1.1s" begin={`${e.delay + 0.5}s`} repeatCount="indefinite" path={e.d} />
          </circle>
        </g>
      ))}
      {nodes.map((n, i) => (
        <motion.g key={n.l} {...pop(i === 0 ? 0.1 : i === 1 ? 0.5 : 1)}>
          <circle cx={n.x} cy={n.y} r="8" fill={i === 0 ? 'var(--accent)' : 'var(--surface-2)'} stroke="var(--series-1)" strokeWidth="1.2" />
          <text x={n.x} y={n.y + 2.6} textAnchor="middle" fontSize="7" fontWeight="600" fill={i === 0 ? 'var(--accent-contrast)' : 'var(--text-primary)'}>
            {n.l}
          </text>
        </motion.g>
      ))}
    </svg>
  );
}

/** A root-cause card assembles from evidence lines that tick in. */
function RootCauseArt() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
      <motion.rect x="14" y="16" width="92" height="88" rx="8" fill="var(--surface-2)" stroke="var(--border-strong)" {...pop(0.05)} />
      <motion.rect x="24" y="26" width="40" height="6" rx="3" fill="var(--status-critical)" {...pop(0.3)} />
      <motion.rect x="24" y="38" width="70" height="5" rx="2.5" fill="var(--series-1)" {...pop(0.45)} />
      {[56, 70, 84].map((y, i) => (
        <g key={y}>
          <motion.path d={`M24 ${y} l3 3 l6 -6`} fill="none" stroke="var(--series-1)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...draw(0.8 + i * 0.3, 0.3)} />
          <motion.rect x="38" y={y - 2} width={50 - i * 8} height="4" rx="2" fill="var(--series-3)" {...pop(0.85 + i * 0.3)} />
        </g>
      ))}
    </svg>
  );
}
