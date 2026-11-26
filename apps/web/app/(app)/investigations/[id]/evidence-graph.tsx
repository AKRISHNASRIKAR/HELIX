'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData, GraphNodeDatum } from '../../../../lib/trace';
import { buttonClass, inputClass } from '../../../../components/ui';

/** Node colors by column (question, step, task, evidence, finding, root cause, recommendation). */
const CATEGORY_COLORS = ['#0b0b0b', '#8a8984', '#2a78d6', '#b7d3f6', '#1baf7a', '#eb6834', '#7c5cc4'];

type Layout = 'layered' | 'force';

type EChartsInstance = {
  setOption: (option: unknown, notMerge?: boolean) => void;
  on: (event: string, handler: (params: { dataType?: string; data?: { id?: string } }) => void) => void;
  resize: () => void;
  dispose: () => void;
  dispatchAction: (action: Record<string, unknown>) => void;
};

/** ECharts graph of question, plan, tasks, evidence, findings and recommendations (client only). */
export function EvidenceGraph({ data }: { data: GraphData }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const [layout, setLayout] = useState<Layout>('layered');
  const [selectedId, setSelectedId] = useState<string | null>(
    () => data.nodes.find((n) => n.type === 'rootCause')?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const selected: GraphNodeDatum | undefined = useMemo(
    () => data.nodes.find((n) => n.id === selectedId),
    [data.nodes, selectedId],
  );

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      try {
        const [core, charts, components, renderers] = await Promise.all([
          import('echarts/core'),
          import('echarts/charts'),
          import('echarts/components'),
          import('echarts/renderers'),
        ]);
        core.use([charts.GraphChart, components.TooltipComponent, components.LegendComponent, renderers.CanvasRenderer]);
        if (disposed || !ref.current) return;
        const chart = core.init(ref.current, undefined, { renderer: 'canvas' }) as unknown as EChartsInstance;
        chartRef.current = chart;
        chart.on('click', (params) => {
          if (params.dataType === 'node' && params.data?.id) setSelectedId(params.data.id);
        });
        observer = new ResizeObserver(() => chart.resize());
        observer.observe(ref.current);
        setError(null);
        setReady(true);
      } catch (err) {
        if (!disposed) setError(`Could not load the chart library (${(err as Error).message}).`);
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // Full option on load and whenever the layout or data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    const force = layout === 'force';
    chart.setOption(
      {
        color: CATEGORY_COLORS,
        tooltip: {
          trigger: 'item',
          confine: true,
          formatter: (p: { dataType: string; data: { detail?: { title: string; subtitle: string }; kind?: string } }) =>
            p.dataType === 'node'
              ? `<strong>${escapeHtml(p.data.detail?.subtitle ?? '')}</strong><br/>${escapeHtml(truncate(p.data.detail?.title ?? '', 140))}`
              : escapeHtml(p.data.kind ?? ''),
        },
        legend: [{ data: data.categories.map((c) => c.name), top: 0, textStyle: { fontSize: 11, color: '#52514e' } }],
        animationDurationUpdate: 400,
        series: [
          {
            type: 'graph',
            layout: force ? 'force' : 'none',
            top: 40,
            roam: true,
            draggable: force,
            categories: data.categories.map((c, i) => ({ name: c.name, itemStyle: { color: CATEGORY_COLORS[i] } })),
            data: data.nodes.map((n) => ({
              id: n.id,
              name: n.name,
              category: n.category,
              symbolSize: n.symbolSize,
              detail: n.detail,
              ...(force ? {} : { x: n.x, y: n.y }),
            })),
            links: data.links.map((l) => ({ source: l.source, target: l.target, kind: l.kind })),
            edgeSymbol: ['none', 'arrow'],
            edgeSymbolSize: 6,
            lineStyle: { color: '#c9c8c2', width: 1.2, curveness: force ? 0 : 0.15, opacity: 0.9 },
            label: { show: !force, position: 'right', fontSize: 10, color: '#52514e', width: 150, overflow: 'truncate' },
            emphasis: { focus: 'adjacency', label: { show: true }, lineStyle: { width: 2.5 } },
            selectedMode: 'single',
            select: { itemStyle: { borderColor: '#0b0b0b', borderWidth: 3 }, label: { show: true, fontWeight: 'bold' } },
            force: { repulsion: 220, edgeLength: [60, 140], gravity: 0.08 },
          },
        ],
      },
      true,
    );
  }, [ready, layout, data]);

  // Mirror the selected node (from a click or the picker) in the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.dispatchAction({ type: 'unselect', seriesIndex: 0, dataIndex: data.nodes.map((_, i) => i) });
    const dataIndex = data.nodes.findIndex((n) => n.id === selectedId);
    if (dataIndex >= 0) chart.dispatchAction({ type: 'select', seriesIndex: 0, dataIndex });
  }, [ready, layout, data, selectedId]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5" role="group" aria-label="Graph layout">
            {(['layered', 'force'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLayout(l)}
                aria-pressed={layout === l}
                className={`rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] ${
                  layout === l ? 'bg-[#0b0b0b] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {l === 'layered' ? 'Layered' : 'Force'}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {data.nodes.length} nodes · {data.links.length} links · scroll to zoom, drag to pan
          </p>
        </div>
        {error ? (
          <p className="p-6 text-sm text-[var(--text-bad)]">{error}</p>
        ) : (
          <div
            ref={ref}
            className="h-[460px] w-full sm:h-[560px]"
            role="img"
            aria-label={`Evidence graph with ${data.nodes.length} nodes. Use the node picker to inspect nodes with a keyboard.`}
          />
        )}
      </div>

      <aside aria-label="Node details" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 xl:self-start">
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
          {data.categories.map((c, i) => {
            const nodes = data.nodes.filter((n) => n.category === i);
            if (nodes.length === 0) return null;
            return (
              <optgroup key={c.name} label={c.name}>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>

        {selected ? (
          <div className="mt-4" aria-live="polite">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[selected.category] }} aria-hidden />
              {selected.detail.subtitle}
            </p>
            <p className="mt-1.5 text-sm font-medium leading-snug">{selected.detail.title}</p>
            {selected.detail.body && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">{selected.detail.body}</p>}
            {selected.detail.confidence != null && (
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Confidence <span className="font-semibold tabular-nums">{Math.round(selected.detail.confidence * 100)}%</span>
              </p>
            )}
            {selected.detail.data != null && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">Data</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-[var(--canvas)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {JSON.stringify(selected.detail.data, null, 2)}
                </pre>
              </details>
            )}
            <button type="button" onClick={() => setSelectedId(null)} className={`mt-4 ${buttonClass('ghost')}`}>
              Clear selection
            </button>
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-[var(--text-muted)]">Click a node in the graph to see its statement and data.</p>
        )}
      </aside>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
