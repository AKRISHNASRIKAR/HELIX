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
  const findings = investigation.findings ?? [];
  const recommendations = investigation.recommendations ?? [];

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

      {findings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Findings</h2>
          <div className="space-y-3">
            {findings.map((f) => (
              <Card key={f.statement} className={f.isRootCause ? 'border-[var(--series-1)] ring-1 ring-[var(--series-1)]' : undefined}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {f.agentType.toLowerCase()} agent · {f.analyticsType.toLowerCase()}
                      {f.isRootCause && <span className="ml-2 rounded bg-[var(--series-1)] px-1.5 py-0.5 text-[10px] text-white">ROOT CAUSE</span>}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{f.statement}</p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {f.evidence.map((e) => (
                        <li key={e} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{e}</li>
                      ))}
                    </ul>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{Math.round(f.confidence * 100)}%</span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Recommendations</h2>
          <Card className="divide-y divide-slate-100 p-0">
            {recommendations.map((r) => (
              <div key={r.action} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium">{r.action}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{r.expectedImpact}</p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{r.priority.toLowerCase()}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

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
