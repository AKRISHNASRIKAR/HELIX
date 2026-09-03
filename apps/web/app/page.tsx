import Link from 'next/link';
import { Card, StatusPill } from '@helix/ui';
import { getApiHealth, getInvestigations } from '../lib/api';
import { countActive, formatDate, formatTriggerType } from '../lib/investigations';

export default async function DashboardPage() {
  const [health, investigations] = await Promise.all([getApiHealth(), getInvestigations()]);

  const stats = [
    {
      title: 'Active Investigations',
      value: String(countActive(investigations)),
      hint: 'live from GET /api/v1/investigations',
    },
    {
      title: 'Total Investigations',
      value: String(investigations.length),
      hint: 'live from GET /api/v1/investigations',
    },
    { title: 'Detected Anomalies', value: '—', hint: 'Phase 3' },
    { title: 'Connected Data Sources', value: '—', hint: 'Phase 2' },
  ];

  const recent = [...investigations]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <main className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">HELIX</h1>
        <p className="mt-1 text-sm text-slate-500">Autonomous Enterprise Investigation Platform</p>
      </header>

      <Card className="flex items-center justify-between">
        <span className="text-sm font-medium">API connection</span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            health?.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {health?.status === 'ok' ? 'connected' : 'unreachable'}
        </span>
      </Card>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((section) => (
          <Card key={section.title}>
            <p className="text-sm text-slate-500">{section.title}</p>
            <p className="mt-2 text-2xl font-semibold">{section.value}</p>
            <p className="mt-1 text-xs text-slate-400">{section.hint}</p>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent investigations</h2>
          <Link href="/investigations" className="text-sm text-slate-600 hover:text-slate-900">
            View all →
          </Link>
        </div>

        {recent.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-500">
              No investigations yet. They&apos;ll appear here once the Phase 1 create endpoint
              lands — until then the API only serves an empty read-only list.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100 p-0">
            {recent.map((investigation) => (
              <Link
                key={investigation.id}
                href={`/investigations/${investigation.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{investigation.question}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatTriggerType(investigation.triggerType)} ·{' '}
                    {formatDate(investigation.createdAt)}
                  </p>
                </div>
                <StatusPill status={investigation.status} />
              </Link>
            ))}
          </Card>
        )}
      </section>
    </main>
  );
}
