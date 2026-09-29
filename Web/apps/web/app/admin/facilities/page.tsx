import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Facility, Page } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';

export default async function FacilitiesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<Facility>>('/facilities?limit=100');
  const items = page?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Facilities"
        lede="Registered facilities and their integration depth. Detail pages show the authoritative service queue where available."
      />

      {items.length === 0 ? (
        <Empty>No facilities are registered.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((f) => (
            <li key={f.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/admin/facilities/${f.id}`} className="font-medium text-petrol underline underline-offset-4">
                    {f.name}
                  </Link>
                  <Badge tone="info">{f.type.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {f.region_code ?? 'Region unknown'}
                  {f.contact_phone ? ` · ${f.contact_phone}` : ''}
                  {' · '}integration: {f.integration_level.replace(/_/g, ' ')}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
