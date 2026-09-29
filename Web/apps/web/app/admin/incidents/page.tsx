import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { IncidentReport, Page } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';

const SEVERITY_LABEL: Record<string, string> = {
  low: 'Low', moderate: 'Moderate', serious: 'Serious', catastrophic: 'Catastrophic',
};

export default async function IncidentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<IncidentReport>>('/incident-reports?limit=50');
  const items = page?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Incident reports"
        lede="Governance-escalated reports are visible for operational follow-up. Anonymous reports remain anonymous."
      />

      {items.length === 0 ? (
        <Empty>No incident reports have been submitted.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card accent={
                r.severity === 'catastrophic' || r.severity === 'serious'
                  ? 'border-l-4 border-clay'
                  : r.severity === 'moderate' ? 'border-l-4 border-amber' : 'border border-line'
              }>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{r.category.replace(/_/g, ' ')}</span>
                  <Badge tone={r.severity === 'catastrophic' || r.severity === 'serious' ? 'problem' : r.severity === 'moderate' ? 'attention' : 'neutral'}>
                    {SEVERITY_LABEL[r.severity] ?? r.severity}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[0.95rem]">{r.description}</p>
                <p className="mt-2 text-sm text-ink-soft">
                  {dateTime(r.reported_at)} · {r.status}
                  {/*
                    Anonymity is real, not a display setting: the reporter's id
                    was never written to the row at all, including in the audit
                    trail. Saying so here keeps anyone from going looking.
                  */}
                  {r.anonymous ? ' · anonymous report' : ''}
                  {r.escalated_to_governance ? ' · escalated to governance' : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
