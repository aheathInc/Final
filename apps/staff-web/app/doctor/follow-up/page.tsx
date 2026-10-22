import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Page } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface AdherenceLog {
  id: string;
  medication_name: string;
  dosage: string;
  scheduled_at: string;
  reported_status: 'unreported' | 'taken' | 'missed' | 'partial';
}

export default async function FollowUpPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<AdherenceLog>>('/adherence-logs?limit=50');
  const logs = page?.data ?? [];

  // Missed doses first: three consecutive misses raise an audit event on the
  // backend, so the ones worth a clinician's attention are the ones drifting.
  const missed = logs.filter((l) => l.reported_status === 'missed');
  const rest = logs.filter((l) => l.reported_status !== 'missed');

  return (
    <PageShell>
      <PageHeader
        title="Follow-up"
        lede="Reported medication adherence. Missed doses are shown first because they are the ones drifting from the care plan."
      />

      {logs.length === 0 ? (
        <Empty>No active follow-up records are available.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {[...missed, ...rest].map((l) => (
            <li key={l.id}>
              <Card accent={l.reported_status === 'missed' ? 'border-l-4 border-amber' : 'border border-line'}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{l.medication_name} {l.dosage}</span>
                  <Badge tone={l.reported_status === 'missed' ? 'attention' : l.reported_status === 'taken' ? 'good' : 'neutral'}>
                    {l.reported_status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{dateTime(l.scheduled_at)}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
