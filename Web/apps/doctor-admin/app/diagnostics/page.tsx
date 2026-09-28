import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { InvestigationOrder, Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default async function DiagnosticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<InvestigationOrder>>('/investigation-orders?limit=50');
  const orders = page?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Vipimo"
        lede="Matokeo yenye thamani ya hatari yanawekwa juu. Matokeo hayahesabiwi kuwa yamepokelewa hadi uthibitishe."
      />

      {orders.length === 0 ? (
        <Empty>Huna vipimo vilivyoombwa.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Card accent={o.is_critical ? 'border-l-4 border-clay' : 'border border-line'}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/diagnostics/${o.id}`} className="font-medium text-petrol underline underline-offset-4">
                    {o.investigation_code}
                  </Link>
                  {o.is_critical && <span className="text-sm font-semibold text-clay">Thamani ya hatari</span>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {o.investigation_type} · {o.status} · iliombwa {dateTime(o.ordered_at)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
