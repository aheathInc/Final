import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { InvestigationOrder } from '@/lib/api';
import { Notice, PageHeader } from '@/components/ui';
import { flagStyle } from '@/lib/urgency';
import { dateTime } from '@/lib/format';
import { AcknowledgeResult } from '@/components/AcknowledgeResult';

export default async function OrderPage({ params }: { params: { order_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const o = await serverGet<InvestigationOrder>(`/investigation-orders/${params.order_id}`);
  if (!o) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Notice>Kipimo hiki hakikupatikana.</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/doctor/" className="text-sm text-petrol underline underline-offset-4">
        Rudi kwenye vipimo
      </Link>
      <div className="mt-4">
        <PageHeader title={o.investigation_code}
          lede={`${o.investigation_type} · iliombwa ${dateTime(o.ordered_at)}`} />
      </div>

      {o.is_critical && (
        <div className="mt-4">
          <Notice>Kipimo hiki kina thamani ya hatari. Kinahitaji hatua sasa.</Notice>
        </div>
      )}

      {o.values.length > 0 && (
        <table className="mt-6 w-full border border-line bg-white text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              <th className="p-3 font-medium">Kipimo</th>
              <th className="p-3 font-medium">Thamani</th>
              <th className="p-3 font-medium">Mipaka</th>
              <th className="p-3 font-medium">Hali</th>
            </tr>
          </thead>
          <tbody>
            {o.values.map((v, i) => {
              const f = flagStyle(v.flag);
              return (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3">{v.analyte}</td>
                  <td className="p-3 font-mono tabular-nums">{v.value}{v.unit ? ` ${v.unit}` : ''}</td>
                  <td className="p-3 font-mono tabular-nums text-ink-soft">
                    {v.reference_low ?? '—'} – {v.reference_high ?? '—'}
                  </td>
                  <td className={`p-3 ${f.text}`}>{f.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {o.narrative && <p className="mt-6 whitespace-pre-wrap text-[0.95rem]">{o.narrative}</p>}

      {o.status === 'resulted' && (
        <div className="mt-8">
          <AcknowledgeResult orderId={o.id} />
        </div>
      )}
      {o.status === 'acknowledged' && (
        <p className="mt-8 text-sm text-ink-soft">Umeshathibitisha kupokea matokeo haya.</p>
      )}
    </div>
  );
}
