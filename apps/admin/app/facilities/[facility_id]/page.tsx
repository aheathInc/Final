import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Facility } from '@/lib/api';
import { Empty, Notice, PageHeader } from '@/components/ui';

interface Department { id: string; name: string; specialty: string | null }
interface QueueInfo { integration_level: string; providers: { name: string; waiting: number }[] }

export default async function FacilityPage({ params }: { params: { facility_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const id = params.facility_id;
  const [facility, departments, queue] = await Promise.all([
    serverGet<Facility>(`/facilities/${id}`),
    serverGet<{ data: Department[] }>(`/facilities/${id}/departments`),
    serverGet<QueueInfo>(`/facilities/${id}/queue`),
  ]);

  if (!facility) {
    return <div className="mx-auto max-w-3xl px-6 py-8"><Notice>Kituo hiki hakikupatikana.</Notice></div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/facilities" className="text-sm text-petrol underline underline-offset-4">
        Rudi kwenye vituo
      </Link>
      <div className="mt-4">
        <PageHeader title={facility.name}
          lede={`${facility.type} · ${facility.region_code ?? 'eneo halijulikani'}`} />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Idara</h2>
        {(departments?.data ?? []).length === 0 ? (
          <Empty>Hakuna idara zilizosajiliwa.</Empty>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {(departments?.data ?? []).map((d) => (
              <li key={d.id} className="border border-line bg-white p-3 text-[0.95rem]">
                {d.name}{d.specialty ? ` · ${d.specialty.replace(/_/g, ' ')}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Foleni ya kituo</h2>
        {/*
          The providers list is empty for every facility today: no live queue
          feed is connected at any integration level. Saying so is better than
          rendering an empty table that looks like "nobody is waiting".
        */}
        <p className="mt-3 text-[0.95rem] text-ink-soft">
          Kiwango cha ushirikiano: {queue?.integration_level ?? facility.integration_level}.
        </p>
        {(queue?.providers ?? []).length === 0 ? (
          <p className="mt-2 text-[0.95rem] text-ink-soft">
            Hakuna chanzo cha data hai ya foleni kilichounganishwa bado. Hii si sawa na
            &ldquo;hakuna mtu anayesubiri&rdquo; — ni kwamba kituo hakituma taarifa hiyo.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {(queue?.providers ?? []).map((p, i) => (
              <li key={i} className="border border-line bg-white p-3 text-[0.95rem]">
                {p.name} · wanaosubiri {p.waiting}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
