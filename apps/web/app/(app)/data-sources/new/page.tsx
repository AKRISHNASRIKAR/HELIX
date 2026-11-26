import Link from 'next/link';
import { Panel } from '../../../../components/panel';
import { PageHeader, linkClass } from '../../../../components/ui';
import { CsvForm, GithubForm, McpForm, PostgresForm } from './connect-forms';

export const metadata = { title: 'Connect a data source · HELIX' };

const TABS = [
  { key: 'postgres', label: 'PostgreSQL' },
  { key: 'csv', label: 'CSV upload' },
  { key: 'mcp', label: 'MCP server' },
  { key: 'github', label: 'GitHub' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PANEL: Record<TabKey, { title: string; subtitle: string }> = {
  postgres: {
    title: 'PostgreSQL connection',
    subtitle: 'Credentials are encrypted at rest and never returned by the API.',
  },
  csv: { title: 'Upload a CSV file', subtitle: 'The file is stored by the API and read by the ingestion service.' },
  mcp: {
    title: 'MCP server',
    subtitle: 'Connect any Model Context Protocol server, for example a deployments feed. Agents read its tools as tables.',
  },
  github: {
    title: 'GitHub repository',
    subtitle: 'Deployments, releases and commits become tables the Product agent can align with metric changes.',
  },
};

export default async function NewDataSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const current: TabKey = TABS.find((t) => t.key === type)?.key ?? 'postgres';

  return (
    <main className="max-w-2xl space-y-6">
      <Link href="/data-sources" className={`text-sm ${linkClass}`}>
        ← Data sources
      </Link>
      <PageHeader title="Connect a data source" description="HELIX tests the connection and discovers tables right away." />

      <nav className="inline-flex max-w-full flex-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5" aria-label="Source type">
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

      <Panel title={PANEL[current].title} subtitle={PANEL[current].subtitle}>
        {current === 'csv' ? (
          <CsvForm />
        ) : current === 'mcp' ? (
          <McpForm />
        ) : current === 'github' ? (
          <GithubForm />
        ) : (
          <PostgresForm />
        )}
      </Panel>
    </main>
  );
}
