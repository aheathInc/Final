import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Consultation, Page, QueueEntry } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Card, Empty, Notice, PageHeader, PageShell } from '@/components/ui';

export default async function WorkHistoryPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const [active, completed] = await Promise.all([
    serverGet<Page<QueueEntry>>('/queue?scope=mine&limit=50'),
    serverGet<Page<Consultation>>('/consultations?status=completed&limit=50'),
  ]);

  return (
    <PageShell>
      <PageHeader title="Work history" lede="Persisted consultations assigned to your clinician profile." />
      {!active && !completed && <div className="mt-5"><Notice>Work history could not be loaded. Try again later.</Notice></div>}

      <section className="mt-7">
        <h2 className="text-lg font-semibold">Active consultations</h2>
        {!active?.data.length ? <Empty>No active consultations are assigned to you.</Empty> : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {active.data.map(({ consultation }) => (
              <li key={consultation.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm">{consultation.id.slice(0, 8)}</span>
                    <Badge tone="info">{consultation.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">Urgency: {consultation.urgency_level} · Added {dateTime(consultation.created_at)}</p>
                  <Link className="mt-3 inline-block min-h-11 bg-petrol px-5 py-2.5 font-medium text-white hover:bg-petrol-lift" href={`/doctor/case/${consultation.id}`}>Open consultation</Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-9">
        <h2 className="text-lg font-semibold">Completed consultations</h2>
        {!completed?.data.length ? <Empty>No completed consultations are in your history.</Empty> : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {completed.data.map((consultation) => (
              <li key={consultation.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm">{consultation.id.slice(0, 8)}</span>
                    <Badge tone="good">Completed</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">Urgency: {consultation.urgency_level} · Added {dateTime(consultation.created_at)}</p>
                  <Link className="mt-3 inline-block min-h-11 bg-petrol px-5 py-2.5 font-medium text-white hover:bg-petrol-lift" href={`/doctor/case/${consultation.id}`}>Open consultation</Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
