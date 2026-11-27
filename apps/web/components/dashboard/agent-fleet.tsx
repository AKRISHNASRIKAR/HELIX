'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import type { AgentSummary } from '../../lib/api';
import { EASE } from '../motion';
import { useMeasuredWidth } from './use-measure';

const ORDER = ['ANALYTICS', 'FINANCE', 'CUSTOMER', 'PRODUCT', 'OPERATIONS', 'VISUALIZATION'];
const rank = (t: string) => (ORDER.includes(t) ? ORDER.indexOf(t) : ORDER.length);
const short = (name: string) => name.replace(/\s*agent$/i, '');

/**
 * The agent fleet as a hub: the Coordinator in the middle, specialists around
 * it. Busy agents glow and their link to the Coordinator carries a moving
 * pulse; unavailable agents are red. Numbers are tasks handled.
 */
export function AgentFleet({ agents }: { agents: AgentSummary[] }) {
  const [box, W] = useMeasuredWidth<HTMLDivElement>(360);
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const show = inView || reduce;

  const hub = agents.find((a) => a.type === 'COORDINATOR') ?? null;
  const spokes = agents
    .filter((a) => a !== hub)
    .sort((a, b) => rank(a.type) - rank(b.type));
  const H = 240;
  const cx = W / 2;
  const cy = H / 2;
  const rx = Math.min(W / 2 - 52, 150);
  const ry = 82;
  const pos = spokes.map((_, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, spokes.length)) * Math.PI * 2 + Math.PI / 4;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });

  const node = (a: AgentSummary, x: number, y: number, r: number, delay: number) => {
    const busy = a.status === 'BUSY';
    const down = a.status === 'UNAVAILABLE';
    const ring = down ? 'var(--status-critical)' : busy ? 'var(--accent)' : 'var(--border-strong)';
    return (
      <motion.g
        key={a.type}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={show ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay, ease: EASE }}
      >
        <title>{`${a.name}: ${a.status.toLowerCase()}, ${a.tasks} tasks${a.successRate != null ? `, ${Math.round(a.successRate * 100)}% success` : ''}`}</title>
        {(busy || down) && (
          <circle cx={x} cy={y} r={r} fill={ring} opacity={0.35} className="helix-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        )}
        <circle
          cx={x}
          cy={y}
          r={r}
          fill="var(--surface-raised)"
          stroke={ring}
          strokeWidth={busy || down ? 2 : 1.25}
          style={{ filter: busy ? 'drop-shadow(0 0 10px var(--glow-strong))' : undefined }}
        />
        <text x={x} y={y + 4} textAnchor="middle" fontSize={r > 26 ? 13 : 12} fontWeight={600} fill="var(--text-primary)" className="tabular-nums">
          {a.tasks}
        </text>
        <text x={x} y={y + r + 14} textAnchor="middle" fontSize={11} fontWeight={500} fill="var(--text-secondary)">
          {short(a.name)}
        </text>
      </motion.g>
    );
  };

  return (
    <div ref={box}>
      <svg ref={ref} width={W} height={H} className="block" role="img" aria-label="Agent fleet">
        {hub &&
          spokes.map((a, i) => {
            const p = pos[i]!;
            const busy = a.status === 'BUSY' || hub.status === 'BUSY';
            return (
              <g key={a.type}>
                <motion.line
                  x1={cx}
                  y1={cy}
                  x2={p.x}
                  y2={p.y}
                  stroke={a.status === 'UNAVAILABLE' ? 'var(--status-critical)' : 'var(--border-strong)'}
                  strokeWidth={1}
                  initial={reduce ? false : { pathLength: 0 }}
                  animate={show ? { pathLength: 1 } : {}}
                  transition={{ duration: 0.6, delay: 0.25 + 0.08 * i, ease: EASE }}
                />
                {!reduce && (
                  <motion.circle
                    r={busy ? 2.6 : 1.8}
                    fill="var(--accent)"
                    opacity={busy ? 0.9 : 0.35}
                    initial={{ cx, cy }}
                    animate={show ? { cx: [cx, p.x], cy: [cy, p.y] } : {}}
                    transition={{ duration: busy ? 1.2 : 2.6, delay: 0.9 + 0.3 * i, repeat: Infinity, repeatDelay: busy ? 0.2 : 1.6, ease: 'easeInOut' }}
                  />
                )}
              </g>
            );
          })}
        {spokes.map((a, i) => node(a, pos[i]!.x, pos[i]!.y, 22, 0.35 + 0.08 * i))}
        {hub && node(hub, cx, cy, 30, 0.1)}
      </svg>
      <p className="mt-1 text-center text-[11px] text-[var(--text-muted)]">
        Number inside each node: tasks handled. Pulses show the Coordinator dispatching work.
      </p>
    </div>
  );
}
