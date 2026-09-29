import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Page, Payment } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { RefundPayment } from '@/components/RefundPayment';

export default async function PaymentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<Payment>>('/payments?limit=50');
  const items = page?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Payments"
        lede="Settled local/mock payments. Partial refunds are limited by the remaining refundable balance."
      />

      {items.length === 0 ? (
        <Empty>No settled payments are available.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((p) => {
            const remaining = p.amount - (p.refunded_amount ?? 0);
            return (
              <li key={p.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="font-mono text-lg tabular-nums">
                      {p.amount.toLocaleString()} {p.currency}
                    </span>
                    <Badge tone={p.status === 'succeeded' ? 'good' : p.status.includes('refund') ? 'attention' : 'neutral'}>{p.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {p.purpose.replace(/_/g, ' ')} · {p.method.replace(/_/g, ' ')}
                    {p.provider ? ` · ${p.provider}` : ''} · {dateTime(p.settled_at)}
                  </p>
                  {/*
                    The provider's own reference, not ours. A support call with
                    the mobile money operator is conducted against this number;
                    our internal id means nothing to them.
                  */}
                  {p.provider_reference && (
                    <p className="mt-1 font-mono text-xs tabular-nums text-ink-soft">
                      Provider reference: {p.provider_reference}
                    </p>
                  )}
                  {p.refunded_amount > 0 && (
                    <p className="mt-1 text-sm text-amber">
                      Refunded {p.refunded_amount.toLocaleString()} {p.currency} · remaining{' '}
                      {remaining.toLocaleString()}
                    </p>
                  )}
                  {remaining > 0 && p.status !== 'refunded' && (
                    <RefundPayment paymentId={p.id} maxAmount={remaining} currency={p.currency} />
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
