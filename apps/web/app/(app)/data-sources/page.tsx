import Link from 'next/link';
import { DataSourceStatusPill } from '@helix/ui';
import { getDataSources } from '../../../lib/api';
import { formatRelative } from '../../../lib/format';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader, buttonClass } from '../../../components/ui';

export const metadata = { title: 'Data sources · HELIX' };

const TYPE_LABEL: Record<string, string> = {
  POSTGRESQL: 'PostgreSQL',
  CSV: 'CSV upload',
  REST_API: 'REST API',
  GITHUB: 'GitHub',
  MCP: 'MCP',
};

export default async function DataSourcesPage() {
  const sources = await getDataSources();

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Data"
        title="Data sources"
        description="Databases and files your agents can read. HELIX discovers tables and column types on connect."
        actions={
          <Link href="/data-sources/new" className={buttonClass('primary')}>
            + Connect a source
          </Link>
        }
      />

      {sources === null ? (
        <Notice tone="error">Could not load data sources. Check that the HELIX API is running and try again.</Notice>
      ) : sources.length === 0 ? (
        <Panel>
          <EmptyState title="No data sources yet" action={{ href: '/data-sources/new', label: 'Connect a data source' }}>
            Connect a PostgreSQL database or upload a CSV. Credentials are encrypted at rest and never shown again.
          </EmptyState>
        </Panel>
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Tables</th>
                  <th scope="col" className="px-5 py-3 font-medium">Last synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--grid)]">
                {sources.map((s) => (
                  <tr key={s.id ?? s.name} className="align-top hover:bg-[var(--canvas)]">
                    <td className="px-5 py-3">
                      {s.id ? (
                        <Link
                          href={`/data-sources/${s.id}`}
                          className="rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]"
                        >
                          {s.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{s.name}</span>
                      )}
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{TYPE_LABEL[s.type] ?? s.type}</p>
                    </td>
                    <td className="px-5 py-3">
                      <DataSourceStatusPill status={s.status} />
                      {s.status === 'ERROR' && s.statusMessage && (
                        <p className="mt-1 max-w-sm text-xs text-[var(--text-bad)]">{s.statusMessage}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{s.tables}</td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">{formatRelative(s.lastSyncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}
