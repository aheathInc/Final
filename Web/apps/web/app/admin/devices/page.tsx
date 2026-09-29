import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Device } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { RevokeDevice } from '@/components/RevokeDevice';
import { RegisterDevice } from '@/components/RegisterDevice';

export default async function DevicesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const list = await serverGet<{ data: Device[] }>('/devices');
  const devices = list?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Devices"
        lede="Wearables and vehicle sensors. Revoked devices cannot post telemetry or raise emergencies."
      />

      <RegisterDevice />

      {devices.length === 0 ? (
        <Empty>No devices are registered.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {devices.map((d) => (
            <li key={d.id}>
              <Card accent={d.status === 'revoked' ? 'border border-line' : 'border-l-4 border-petrol'}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{d.label ?? d.device_type.replace(/_/g, ' ')}</span>
                  <Badge tone={d.status === 'active' ? 'good' : 'neutral'}>{d.status}</Badge>
                </div>
                <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">{d.serial_number}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {d.vehicle_registration ? `Vehicle: ${d.vehicle_registration} · ` : ''}
                  Last seen: {dateTime(d.last_seen_at)}
                  {d.battery_percent !== null ? ` · battery ${d.battery_percent}%` : ''}
                </p>
                {d.status !== 'revoked' && <RevokeDevice deviceId={d.id} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
