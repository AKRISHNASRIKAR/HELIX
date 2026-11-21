import { formatCurrency, formatShortDate } from '../lib/format';

/**
 * Hand-rolled SVG charts (no chart library). Colours come from the CSS tokens
 * in globals.css so every chart shares one palette. Hover is native <title>
 * tooltips on each mark; the revenue chart has a richer crosshair (client).
 */

export function Sparkline({
  values,
  tone = 'neutral',
  width = 120,
  height = 36,
}: {
  values: number[];
  tone?: 'good' | 'bad' | 'neutral';
  width?: number;
  height?: number;
}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (width - 4) + 2,
    height - 3 - ((v - min) / span) * (height - 6),
  ]);
  const line = pts.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ');
  const area = `2,${height} ${line} ${width - 2},${height}`;
  const stroke =
    tone === 'good' ? 'var(--status-good)' : tone === 'bad' ? 'var(--status-critical)' : 'var(--series-1)';
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polygon points={area} fill={stroke} opacity={0.08} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.75} fill={stroke} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}

const SEGMENT_KEYS = [
  { key: 'anomaly', label: 'Anomaly-triggered', color: 'var(--series-1)' },
  { key: 'question', label: 'User questions', color: 'var(--series-2)' },
  { key: 'scheduled', label: 'Scheduled', color: 'var(--series-3)' },
] as const;

export function ThroughputChart({
  data,
}: {
  data: { date: string; anomaly: number; question: number; scheduled: number }[];
}) {
  const W = 380;
  const H = 250;
  const pad = { l: 28, r: 4, t: 8, b: 22 };
  const totals = data.map((d) => d.anomaly + d.question + d.scheduled);
  const max = Math.ceil(Math.max(...totals) / 5) * 5;
  const innerH = H - pad.t - pad.b;
  const step = (W - pad.l - pad.r) / data.length;
  const barW = step * 0.62;
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  return (
    <div>
      <Legend items={SEGMENT_KEYS.map((s) => ({ label: s.label, color: s.color }))} />
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Investigations per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--text-muted)] text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * step + (step - barW) / 2;
          let acc = 0;
          const total = totals[i]!;
          return (
            <g key={d.date}>
              <title>
                {`${formatShortDate(d.date)}: ${total} investigations\nAnomaly ${d.anomaly} · Questions ${d.question} · Scheduled ${d.scheduled}`}
              </title>
              <rect x={x - 2} y={pad.t} width={barW + 4} height={innerH} fill="transparent" />
              {SEGMENT_KEYS.map((s, si) => {
                const v = d[s.key];
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const isTop = si === SEGMENT_KEYS.length - 1;
                const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
                return isTop ? (
                  <path
                    key={s.key}
                    d={roundedTop(x, y1, barW, h, 3)}
                    fill={s.color}
                  />
                ) : (
                  <rect key={s.key} x={x} y={y1 + (si === 0 ? 0 : 0)} width={barW} height={h} fill={s.color} />
                );
              })}
              {i % 3 === 1 && (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] text-[10px]"
                >
                  {formatShortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function SegmentBars({
  data,
}: {
  data: { segment: string; current: number; previous: number }[];
}) {
  const max = Math.max(...data.flatMap((d) => [d.current, d.previous]));
  return (
    <div className="space-y-4">
      <Legend
        items={[
          { label: 'This quarter', color: 'var(--series-1)' },
          { label: 'Last quarter', color: 'var(--series-1-soft)' },
        ]}
      />
      {data.map((d) => {
        const change = d.current / d.previous - 1;
        return (
          <div key={d.segment} title={`${d.segment}: ${formatCurrency(d.current)} vs ${formatCurrency(d.previous)}`}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-[var(--text-primary)]">{d.segment}</span>
              <span className="tabular-nums text-[var(--text-secondary)]">
                {formatCurrency(d.current)}{' '}
                <span className={change >= 0 ? 'text-[var(--text-good)]' : 'text-[var(--text-bad)]'}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change * 100).toFixed(1)}%
                </span>
              </span>
            </div>
            <div className="mt-1.5 space-y-[2px]">
              <div
                className="h-2.5 rounded-r-[4px] bg-[var(--series-1)]"
                style={{ width: `${(d.current / max) * 100}%` }}
              />
              <div
                className="h-1.5 rounded-r-[4px] bg-[var(--series-1-soft)]"
                style={{ width: `${(d.previous / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Sequential single-hue (blue) heatmap of anomaly |z| by metric x day. */
export function AnomalyHeatmap({
  metrics,
  days,
  cells,
}: {
  metrics: string[];
  days: string[];
  cells: number[][];
}) {
  const RAMP = ['#eef4fc', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
  const color = (z: number) => RAMP[Math.min(RAMP.length - 1, Math.floor((z / 4) * RAMP.length))]!;
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `96px repeat(${days.length}, minmax(0, 1fr))` }}>
        {metrics.map((m, mi) => (
          <div key={m} className="contents">
            <div className="truncate pr-2 text-xs leading-7 text-[var(--text-secondary)]">{m}</div>
            {cells[mi]!.map((z, di) => (
              <div
                key={di}
                title={`${m} · ${formatShortDate(days[di]!)} · |z| = ${z.toFixed(1)}`}
                className="h-7 rounded-[4px]"
                style={{ background: color(z) }}
              />
            ))}
          </div>
        ))}
        <div />
        {days.map((d, i) => (
          <div key={d} className="pt-1 text-center text-[10px] text-[var(--text-muted)]">
            {i % 3 === 0 ? formatShortDate(d) : ''}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-[var(--text-muted)]">
        <span>|z| 0</span>
        <div className="flex">
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-5 first:rounded-l-sm last:rounded-r-sm" style={{ background: c }} />
          ))}
        </div>
        <span>4+</span>
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.dashed ? (
            <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: it.color }} />
          ) : (
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
