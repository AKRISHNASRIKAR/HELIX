import Link from 'next/link';
import { Panel } from '../../../../components/panel';
import { PageHeader, linkClass } from '../../../../components/ui';
import { CsvForm, PostgresForm } from './connect-forms';

export const metadata = { title: 'Connect a data source · HELIX' };

const TABS = [
  { key: 'postgres', label: 'PostgreSQL' },
  { key: 'csv', label: 'CSV upload' },
] as const;

export default async function NewDataSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const current = type === 'csv' ? 'csv' : 'postgres';

  return (
    <main className="max-w-2xl space-y-6">
      <Link href="/data-sources" className={`text-sm ${linkClass}`}>
        ← Data sources
      </Link>
      <PageHeader title="Connect a data source" description="HELIX tests the connection and discovers tables right away." />

      <nav className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5" aria-label="Source type">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/data-sources/new?type=${tab.key}`}
            aria-current={current === tab.key ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] ${
              current === tab.key
                ? 'bg-[#0b0b0b] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Panel
        title={current === 'csv' ? 'Upload a CSV file' : 'PostgreSQL connection'}
        subtitle={
          current === 'csv'
            ? 'The file is stored by the API and read by the ingestion service.'
            : 'Credentials are encrypted at rest and never returned by the API.'
        }
      >
        {current === 'csv' ? <CsvForm /> : <PostgresForm />}
      </Panel>
    </main>
  );
}
