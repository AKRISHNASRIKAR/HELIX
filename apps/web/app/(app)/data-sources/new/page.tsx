import Link from 'next/link';
import { Panel } from '../../../../components/panel';
import { PageHeader, linkClass } from '../../../../components/ui';
import { CsvForm, GithubForm, McpForm, PostgresForm } from './connect-forms';
import { TypeTabs } from './type-tabs';
import { Reveal } from '../../../../components/motion';

export const metadata = { title: 'Connect a data source · HELIX' };

const TABS = [
  { key: 'postgres', label: 'PostgreSQL', icon: 'POSTGRESQL' },
  { key: 'csv', label: 'CSV upload', icon: 'CSV' },
  { key: 'mcp', label: 'MCP server', icon: 'MCP' },
  { key: 'github', label: 'GitHub', icon: 'GITHUB' },
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
      <PageHeader eyebrow="Data" title="Connect a data source" description="HELIX tests the connection and discovers tables right away." />

      <TypeTabs tabs={TABS} current={current} />

      <Reveal key={current}>
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
      </Reveal>
    </main>
  );
}
