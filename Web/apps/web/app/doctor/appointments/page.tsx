import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Appointment, Page } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { AppointmentActions } from '@/components/AppointmentActions';

export default async function AppointmentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<Appointment>>('/appointments?limit=50');
  const items = page?.data ?? [];

  return (
    <PageShell>
      <PageHeader title="Appointments" lede="Scheduled visits. Starting a booked appointment opens the existing clinical workflow for that patient." />

      {items.length === 0 ? (
        <Empty>No appointments are scheduled for you.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{dateTime(a.starts_at)}</span>
                  <span className="text-sm text-ink-soft">{a.duration_minutes} min · {a.modality}</span>
                </div>
                {a.reason && <p className="mt-1 text-[0.95rem]">{a.reason}</p>}
                <div className="mt-2"><Badge tone={a.status === 'booked' ? 'good' : 'neutral'}>{a.status.replace(/_/g, ' ')}</Badge></div>
                {a.status === 'booked' && <AppointmentActions id={a.id} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
