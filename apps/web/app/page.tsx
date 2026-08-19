import { Card } from '@helix/ui';
import { getApiHealth } from '../lib/api';

const DASHBOARD_SECTIONS = [
  { title: 'Active Investigations', value: '—', hint: 'Phase 1' },
  { title: 'Detected Anomalies', value: '—', hint: 'Phase 3' },
  { title: 'Recent Insights', value: '—', hint: 'Phase 4' },
  { title: 'Connected Data Sources', value: '—', hint: 'Phase 2' },
] as const;

export default async function DashboardPage() {
  const health = await getApiHealth();

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
            health?.status === 'ok'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {health?.status === 'ok' ? 'connected' : 'unreachable'}
        </span>
      </Card>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DASHBOARD_SECTIONS.map((section) => (
          <Card key={section.title}>
            <p className="text-sm text-slate-500">{section.title}</p>
            <p className="mt-2 text-2xl font-semibold">{section.value}</p>
            <p className="mt-1 text-xs text-slate-400">Implemented in {section.hint}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
