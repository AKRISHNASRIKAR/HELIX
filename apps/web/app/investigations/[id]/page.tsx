import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, StatusPill } from '@helix/ui';
import { getInvestigation } from '../../../lib/api';
import { formatDate, formatTriggerType } from '../../../lib/investigations';

export default async function InvestigationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const investigation = await getInvestigation(id);

  if (!investigation) notFound();

  const meta = [
    { label: 'Trigger', value: formatTriggerType(investigation.triggerType) },
    {
      label: 'Confidence',
      value:
        investigation.overallConfidence == null
          ? '—'
          : `${Math.round(investigation.overallConfidence * 100)}%`,
    },
    { label: 'Created', value: formatDate(investigation.createdAt) },
    { label: 'Started', value: formatDate(investigation.startedAt) },
    { label: 'Completed', value: formatDate(investigation.completedAt) },
  ];

  const planSteps = investigation.plan?.steps ?? [];

  return (
    <main className="space-y-6">
      <Link href="/investigations" className="text-sm text-slate-600 hover:text-slate-900">
        ← Investigations
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{investigation.question}</h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{investigation.id}</p>
        </div>
        <StatusPill status={investigation.status} />
      </header>

      <Card>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {meta.map((item) => (
            <div key={item.label}>
              <dt className="text-xs uppercase tracking-wide text-slate-400">{item.label}</dt>
              <dd className="mt-1 text-sm text-slate-900">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Summary</h2>
        <Card>
          <p className="text-sm text-slate-600">
            {investigation.summary ?? (
              <span className="text-slate-400">
                No summary yet — investigations are not executed until the Coordinator agent lands
                in Phase 5. Records created before then stay at PENDING.
              </span>
            )}
          </p>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Plan</h2>
        <Card className={planSteps.length > 0 ? 'divide-y divide-slate-100 p-0' : undefined}>
          {planSteps.length === 0 ? (
            <p className="text-sm text-slate-400">
              No plan. The Coordinator produces an InvestigationPlan (Phase 5) — until then this is
              always empty.
            </p>
          ) : (
            planSteps.map((step) => (
              <div key={step.order} className="flex gap-3 p-4">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                  {step.order}
                </span>
                <div>
                  <p className="text-sm font-medium">{step.agentType}</p>
                  <p className="text-sm text-slate-600">{step.objective}</p>
                  {step.dependsOn.length > 0 && (
                    <p className="mt-1 text-xs text-slate-400">
                      depends on step{step.dependsOn.length > 1 ? 's' : ''}{' '}
                      {step.dependsOn.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </Card>
      </section>
    </main>
  );
}
