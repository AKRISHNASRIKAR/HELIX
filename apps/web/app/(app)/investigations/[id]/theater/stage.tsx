'use client';

import { memo } from 'react';
import { AnimatePresence, motion, EASE } from '../../../../../components/motion';
import {
  NODE_H,
  NODE_W,
  RAIL_Y,
  STAGE_H,
  STAGE_W,
  pointAlong,
  transportLabel,
  type Beat,
  type NodeStatus,
  type StageLayout,
  type StageNode,
  type StageState,
} from '../../../../../lib/theater';

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/**
 * The mission-control flow diagram: Coordinator rail across the top, agents
 * below, A2A packets travelling along the wires, context chips popping out of
 * agents as the context engine briefs them. Pure function of the stage state,
 * so pausing, seeking and speed changes stay in sync.
 */
export function Stage({ layout, state, dimmed }: { layout: StageLayout; state: StageState; dimmed: boolean }) {
  const agents = layout.nodes.filter((n) => n.role === 'agent');
  const planX = layout.nodes[0]?.x ?? 96;
  const synthX = layout.nodes[layout.nodes.length - 1]?.x ?? STAGE_W - 96;
  return (
    <div className="relative w-full" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
      <svg
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id="theater-rail" x1="0" x2="1">
            <stop offset="0" stopColor="var(--series-2)" stopOpacity="0.2" />
            <stop offset="0.5" stopColor="var(--series-1)" stopOpacity="0.7" />
            <stop offset="1" stopColor="var(--series-2)" stopOpacity="0.2" />
          </linearGradient>
          <radialGradient id="theater-packet-glow">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Coordinator rail */}
        <line x1={planX} x2={synthX} y1={RAIL_Y} y2={RAIL_Y} stroke="url(#theater-rail)" strokeWidth={2} />
        <text
          x={STAGE_W / 2}
          y={RAIL_Y - 14}
          textAnchor="middle"
          className="fill-[var(--text-muted)] font-mono"
          style={{ fontSize: 10, letterSpacing: '0.14em' }}
        >
          COORDINATOR · A2A
        </text>

        {/* Upstream dependency curves */}
        {layout.dependencies.map((d, i) => (
          <g key={d.id}>
            <path d={d.d} fill="none" stroke="var(--border-strong)" strokeWidth={1.2} strokeDasharray="3 5" opacity={0.7} />
            {i === Math.floor(layout.dependencies.length / 2) && (
              <text
                x={agents[0]?.x ?? 0}
                y={STAGE_H - 12}
                className="fill-[var(--text-muted)]"
                style={{ fontSize: 10 }}
              >
                upstream findings feed the next wave
              </text>
            )}
          </g>
        ))}

        {/* Connectors from the rail to each agent */}
        {agents.map((n) => (
          <Connector key={n.key} node={n} status={state.nodes[n.key] ?? 'idle'} />
        ))}

        {/* Packets in flight */}
        {state.packets.map(({ beat, progress }) => (
          <Packet key={beat.id} beat={beat} progress={progress} layout={layout} />
        ))}
      </svg>

      {layout.nodes.map((n) => (
        <NodeCard
          key={n.key}
          node={n}
          status={state.nodes[n.key] ?? 'idle'}
          dimmed={dimmed && n.role !== 'synth'}
          spotlight={dimmed && n.role === 'synth'}
        />
      ))}

      <AnimatePresence>
        {/* Only the newest briefing: parallel agents start together and their
            chips would otherwise stack on top of each other. */}
        {Object.entries(state.contexts)
          .sort(([, a], [, b]) => b.at - a.at)
          .slice(0, 1)
          .map(([key, beat]) => {
            const node = layout.nodes.find((n) => n.key === key);
            return node ? <ContextChip key={beat.id} node={node} beat={beat} /> : null;
          })}
      </AnimatePresence>
    </div>
  );
}

function Connector({ node, status }: { node: StageNode; status: NodeStatus }) {
  const active = status === 'running' || status === 'briefed';
  const top = node.y - NODE_H / 2;
  return (
    <g>
      <line x1={node.x} x2={node.x} y1={RAIL_Y} y2={top} stroke="var(--border-strong)" strokeWidth={1.2} />
      <circle cx={node.x} cy={RAIL_Y} r={3} fill={status === 'idle' ? 'var(--border-strong)' : 'var(--series-1)'} />
      {active && (
        <motion.line
          x1={node.x}
          x2={node.x}
          y1={RAIL_Y}
          y2={top}
          stroke="var(--series-1)"
          strokeWidth={1.6}
          strokeDasharray="4 6"
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -20 }}
          transition={{ duration: 0.6, repeat: Infinity, ease: 'linear' }}
        />
      )}
    </g>
  );
}

const Packet = memo(function Packet({ beat, progress, layout }: { beat: Beat; progress: number; layout: StageLayout }) {
  const key = beat.node ?? '';
  const path = beat.kind === 'dispatch' ? layout.requestPath[key] : layout.resultPath[key];
  if (!path) return null;
  const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, progress)), 2);
  const [x, y] = pointAlong(path, eased);
  const tail = [0.05, 0.1, 0.15].map((d) => pointAlong(path, Math.max(0, eased - d)));
  const fade = progress > 0.85 ? (1 - progress) / 0.15 : progress < 0.08 ? progress / 0.08 : 1;
  const transport = transportLabel(beat.transport);
  const label = `${beat.kind === 'dispatch' ? 'TASK_REQUEST' : beat.status === 'FAILED' ? 'ERROR' : 'TASK_RESULT'}${transport ? ` · ${transport}` : ''}`;
  const onRail = Math.abs(y - RAIL_Y) < 2;
  return (
    <g opacity={fade}>
      <circle cx={x} cy={y} r={22} fill="url(#theater-packet-glow)" />
      {tail.map(([tx, ty], i) => (
        <circle key={i} cx={tx} cy={ty} r={3.4 - i} fill="var(--accent)" opacity={0.45 - i * 0.12} />
      ))}
      <circle cx={x} cy={y} r={5} fill="var(--accent)" stroke="var(--canvas)" strokeWidth={1.5} />
      <g transform={`translate(${x + (onRail ? 0 : 10)} ${y + (onRail ? 22 : 4)})`}>
        <text
          textAnchor={onRail ? 'middle' : 'start'}
          className="fill-[var(--text-primary)] font-mono"
          style={{ fontSize: 10, paintOrder: 'stroke', stroke: 'var(--canvas)', strokeWidth: 4 }}
        >
          {label}
        </text>
      </g>
    </g>
  );
});

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle: 'waiting',
  briefed: 'briefed',
  running: 'working',
  done: 'done',
  failed: 'failed',
};

const NodeCard = memo(function NodeCard({
  node,
  status,
  dimmed,
  spotlight,
}: {
  node: StageNode;
  status: NodeStatus;
  dimmed: boolean;
  spotlight: boolean;
}) {
  const running = status === 'running';
  const failed = status === 'failed';
  const sub =
    node.role === 'plan'
      ? status === 'idle'
        ? 'plans the run'
        : status === 'running'
          ? 'planning'
          : 'plan ready'
      : node.role === 'synth'
        ? status === 'done'
          ? 'root cause found'
          : status === 'running'
            ? 'synthesizing'
            : 'synthesizes'
        : status === 'done' && node.duration
          ? `done in ${node.duration}`
          : STATUS_TEXT[status];
  return (
    <motion.div
      className="absolute"
      style={{
        left: pct(node.x - NODE_W / 2, STAGE_W),
        top: pct(node.y - NODE_H / 2, STAGE_H),
        width: pct(NODE_W, STAGE_W),
        height: pct(NODE_H, STAGE_H),
      }}
      animate={{
        opacity: dimmed ? 0.3 : status === 'idle' ? 0.55 : 1,
        scale: running || spotlight ? 1.06 : 1,
        filter: dimmed ? 'blur(1px)' : 'blur(0px)',
      }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {(running || spotlight) && (
        <span
          aria-hidden
          className="helix-ping absolute inset-0 rounded-xl"
          style={{ boxShadow: `0 0 0 1px ${spotlight ? 'var(--accent)' : 'var(--glow-strong)'}` }}
        />
      )}
      <div
        className={`relative flex h-full items-center gap-2 overflow-hidden rounded-xl border px-2.5 transition-[background,border-color,box-shadow] duration-500 ${
          failed
            ? 'border-[var(--status-critical)] bg-[var(--anomaly-fill)]'
            : running || spotlight
              ? 'helix-beam border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[0_0_44px_-6px_var(--glow-strong)]'
              : status === 'done'
                ? 'border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow)]'
                : 'border-[var(--border)] bg-[var(--surface)]'
        }`}
      >
        {running && <span aria-hidden className="helix-shimmer pointer-events-none absolute inset-0 opacity-70" />}
        <span
          className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold transition-colors duration-500 ${
            status === 'idle'
              ? 'border border-[var(--border)] text-[var(--text-muted)]'
              : failed
                ? 'bg-[var(--status-critical)] text-[var(--accent-contrast)]'
                : 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          }`}
          aria-hidden
        >
          {status === 'done' && node.role === 'agent' ? '✓' : node.label.charAt(0)}
        </span>
        <span className="relative min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]">{node.label}</span>
          <span
            className={`block truncate text-[11px] leading-tight ${failed ? 'text-[var(--text-bad)]' : 'text-[var(--text-muted)]'}`}
          >
            {sub}
          </span>
        </span>
      </div>
    </motion.div>
  );
});

function ContextChip({ node, beat }: { node: StageNode; beat: Beat }) {
  const c = beat.context;
  if (!c) return null;
  const above = node.role !== 'agent';
  const parts = [
    c.tables.length ? `table ${c.tables.slice(0, 2).join(', ')}` : null,
    c.focusDays.length ? `focus ${c.focusDays.slice(0, 2).join(', ')}` : null,
    c.upstreamFindings ? `${c.upstreamFindings} upstream findings` : null,
    c.tokenCount != null ? `${c.tokenCount.toLocaleString('en-US')} tokens` : null,
  ].filter(Boolean);
  return (
    <motion.div
      className="pointer-events-none absolute z-10 -translate-x-1/2"
      style={{
        left: pct(node.x, STAGE_W),
        top: above ? pct(node.y + NODE_H / 2 + 8, STAGE_H) : pct(node.y + NODE_H / 2 + 8, STAGE_H),
      }}
      initial={{ opacity: 0, y: -6, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
    >
      <div className="w-max max-w-[220px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 py-1.5 shadow-[var(--shadow-lg)]">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Context engine</p>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-primary)]">{parts.join(' · ') || 'context assembled'}</p>
      </div>
    </motion.div>
  );
}
