import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Appointment, Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { AppointmentActions } from '@/components/AppointmentActions';

export default async function AppointmentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<Appointment>>('/appointments?limit=50');
  const items = page?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Miadi" lede="Miadi iliyopangwa. Kuianzisha hufungua kesi mpya kwa mgonjwa huyo." />

      {items.length === 0 ? (
        <Empty>Huna miadi iliyopangwa.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{dateTime(a.starts_at)}</span>
                  <span className="text-sm text-ink-soft">{a.duration_minutes} dak · {a.modality}</span>
                </div>
                {a.reason && <p className="mt-1 text-[0.95rem]">{a.reason}</p>}
                <p className="mt-1 text-sm text-ink-soft">Hali: {a.status}</p>
                {a.status === 'booked' && <AppointmentActions id={a.id} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
