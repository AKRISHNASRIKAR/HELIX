import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataSourceStatusPill } from '@helix/ui';
import {
  getDataSource,
  getDataSourcePreview,
  getDataSourceProfile,
  type DiscoveredTable,
} from '../../../../lib/api';
import { formatCell, formatNumber, formatPercent, formatRelative } from '../../../../lib/format';
import { formatDate } from '../../../../lib/investigations';
import { Panel } from '../../../../components/panel';
import { EmptyState, Notice, PageHeader, linkClass } from '../../../../components/ui';
import { SourceActions } from './source-actions';

export const metadata = { title: 'Data source · HELIX' };

const TYPE_EYEBROW: Record<string, string> = {
  CSV: 'CSV upload',
  POSTGRESQL: 'PostgreSQL',
  MCP: 'MCP server',
  GITHUB: 'GitHub repository',
  REST_API: 'REST API',
};

export default async function DataSourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ table?: string }>;
}) {
  const [{ id }, { table: requested }] = await Promise.all([params, searchParams]);
  const res = await getDataSource(id);

  if (!res.ok) {
    if (res.status === 404 || res.status === 400 || res.status === 403) notFound();
    return (
      <main className="space-y-6">
        <BackLink />
        <Notice tone="error">Could not load this data source. {res.error}</Notice>
      </main>
    );
  }

  const source = res.data;
  const schemas = source.schemas ?? [];
  const selected: DiscoveredTable | undefined =
    schemas.find((t) => t.tableName === requested) ?? schemas[0];

  return (
    <main className="space-y-6">
      <BackLink />
      <PageHeader
        eyebrow={TYPE_EYEBROW[source.type] ?? source.type}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {source.name}
            <DataSourceStatusPill status={source.status} />
          </span>
        }
        description={`${schemas.length} table${schemas.length === 1 ? '' : 's'} discovered · last synced ${formatRelative(source.lastSyncedAt)}`}
        actions={<SourceActions id={source.id} name={source.name} />}
      />

      {source.status === 'ERROR' && (
        <Notice tone="error">
          <span className="font-medium">Connection failed.</span>{' '}
          {source.statusMessage ?? 'The ingestion service could not connect to this source.'} Fix the source and
          press Sync schema to retry.
        </Notice>
      )}
      {source.status === 'PENDING' && (
        <Notice tone="info">Connecting and discovering tables. Refresh in a moment.</Notice>
      )}

      {schemas.length === 0 ? (
        <Panel>
          <EmptyState title="No tables discovered">
            {source.status === 'CONNECTED'
              ? source.type === 'MCP'
                ? 'The server is reachable but exposes no list_* or get_* tools without required inputs.'
                : 'The connection works but no tables were found in the configured schema.'
              : 'Tables appear here once the source connects successfully.'}
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Panel title="Tables" className="!p-3 lg:self-start">
            <nav aria-label="Tables">
              <ul className="space-y-0.5">
                {schemas.map((t) => {
                  const active = t.tableName === selected?.tableName;
                  return (
                    <li key={t.tableName}>
                      <Link
                        href={`/data-sources/${source.id}?table=${encodeURIComponent(t.tableName)}`}
                        aria-current={active ? 'true' : undefined}
                        scroll={false}
                        className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] ${
                          active
                            ? 'bg-[var(--canvas)] font-medium text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--canvas)]'
                        }`}
                      >
                        <span className="truncate font-mono text-[13px]">{t.tableName}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                          {t.columns.length} cols
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </Panel>
          {selected && <TableDetail sourceId={source.id} table={selected} />}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">Added {formatDate(source.createdAt)}</p>
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/data-sources" className={`text-sm ${linkClass}`}>
      ← Data sources
    </Link>
  );
}

async function TableDetail({ sourceId, table }: { sourceId: string; table: DiscoveredTable }) {
  const [preview, profile] = await Promise.all([
    getDataSourcePreview(sourceId, table.tableName),
    getDataSourceProfile(sourceId, table.tableName),
  ]);
  const stats = new Map(profile.ok ? profile.data.columns.map((c) => [c.name, c]) : []);

  return (
    <div className="min-w-0 space-y-4">
      <Panel
        title={table.tableName}
        subtitle={
          profile.ok
            ? `${formatNumber(profile.data.rowCount)} rows profiled · ${table.columns.length} columns`
            : `${table.rowCountEstimate != null ? `~${formatNumber(table.rowCountEstimate)} rows · ` : ''}${table.columns.length} columns`
        }
      >
        {!profile.ok && (
          <div className="mb-3">
            <Notice tone="error">Profile unavailable: {profile.error}</Notice>
          </div>
        )}
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-y border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">Column</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Semantic</th>
                <th scope="col" className="px-3 py-2 font-medium">Nullable</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Nulls</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">Distinct</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--grid)]">
              {table.columns.map((c) => {
                const s = stats.get(c.name);
                return (
                  <tr key={c.name}>
                    <td className="px-5 py-2 font-mono text-[13px]">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">{c.type}</td>
                    <td className="px-3 py-2">
                      {c.semanticType ?? s?.semanticType ? (
                        <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                          {c.semanticType ?? s?.semanticType}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{c.nullable ? 'yes' : 'no'}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-[var(--text-secondary)]">
                      {s ? formatPercent(s.nullRate) : '-'}
                    </td>
                    <td className="px-5 py-2 text-right text-xs tabular-nums text-[var(--text-secondary)]">
                      {s ? formatNumber(s.distinctCount) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Preview" subtitle="First 50 rows">
        {!preview.ok ? (
          <Notice tone="error">Preview unavailable: {preview.error}</Notice>
        ) : preview.data.rows.length === 0 ? (
          <EmptyState title="This table is empty" />
        ) : (
          <div className="-mx-5 -mb-5 max-h-[480px] overflow-auto border-t border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--surface)] text-left text-[11px] text-[var(--text-muted)] shadow-[0_1px_0_var(--border)]">
                <tr>
                  {preview.data.columns.map((col) => (
                    <th key={col} scope="col" className="whitespace-nowrap px-3 py-2 font-mono font-medium first:pl-5">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--grid)]">
                {preview.data.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-[var(--canvas)]">
                    {preview.data.columns.map((col) => {
                      const value = row[col];
                      return (
                        <td
                          key={col}
                          className={`max-w-[260px] truncate whitespace-nowrap px-3 py-1.5 font-mono tabular-nums first:pl-5 ${
                            value == null ? 'text-[var(--text-muted)]' : ''
                          }`}
                          title={formatCell(value)}
                        >
                          {formatCell(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
