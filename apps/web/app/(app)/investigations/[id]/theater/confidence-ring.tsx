'use client';

import { useEffect, useState } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { EASE } from '../../../../../components/motion';

/** Ring that sweeps to `value` (0..1) while the number counts up in the middle. */
export function ConfidenceRing({
  value,
  size = 132,
  stroke = 9,
  delay = 0,
  label = 'confidence',
}: {
  value: number;
  size?: number;
  stroke?: number;
  delay?: number;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? v : 0);
  useEffect(() => {
    if (reduce) {
      setShown(v);
      return;
    }
    const c = animate(0, v, { duration: 1.6, delay, ease: EASE, onUpdate: setShown });
    return () => c.stop();
  }, [v, delay, reduce]);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)}% ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 8px var(--glow-strong))' }}
          initial={{ pathLength: reduce ? v : 0 }}
          animate={{ pathLength: v }}
          transition={{ duration: reduce ? 0 : 1.6, delay, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        <div>
          <p className="font-semibold tabular-nums leading-none tracking-tight" style={{ fontSize: size * 0.24 }}>
            {(shown * 100).toFixed(size >= 100 ? 1 : 0)}
            <span className="text-[0.5em] text-[var(--text-secondary)]">%</span>
          </p>
          {size >= 100 && <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>}
        </div>
      </div>
    </div>
  );
}
