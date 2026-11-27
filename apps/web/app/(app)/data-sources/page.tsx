import Link from 'next/link';
import { DataSourceStatusPill } from '@helix/ui';
import { getDataSources, type DataSourceSummary } from '../../../lib/api';
import { formatRelative } from '../../../lib/format';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader, buttonClass } from '../../../components/ui';
import { CountUp, SpotlightCard, Stagger } from '../../../components/motion';
import { SOURCE_LABEL, SourceIcon, SourceTile } from '../../../components/brand/source-icon';

export const metadata = { title: 'Data sources · HELIX' };

export default async function DataSourcesPage() {
  const sources = await getDataSources();
  const connected = sources?.filter((s) => s.status === 'CONNECTED').length ?? 0;
  const tables = sources?.reduce((n, s) => n + (s.tables ?? 0), 0) ?? 0;

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Data"
        title="Data sources"
        description="Databases, files, MCP servers and repositories your agents can read. HELIX discovers tables and column types on connect."
        actions={
          <Link href="/data-sources/new" className={buttonClass('primary', 'md')}>
            + Connect a source
          </Link>
        }
      />

      {sources === null ? (
        <Notice tone="error">Could not load data sources. Check that the HELIX API is running and try again.</Notice>
      ) : sources.length === 0 ? (
        <Panel>
          <div className="flex justify-center gap-3 pt-6 text-[var(--text-muted)]" aria-hidden>
            {['CSV', 'POSTGRESQL', 'MCP', 'GITHUB'].map((t) => (
              <span key={t} className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                <SourceIcon type={t} />
              </span>
            ))}
          </div>
          <EmptyState title="No data sources yet" action={{ href: '/data-sources/new', label: 'Connect a data source' }}>
            Connect a PostgreSQL database, upload a CSV, or connect an MCP server or GitHub repository. Credentials are encrypted at rest and never shown again.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 sm:max-w-xl">
            {[
              { label: 'Sources', value: sources.length },
              { label: 'Connected', value: connected },
              { label: 'Tables found', value: tables },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow)]">
                <dt className="text-[11px] text-[var(--text-muted)]">{s.label}</dt>
                <dd className="mt-1 text-3xl font-semibold tracking-tight">
                  <CountUp value={s.value} />
                </dd>
              </div>
            ))}
          </dl>

          <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sources.map((s) => (
              <SourceCard key={s.id ?? s.name} source={s} />
            ))}
            <Link
              href="/data-sources/new"
              className="group grid h-full min-h-[180px] place-items-center rounded-2xl border border-dashed border-[var(--border-strong)] text-center text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span>
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-[var(--border-strong)] text-lg transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110">
                  +
                </span>
                <span className="mt-2 block font-medium">Connect another source</span>
              </span>
            </Link>
          </Stagger>
        </>
      )}
    </main>
  );
}

function SourceCard({ source: s }: { source: DataSourceSummary }) {
  const body = (
    <SpotlightCard className="h-full">
      <div className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <SourceTile type={s.type} status={s.status} />
          <DataSourceStatusPill status={s.status} />
        </div>
        <h2 className="mt-4 truncate text-lg font-semibold tracking-tight">{s.name}</h2>
        <p className="text-xs text-[var(--text-muted)]">{SOURCE_LABEL[s.type] ?? s.type}</p>
        {s.status === 'ERROR' && s.statusMessage && (
          <p className="mt-2 line-clamp-2 text-xs text-[var(--text-bad)]">{s.statusMessage}</p>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div>
            <p className="text-3xl font-semibold leading-none tracking-tight">
              <CountUp value={s.tables} />
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">table{s.tables === 1 ? '' : 's'}</p>
          </div>
          <p className="text-right text-[11px] text-[var(--text-muted)]">
            Synced
            <span className="block text-xs text-[var(--text-secondary)]">{formatRelative(s.lastSyncedAt)}</span>
          </p>
        </div>
      </div>
    </SpotlightCard>
  );
  return s.id ? (
    <Link
      href={`/data-sources/${s.id}`}
      className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      aria-label={`${s.name}, ${SOURCE_LABEL[s.type] ?? s.type}`}
    >
      {body}
    </Link>
  ) : (
    body
  );
}
