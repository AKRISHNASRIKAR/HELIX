import Link from 'next/link';
import { Card, StatusPill } from '@helix/ui';
import { getInvestigations } from '../../lib/api';
import { formatDate, formatTriggerType } from '../../lib/investigations';

export const metadata = {
  title: 'Investigations — HELIX',
};

export default async function InvestigationsPage() {
  const investigations = await getInvestigations();

  const sorted = [...investigations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Investigations</h1>
        <p className="text-sm text-slate-500">
          Every question asked of HELIX. Creating and running investigations arrives in Phase 1
          (CRUD) and Phase 5 (execution) — today this is a read-only view of{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">GET /api/v1/investigations</code>.
        </p>
      </header>

      {sorted.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No investigations to show. Either the API is unreachable or the list is empty (it will
            stay empty until the Phase 1 <code className="text-xs">POST /investigations</code>{' '}
            endpoint exists).
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Question</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Trigger</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((investigation) => (
                <tr key={investigation.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/investigations/${investigation.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {investigation.question}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={investigation.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatTriggerType(investigation.triggerType)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(investigation.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
