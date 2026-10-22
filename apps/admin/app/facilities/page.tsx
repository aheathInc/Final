import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Facility, Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';

export default async function FacilitiesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<Facility>>('/facilities?limit=100');
  const items = page?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Vituo"
        lede="Vituo vilivyothibitishwa pekee vinaonekana. Kiwango cha ushirikiano kinaonyesha ni kiasi gani cha data hai kinapatikana."
      />

      {items.length === 0 ? (
        <Empty>Hakuna kituo kilichosajiliwa.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((f) => (
            <li key={f.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/facilities/${f.id}`} className="font-medium text-petrol underline underline-offset-4">
                    {f.name}
                  </Link>
                  <span className="text-sm text-ink-soft">{f.type}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {f.region_code ?? 'Eneo halijulikani'}
                  {f.contact_phone ? ` · ${f.contact_phone}` : ''}
                  {' · '}ushirikiano: {f.integration_level}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
