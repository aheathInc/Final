import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ClinicianProfile, Page } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { VerificationActions } from '@/components/VerificationActions';

export default async function VerificationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const pending = await serverGet<Page<ClinicianProfile>>(
    '/clinicians?verification_status=pending&limit=50',
  );
  const items = pending?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Clinician verification"
        lede="Licences waiting for an operations decision. Approval activates routing eligibility; rejection requires a reason."
      />

      {items.length === 0 ? (
        <Empty>No clinician licences are waiting for a decision.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id}>
              <Card accent="border-l-4 border-amber">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{c.full_name ?? 'Name not provided'}</span>
                  <Badge tone="attention">{c.specialty.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">
                  Licence: {c.license_number}
                </p>
                <VerificationActions clinicianId={c.id} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
