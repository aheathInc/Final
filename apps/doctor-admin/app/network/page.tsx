import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Discussion, Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { NewDiscussion } from '@/components/NewDiscussion';

interface Community { id: string; name: string; specialty: string; member_count: number }

export default async function NetworkPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const communities = await serverGet<{ data: Community[] }>('/network/communities');
  const discussions = await serverGet<Page<Discussion>>('/network/discussions?limit=30');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Jamii ya wataalamu"
        lede="Majadiliano ya kesi hayaunganishwi kamwe na utambulisho wa mgonjwa. Unachoshiriki ni swali la kitabibu."
      />

      <NewDiscussion communities={communities?.data ?? []} />

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-soft">Majadiliano</h2>
      {(discussions?.data ?? []).length === 0 ? (
        <Empty>Hakuna majadiliano bado.</Empty>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {(discussions?.data ?? []).map((d) => (
            <li key={d.id}>
              <Card>
                <Link href={`/network/${d.id}`} className="font-medium text-petrol underline underline-offset-4">
                  {d.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-[0.95rem] text-ink-soft">{d.body}</p>
                <p className="mt-2 text-sm text-ink-soft">
                  {d.reply_count} majibu · {dateTime(d.created_at)}
                  {d.is_case_discussion ? ' · majadiliano ya kesi' : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
