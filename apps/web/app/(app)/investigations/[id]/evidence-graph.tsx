'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import {
  causalChain,
  layoutCausalGraph,
  type CausalEdge,
  type CausalNode,
  type GraphData,
} from '../../../../lib/trace';
import { useSound } from '../../../../components/experience';
import { EASE, motion } from '../../../../components/motion';
import { buttonClass, inputClass } from '../../../../components/ui';
import { EvidenceVisual } from './result/evidence-visual';

const REVEAL_MS = 85;

/** Radius per node type. */
const RADIUS: Record<CausalNode['type'], number> = {
  question: 15,
  step: 11,
  task: 11,
  evidence: 6,
  finding: 8,
  rootCause: 19,
  recommendation: 7,
};

const LABEL_CHARS: Partial<Record<CausalNode['type'], number>> = { evidence: 30, finding: 30, recommendation: 30 };

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

function edgePath(a: CausalNode, b: CausalNode) {
  const x1 = a.x + RADIUS[a.type];
  const x2 = b.x - RADIUS[b.type];
  const mx = (x1 + x2) / 2;
  return `M${x1.toFixed(1)},${a.y.toFixed(1)} C${mx.toFixed(1)},${a.y.toFixed(1)} ${mx.toFixed(1)},${b.y.toFixed(1)} ${x2.toFixed(1)},${b.y.toFixed(1)}`;
}

/**
 * Causal evidence graph: question, agents, evidence, findings, root cause and
 * actions, left to right. Nodes appear in that order with an `evidence` tick,
 * edges draw in, particles flow along every path into the root cause, and
 * hovering a node highlights its whole chain. Red marks only what broke.
 */
export function EvidenceGraph({ data }: { data: GraphData }) {
  const layout = useMemo(() => layoutCausalGraph(data, { width: 1200, rowGap: 36 }), [data]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const total = layout.nodes.length;
  const reduce = useReducedMotion();
  const play = useSound();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef, { once: true, margin: '-60px' });
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(layout.rootId);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const chain = useMemo(() => (hover ? causalChain(layout.edges, hover) : null), [hover, layout.edges]);
  const done = shown >= total;

  // Reveal nodes one by one in causal order once the graph is on screen.
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(total);
      return;
    }
    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= total) window.clearInterval(id);
    }, REVEAL_MS);
    return () => window.clearInterval(id);
  }, [inView, run, total, reduce]);

  // Sound for the node that just appeared (the engine throttles rapid ticks).
  useEffect(() => {
    if (shown === 0 || reduce) return;
    const n = layout.nodes[shown - 1];
    if (!n) return;
    const pan = (n.x / layout.width) * 1.4 - 0.7;
    if (n.type === 'rootCause') play('rootCause');
    else if (n.type === 'evidence' || n.type === 'finding') play('evidence', { pan });
    else if (n.type === 'task' || n.type === 'step') play('agentStart', { pan });
    // Keyed on `shown` only: each node plays once as it appears.
  }, [shown]);

  const visible = (n: CausalNode) => n.order < shown;
  const dim = (id: string) => chain != null && !chain.has(id);
  const edgeLit = (e: CausalEdge) => chain != null && chain.has(e.source) && chain.has(e.target);

  return (
    <div className="space-y-4">
      <section
        ref={wrapRef}
        className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)] sm:p-4"
        aria-label="Evidence graph"
      >
        <div className="helix-dots pointer-events-none absolute inset-0 opacity-30" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
          <div>
            <p className="text-sm font-semibold">How the evidence leads to the root cause</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {data.nodes.length} nodes, {data.links.length} links. Hover a node to trace its chain, click to inspect it.
            </p>
          </div>
          <button type="button" className={buttonClass('secondary')} onClick={() => setRun((r) => r + 1)} disabled={!done}>
            ↻ Rebuild
          </button>
        </div>

        <div className="relative overflow-x-auto">
          <svg
            viewBox={`0 -34 ${layout.width} ${layout.height + 34}`}
            className="block h-auto w-full min-w-[760px]"
            role="img"
            aria-label={`Evidence graph with ${total} nodes. Use the node picker below to inspect nodes with a keyboard.`}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <radialGradient id="rc-glow">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </radialGradient>
              <radialGradient id="bad-glow">
                <stop offset="0%" stopColor="var(--status-critical)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--status-critical)" stopOpacity={0} />
              </radialGradient>
            </defs>

            {layout.columns.map((c, i) => (
              <g key={c.label}>
                <line x1={c.x} x2={c.x} y1={0} y2={layout.height} stroke="var(--grid)" strokeDasharray="2 6" />
                <text x={c.x} y={-14} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text-muted)" style={{ letterSpacing: '0.12em' }}>
                  {`${i + 1}. ${c.label.toUpperCase()}`}
                </text>
              </g>
            ))}

            {/* Edges */}
            {layout.edges.map((e) => {
              const a = byId.get(e.source)!;
              const b = byId.get(e.target)!;
              if (!visible(a) || !visible(b)) return null;
              const lit = edgeLit(e);
              const bad = a.alarm && (b.alarm || b.type === 'rootCause');
              return (
                <motion.path
                  key={e.id}
                  d={edgePath(a, b)}
                  fill="none"
                  stroke={bad ? 'var(--status-critical)' : lit || e.toRoot ? 'var(--text-secondary)' : 'var(--border-strong)'}
                  strokeWidth={lit ? 2 : e.toRoot ? 1.3 : 1}
                  strokeOpacity={chain && !lit ? 0.08 : bad ? 0.55 : e.toRoot ? 0.7 : 0.5}
                  initial={reduce ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                />
              );
            })}

            {/* Particles flowing into the root cause */}
            {done &&
              !reduce &&
              layout.edges
                .filter((e) => e.toRoot)
                .map((e, i) => {
                  const a = byId.get(e.source)!;
                  const b = byId.get(e.target)!;
                  const bad = a.alarm;
                  return (
                    <circle key={`p-${e.id}`} r={bad ? 2.6 : 2} fill={bad ? 'var(--status-critical)' : 'var(--accent)'} opacity={chain && !edgeLit(e) ? 0.1 : 0.9}>
                      <animateMotion dur={`${2.2 + (i % 5) * 0.25}s`} begin={`${(i % 7) * 0.3}s`} repeatCount="indefinite" path={edgePath(a, b)} />
                    </circle>
                  );
                })}

            {/* Nodes */}
            {layout.nodes.map((n) => {
              if (!visible(n)) return null;
              const r = RADIUS[n.type];
              const isRoot = n.type === 'rootCause';
              const isSel = n.id === selectedId;
              const fill = isRoot ? 'var(--accent)' : n.alarm ? 'var(--status-critical)' : n.type === 'question' || n.type === 'task' || n.type === 'step' ? 'var(--text-primary)' : 'var(--surface)';
              const stroke = n.alarm ? 'var(--status-critical)' : isRoot ? 'var(--accent)' : 'var(--text-secondary)';
              const chars = LABEL_CHARS[n.type];
              const label =
                n.type === 'task' || n.type === 'step'
                  ? (n.agent ?? n.label)
                  : n.type === 'rootCause'
                    ? 'Root cause'
                    : n.type === 'question'
                      ? 'Question'
                      : clip(n.label, chars ?? 40);
              const labelRight = n.type !== 'recommendation' && n.type !== 'question' && n.type !== 'rootCause';
              return (
                <motion.g
                  key={n.id}
                  initial={reduce ? false : { opacity: 0, scale: 0.2 }}
                  animate={{ opacity: dim(n.id) ? 0.15 : 1, scale: 1 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  style={{ transformOrigin: `${n.x}px ${n.y}px`, cursor: 'pointer' }}
                  onMouseEnter={() => setHover(n.id)}
                  onClick={() => {
                    setSelectedId(n.id);
                    play('click');
                  }}
                >
                  <title>{n.datum.detail.title}</title>
                  {(isRoot || n.alarm) && (
                    <circle cx={n.x} cy={n.y} r={isRoot ? r * 2.6 : r * 2.4} fill={isRoot ? 'url(#rc-glow)' : 'url(#bad-glow)'} className={isRoot ? 'helix-ping' : undefined} style={{ transformOrigin: `${n.x}px ${n.y}px`, animationDuration: '2.6s' }} />
                  )}
                  {isRoot && <circle cx={n.x} cy={n.y} r={r + 6} fill="none" stroke="var(--accent)" strokeOpacity={0.4} strokeDasharray="3 4" />}
                  {n.type === 'recommendation' ? (
                    <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} rx={2.5} fill="var(--surface)" stroke={stroke} strokeWidth={1.5} />
                  ) : (
                    <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke={stroke} strokeWidth={n.type === 'finding' || n.type === 'evidence' ? 1.5 : 2} />
                  )}
                  {isSel && <circle cx={n.x} cy={n.y} r={r + 4} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} />}
                  {(n.type === 'task' || n.type === 'step') && (
                    <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--canvas)">
                      {(n.agent ?? n.label).charAt(0)}
                    </text>
                  )}
                  <text
                    x={labelRight ? n.x + r + 6 : n.type === 'recommendation' ? n.x - r - 6 : n.x}
                    y={labelRight || n.type === 'recommendation' ? n.y + 3.5 : n.y + r + 16}
                    textAnchor={labelRight ? 'start' : n.type === 'recommendation' ? 'end' : 'middle'}
                    fontSize={isRoot ? 13 : n.type === 'question' || n.type === 'task' ? 12 : 10.5}
                    fontWeight={isRoot || n.type === 'task' || n.type === 'question' ? 600 : 400}
                    fill={n.alarm ? 'var(--text-bad)' : isRoot || n.type === 'task' ? 'var(--text-primary)' : 'var(--text-secondary)'}
                    style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round' }}
                  >
                    {label}
                  </text>
                </motion.g>
              );
            })}
          </svg>
        </div>

        <Legend />
      </section>

      <aside aria-label="Node details" className="grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <label htmlFor="graph-node-picker" className="block text-xs font-medium text-[var(--text-secondary)]">
            Inspect node
          </label>
          <select
            id="graph-node-picker"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className={`${inputClass} mt-1.5 text-xs`}
          >
            <option value="">Select a node</option>
            {layout.columns.map((c, i) => {
              const nodes = layout.nodes.filter((n) => n.column === i);
              if (nodes.length === 0) return null;
              return (
                <optgroup key={c.label} label={c.label}>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.type === 'task' ? `${n.agent ?? ''} ${n.label}`.trim() : n.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {selected && (
            <button type="button" onClick={() => setSelectedId(null)} className={`mt-3 ${buttonClass('ghost')}`}>
              Clear selection
            </button>
          )}
        </div>

        {selected ? (
          <div aria-live="polite" className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: selected.alarm ? 'var(--status-critical)' : 'var(--accent)' }}
                aria-hidden
              />
              {selected.datum.detail.subtitle}
            </p>
            <p className="mt-1.5 text-sm font-medium leading-snug">{selected.datum.detail.title}</p>
            {selected.datum.detail.body && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">{selected.datum.detail.body}</p>}
            {selected.datum.detail.confidence != null && (
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Confidence <span className="font-semibold tabular-nums">{Math.round(selected.datum.detail.confidence * 100)}%</span>
              </p>
            )}
            {selected.type === 'evidence' && (
              <div className="mt-3 max-w-xl rounded-xl border border-[var(--grid)] bg-[var(--surface-2)] p-3">
                <EvidenceVisual data={selected.datum.detail.data} />
              </div>
            )}
            {selected.datum.detail.data != null && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">Data</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-[var(--canvas)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {JSON.stringify(selected.datum.detail.data, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--text-muted)]">Click a node in the graph to see its statement and data.</p>
        )}
      </aside>
    </div>
  );
}

function Legend() {
  const item = 'inline-flex items-center gap-1.5';
  return (
    <ul className="relative mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--grid)] px-1 pt-3 text-[11px] text-[var(--text-secondary)]" aria-label="Legend">
      <li className={item}>
        <span className="h-3 w-3 rounded-full bg-[var(--text-primary)]" /> Question, agent
      </li>
      <li className={item}>
        <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--text-secondary)] bg-[var(--surface)]" /> Evidence, finding
      </li>
      <li className={item}>
        <span className="h-3.5 w-3.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--glow-strong)]" /> Root cause
      </li>
      <li className={item}>
        <span className="h-2.5 w-2.5 rounded-[2px] border-[1.5px] border-[var(--text-secondary)]" /> Action
      </li>
      <li className={item}>
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-critical)]" /> Something broke
      </li>
      <li className={item}>
        <span className="relative h-px w-6 bg-[var(--text-secondary)]">
          <span className="absolute -top-[2px] left-2 h-[5px] w-[5px] rounded-full bg-[var(--accent)]" />
        </span>
        Flows into the root cause
      </li>
    </ul>
  );
}
