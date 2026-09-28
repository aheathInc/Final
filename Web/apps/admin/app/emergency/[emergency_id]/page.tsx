import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { EmergencyRequest, Facility, TransportUnit } from '@/lib/api';
import { Notice, PageHeader } from '@/components/ui';
import { STATUS_LABEL } from '@/lib/emergency';
import { dateTime } from '@/lib/format';
import { DispatchPanel } from '@/components/DispatchPanel';

export default async function EmergencyDetail({ params }: { params: { emergency_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const e = await serverGet<EmergencyRequest>(`/emergency-requests/${params.emergency_id}`);
  if (!e) {
    return <div className="mx-auto max-w-3xl px-6 py-8"><Notice>Dharura hii haikupatikana.</Notice></div>;
  }

  const [units, facilities] = await Promise.all([
    serverGet<{ data: TransportUnit[] }>(
      `/transport-units?status=available&near_lat=${e.location.lat}&near_lng=${e.location.lng}`,
    ),
    serverGet<{ data: Facility[] }>('/facilities?limit=50'),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/emergency" className="text-sm text-petrol underline underline-offset-4">
        Rudi kwenye ubao
      </Link>

      <div className="mt-4">
        <PageHeader
          title={e.scale === 'mass_casualty' ? 'Ajali kubwa' : 'Dharura ya mtu mmoja'}
          lede={e.description ?? 'Hakuna maelezo yaliyotolewa.'}
          action={<span className="text-sm font-medium">{STATUS_LABEL[e.status]}</span>}
        />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
        <div><dt className="inline">Aina: </dt><dd className="inline">{e.category}</dd></div>
        <div><dt className="inline">Chanzo: </dt><dd className="inline">{e.source}</dd></div>
        <div><dt className="inline">Iliripotiwa: </dt><dd className="inline">{dateTime(e.reported_at)}</dd></div>
        <div>
          <dt className="inline">Mahali: </dt>
          <dd className="inline font-mono tabular-nums">
            {e.location.lat.toFixed(5)}, {e.location.lng.toFixed(5)}
          </dd>
        </div>
        {e.estimated_casualties && (
          <div><dt className="inline">Waathirika: </dt><dd className="inline">{e.estimated_casualties}</dd></div>
        )}
      </dl>

      <DispatchPanel
        emergency={e}
        units={units?.data ?? []}
        facilities={facilities?.data ?? []}
      />
    </div>
  );
}
