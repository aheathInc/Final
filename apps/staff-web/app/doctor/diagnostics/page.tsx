import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { InvestigationOrder, Page } from '@/lib/api';
import { Badge, Card, Empty, Notice, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default async function DiagnosticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<InvestigationOrder>>('/investigation-orders?limit=50');
  const orders = page?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Diagnostics"
        lede="Critical results are prioritised. A result is not treated as received until it is acknowledged."
      />

      {!page ? (
        <div className="mt-6">
          <Notice>Unable to load diagnostic orders.</Notice>
        </div>
      ) : orders.length === 0 ? (
        <Empty>You do not have diagnostic orders yet.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Card accent={o.is_critical ? 'border-l-4 border-clay' : 'border border-line'}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/doctor/diagnostics/${o.id}`} className="font-medium text-petrol underline underline-offset-4">
                    {o.investigation_code}
                  </Link>
                  {o.is_critical && <Badge tone="problem">Critical</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {o.investigation_type.replace(/_/g, ' ')} · {o.status.replace(/_/g, ' ')} · ordered {dateTime(o.ordered_at)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
