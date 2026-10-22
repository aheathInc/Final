import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ResearchQuery } from '@/lib/api';
import { Empty, Notice, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default async function QueryPage({ params }: { params: { query_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const q = await serverGet<ResearchQuery>(`/research/queries/${params.query_id}`);
  if (!q) {
    return <div className="mx-auto max-w-3xl px-6 py-8"><Notice>Swali hili halikupatikana.</Notice></div>;
  }

  const rows = q.rows ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/research" className="text-sm text-petrol underline underline-offset-4">
        Rudi kwenye utafiti
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Matokeo"
          lede={`Kusanya kwa ${q.query.group_by.join(', ')} · ${dateTime(q.submitted_at)}`}
        />
      </div>

      {/*
        Suppression is reported, not hidden. A researcher who does not know a
        cell was removed will read the total as complete — and the whole point
        of the threshold is that a count of one in a district is an identity.
      */}
      {q.suppressed_cells > 0 && (
        <div className="mt-6">
          <Notice tone="attention">
            Seli {q.suppressed_cells} zimeondolewa kwa sababu zilikuwa chini ya kikomo cha
            faragha. Jumla hapa chini haijumuishi hizo.
          </Notice>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>Hakuna safu iliyorudi. Huenda zote zilikuwa chini ya kikomo.</Empty>
      ) : (
        <table className="mt-6 w-full border border-line bg-white text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              {columns.map((c) => <th key={c} className="p-3 font-medium">{c.replace(/_/g, ' ')}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {columns.map((c) => (
                  <td key={c} className={`p-3 ${c === 'count' ? 'font-mono tabular-nums' : ''}`}>
                    {String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-xs text-ink-soft">
        Kumbukumbu ya kibali: {q.ethics_approval_ref || '—'} · hali: {q.status}
      </p>
    </div>
  );
}
