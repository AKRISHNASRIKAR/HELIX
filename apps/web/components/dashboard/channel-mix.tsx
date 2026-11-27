'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { EASE } from '../motion';

const SHADES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-1-soft)'];

/** Monochrome donut of revenue share per channel; each arc sweeps in. */
export function ChannelMix({ data }: { data: { channel: string; share: number }[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const show = inView || reduce;
  const R = 44;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg ref={ref} width={112} height={112} viewBox="0 0 112 112" aria-hidden className="shrink-0 -rotate-90">
        <circle cx={56} cy={56} r={R} fill="none" stroke="var(--grid)" strokeWidth={12} />
        {data.map((d, i) => {
          const start = acc;
          acc += d.share;
          return (
            <motion.circle
              key={d.channel}
              cx={56}
              cy={56}
              r={R}
              fill="none"
              stroke={SHADES[i % SHADES.length]}
              strokeWidth={12}
              strokeDashoffset={-start * C}
              initial={reduce ? false : { strokeDasharray: `0 ${C}` }}
              animate={show ? { strokeDasharray: `${Math.max(0, d.share * C - 2)} ${C}` } : {}}
              transition={{ duration: 0.7, delay: 0.2 + start * 0.9, ease: EASE }}
            />
          );
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.channel} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 capitalize">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SHADES[i % SHADES.length] }} />
              {d.channel}
            </span>
            <span className="font-semibold tabular-nums">{(d.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
