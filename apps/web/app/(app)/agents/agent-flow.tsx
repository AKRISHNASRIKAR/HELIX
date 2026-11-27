'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { EASE, motion } from '../../../components/motion';
import { useSound } from '../../../components/experience';
import { agentGlyph } from '../../../components/brand/agent-glyph';

/**
 * Animated map of how one investigation flows through the agents:
 * Coordinator plans, Analytics goes first, Finance / Customer / Product dig
 * in parallel, then the Coordinator synthesizes the root cause. A pulse
 * travels each hop; the loop repeats. Sound plays on the first pass only.
 */

export interface FlowAgent {
  type: string;
  name: string;
  status: 'BUSY' | 'IDLE' | 'UNAVAILABLE';
}

type NodeId = 'plan' | 'ANALYTICS' | 'FINANCE' | 'CUSTOMER' | 'PRODUCT' | 'synth';

const W = 1000;
const H = 340;
const NODE_W = 200;
const NODE_H = 70;

const NODES: { id: NodeId; type: string; x: number; y: number; role: string; phase: number }[] = [
  { id: 'plan', type: 'COORDINATOR', x: 104, y: 170, role: 'Plans the work', phase: 0 },
  { id: 'ANALYTICS', type: 'ANALYTICS', x: 366, y: 170, role: 'Finds what moved', phase: 1 },
  { id: 'FINANCE', type: 'FINANCE', x: 634, y: 55, role: 'Revenue, refunds', phase: 2 },
  { id: 'CUSTOMER', type: 'CUSTOMER', x: 634, y: 170, role: 'Customer segments', phase: 2 },
  { id: 'PRODUCT', type: 'PRODUCT', x: 634, y: 285, role: 'Deploys, releases', phase: 2 },
  { id: 'synth', type: 'COORDINATOR', x: 896, y: 170, role: 'Names the cause', phase: 3 },
];

const EDGES: { from: NodeId; to: NodeId; phase: number }[] = [
  { from: 'plan', to: 'ANALYTICS', phase: 1 },
  { from: 'ANALYTICS', to: 'FINANCE', phase: 2 },
  { from: 'ANALYTICS', to: 'CUSTOMER', phase: 2 },
  { from: 'ANALYTICS', to: 'PRODUCT', phase: 2 },
  { from: 'FINANCE', to: 'synth', phase: 3 },
  { from: 'CUSTOMER', to: 'synth', phase: 3 },
  { from: 'PRODUCT', to: 'synth', phase: 3 },
];

const CAPTIONS = [
  { n: '1', text: 'Coordinator plans' },
  { n: '2', text: 'Analytics finds the change' },
  { n: '3', text: 'Finance, Customer and Product dig in parallel' },
  { n: '4', text: 'Coordinator names the root cause' },
];

const PHASES = 5; // 0..3 active steps, 4 = hold with everything lit
const PHASE_MS = 1700;

const node = (id: NodeId) => NODES.find((n) => n.id === id)!;

function edgeGeometry(from: NodeId, to: NodeId) {
  const a = node(from);
  const b = node(to);
  const x1 = a.x + NODE_W / 2;
  const x2 = b.x - NODE_W / 2;
  const mx = (x1 + x2) / 2;
  const pts = [
    [x1, a.y],
    [mx, a.y],
    [mx, b.y],
    [x2, b.y],
  ] as const;
  const d = `M${x1} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${x2} ${b.y}`;
  const at = (t: number) => {
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    return {
      x: k0 * pts[0][0] + k1 * pts[1][0] + k2 * pts[2][0] + k3 * pts[3][0],
      y: k0 * pts[0][1] + k1 * pts[1][1] + k2 * pts[2][1] + k3 * pts[3][1],
    };
  };
  return { d, at };
}

function Pulse({ at }: { at: (t: number) => { x: number; y: number } }) {
  const p = useMotionValue(0);
  const cx = useTransform(p, (t) => at(t).x);
  const cy = useTransform(p, (t) => at(t).y);
  const opacity = useTransform(p, [0, 0.1, 0.85, 1], [0, 1, 1, 0]);
  useEffect(() => {
    const c = animate(p, 1, { duration: 0.9, ease: EASE });
    return () => c.stop();
  }, [p]);
  return (
    <>
      <motion.circle cx={cx} cy={cy} r={9} fill="var(--glow-strong)" style={{ opacity }} />
      <motion.circle cx={cx} cy={cy} r={4} fill="var(--accent)" style={{ opacity }} />
    </>
  );
}

export function AgentFlow({ agents }: { agents: FlowAgent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-60px' });
  const reduce = useReducedMotion();
  const play = useSound();
  const [phase, setPhase] = useState(reduce ? 4 : -1);
  const [cycle, setCycle] = useState(0);
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  useEffect(() => {
    if (reduce) {
      setPhase(4);
      return;
    }
    if (!inView) return;
    const id = window.setTimeout(
      () => {
        if (phase + 1 >= PHASES) {
          setCycle((c) => c + 1);
          setPhase(0);
        } else {
          setPhase(phase + 1);
        }
      },
      phase === -1 ? 300 : phase === 4 ? PHASE_MS * 1.4 : PHASE_MS,
    );
    return () => window.clearTimeout(id);
  }, [phase, inView, reduce]);

  // Sound on the first pass only, so the page does not loop noise.
  useEffect(() => {
    if (cycle > 0 || reduce) return;
    if (phase === 0) playRef.current('agentStart');
    else if (phase === 1 || phase === 2) playRef.current('message');
    else if (phase === 3) playRef.current('success');
  }, [phase, cycle, reduce]);

  const byType = new Map(agents.map((a) => [a.type, a]));
  const lit = (p: number) => phase >= p;

  return (
    <div ref={ref}>
      <div className="-mx-2 overflow-x-auto px-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[680px]" role="img" aria-label="How an investigation flows through the agents">
          <defs>
            <filter id="agent-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          {EDGES.map((e) => {
            const g = edgeGeometry(e.from, e.to);
            const on = lit(e.phase);
            return (
              <g key={`${e.from}-${e.to}`}>
                <path d={g.d} fill="none" stroke="var(--border-strong)" strokeWidth={1.5} strokeDasharray="4 6" />
                {on && (
                  <motion.path
                    key={`${cycle}-${phase >= e.phase}`}
                    d={g.d}
                    fill="none"
                    stroke="var(--series-1)"
                    strokeWidth={2}
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease: EASE }}
                  />
                )}
                {phase === e.phase && !reduce && <Pulse key={`p-${cycle}`} at={g.at} />}
              </g>
            );
          })}

          {NODES.map((n) => {
            const agent = byType.get(n.type);
            const label = agent ? agent.name.replace(/\s+Agent$/i, '') : n.type.charAt(0) + n.type.slice(1).toLowerCase();
            const active = phase === n.phase;
            const done = phase > n.phase;
            const down = agent?.status === 'UNAVAILABLE';
            const x = n.x - NODE_W / 2;
            const y = n.y - NODE_H / 2;
            return (
              <g key={n.id}>
                {active && (
                  <motion.rect
                    x={x}
                    y={y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={16}
                    fill="var(--glow-strong)"
                    filter="url(#agent-glow)"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                  />
                )}
                <motion.g
                  // Scale around the node's own centre, not the SVG origin.
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  animate={{ scale: active ? 1.04 : 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={14}
                    fill={active ? 'var(--surface-raised)' : 'var(--surface)'}
                    stroke={active ? 'var(--accent)' : done ? 'var(--series-2)' : 'var(--border-strong)'}
                    strokeWidth={active ? 1.8 : 1.2}
                    style={{ transition: 'stroke 0.3s, fill 0.3s' }}
                  />
                  <circle cx={x + 32} cy={n.y} r={18} fill={active || done ? 'var(--accent)' : 'var(--surface-2)'} style={{ transition: 'fill 0.3s' }} />
                  <g transform={`translate(${x + 20} ${n.y - 12})`}>
                    <path
                      d={agentGlyph(n.type)}
                      fill="none"
                      stroke={active || done ? 'var(--accent-contrast)' : 'var(--text-secondary)'}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                  <text x={x + 60} y={n.y - 5} fontSize={16} fontWeight={600} fill="var(--text-primary)" fontFamily="var(--font-inter), sans-serif">
                    {label}
                  </text>
                  <text x={x + 60} y={n.y + 15} fontSize={12} fill="var(--text-secondary)" fontFamily="var(--font-inter), sans-serif">
                    {n.role}
                  </text>
                  {down && <circle cx={x + NODE_W - 14} cy={y + 14} r={4} fill="var(--status-critical)" />}
                </motion.g>
              </g>
            );
          })}
        </svg>
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-4">
        {CAPTIONS.map((c, i) => {
          const on = phase === i || phase === 4;
          return (
            <li
              key={c.n}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-300 ${
                on
                  ? 'border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-primary)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)]'
              }`}
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-300 ${
                  on ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                }`}
              >
                {c.n}
              </span>
              <span className="text-sm font-medium leading-snug">{c.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
