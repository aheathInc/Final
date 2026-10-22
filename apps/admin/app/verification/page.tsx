import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ClinicianProfile, Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { VerificationActions } from '@/components/VerificationActions';

export default async function VerificationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const pending = await serverGet<Page<ClinicianProfile>>(
    '/clinicians?verification_status=pending&limit=50',
  );
  const items = pending?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Uthibitisho wa madaktari"
        lede="Leseni zinazosubiri uamuzi. Kuidhinisha huwezesha akaunti; kukataa huizima na kudai sababu."
      />

      {items.length === 0 ? (
        <Empty>Hakuna leseni inayosubiri uamuzi.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id}>
              <Card accent="border-l-4 border-amber">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{c.full_name ?? 'Jina halijawekwa'}</span>
                  <span className="text-sm text-ink-soft">{c.specialty.replace(/_/g, ' ')}</span>
                </div>
                <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">
                  Leseni: {c.license_number}
                </p>
                <VerificationActions clinicianId={c.id} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
