import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Device } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { RevokeDevice } from '@/components/RevokeDevice';
import { RegisterDevice } from '@/components/RegisterDevice';

export default async function DevicesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const list = await serverGet<{ data: Device[] }>('/devices');
  const devices = list?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Vifaa"
        lede="Saa za mkononi na vitambuzi vya magari. Kifaa kilichofutwa hakiwezi kutuma taarifa wala kuita dharura."
      />

      <RegisterDevice />

      {devices.length === 0 ? (
        <Empty>Hakuna kifaa kilichosajiliwa.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {devices.map((d) => (
            <li key={d.id}>
              <Card accent={d.status === 'revoked' ? 'border border-line' : 'border-l-4 border-petrol'}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{d.label ?? d.device_type.replace(/_/g, ' ')}</span>
                  <span className="text-sm text-ink-soft">{d.status}</span>
                </div>
                <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">{d.serial_number}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {d.vehicle_registration ? `Gari: ${d.vehicle_registration} · ` : ''}
                  Ilionekana mwisho: {dateTime(d.last_seen_at)}
                  {d.battery_percent !== null ? ` · betri ${d.battery_percent}%` : ''}
                </p>
                {d.status !== 'revoked' && <RevokeDevice deviceId={d.id} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
