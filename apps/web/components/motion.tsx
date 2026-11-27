'use client';

import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from 'motion/react';
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSound } from './experience';
import type { Cue } from '../lib/sound';

/**
 * Shared motion primitives. Every screen builds on these so animation timing
 * feels consistent: 0.5s ease-out entrances, 60ms stagger, numbers count up.
 * All of them respect prefers-reduced-motion.
 */

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts children in when they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
  ...rest
}: { children: ReactNode; delay?: number; y?: number; className?: string } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Staggers its direct children in, one after another. */
export function Stagger({
  children,
  className,
  step = 0.06,
  delay = 0,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  delay?: number;
  as?: 'div' | 'ul' | 'ol' | 'section';
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as];
  const Item = as === 'ul' || as === 'ol' ? motion.li : motion.div;
  return (
    <Comp
      className={className}
      initial={reduce ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '-40px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } }}
    >
      {Children.map(children, (child) =>
        child == null ? null : (
          <Item
            variants={{
              hidden: { opacity: 0, y: 12, scale: 0.98 },
              show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } },
            }}
          >
            {child}
          </Item>
        ),
      )}
    </Comp>
  );
}

/** Counts from 0 (or the previous value) to `value` when visible. */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString('en-US'),
  duration = 1.2,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration, ease: EASE });
    return () => c.stop();
  }, [inView, value, duration, mv, reduce]);
  return (
    <motion.span ref={ref} className={`tabular-nums ${className ?? ''}`}>
      {text}
    </motion.span>
  );
}

/** Types text out character by character, with optional typewriter ticks. */
export function Typewriter({
  text,
  speed = 14,
  delay = 0,
  sound = true,
  className,
  onDone,
}: {
  text: string;
  speed?: number;
  delay?: number;
  sound?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const [n, setN] = useState(0);
  const play = useSound();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      setN(text.length);
      onDone?.();
      return;
    }
    setN(0);
    let i = 0;
    let id: number | undefined;
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        i += 1;
        setN(i);
        if (sound && i % 3 === 0) play('type');
        if (i >= text.length) {
          window.clearInterval(id);
          onDone?.();
        }
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(start);
      if (id) window.clearInterval(id);
    };
    // onDone, play and sound are read at call time on purpose: restarting the
    // animation whenever a parent re-renders would loop forever.
  }, [text, speed, delay, reduce]);
  const done = n >= text.length;
  return (
    <span className={className}>
      {text.slice(0, n)}
      {!done && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current" aria-hidden />}
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** Plays a cue once when the element first scrolls into view. */
export function CueOnView({ cue, children, className }: { cue: Cue; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const play = useSound();
  useEffect(() => {
    if (inView) play(cue);
  }, [inView, cue, play]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Card that tilts slightly toward the pointer and casts a moving spotlight. */
export function SpotlightCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const play = useSound();
  return (
    <div
      ref={ref}
      onMouseEnter={() => play('hover')}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r || !ref.current) return;
        ref.current.style.setProperty('--mx', `${e.clientX - r.left}px`);
        ref.current.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
      className={`group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-[var(--border-strong)] ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: 'radial-gradient(320px circle at var(--mx) var(--my), var(--glow), transparent 60%)' }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Pulsing "live" dot. */
export function LiveDot({ tone = 'accent', className = '' }: { tone?: 'accent' | 'bad' | 'good'; className?: string }) {
  const color = tone === 'bad' ? 'var(--status-critical)' : tone === 'good' ? 'var(--status-good)' : 'var(--accent)';
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`} aria-hidden>
      <span className="helix-ping absolute inset-0 rounded-full" style={{ background: color }} />
      <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

export { motion, AnimatePresence } from 'motion/react';
