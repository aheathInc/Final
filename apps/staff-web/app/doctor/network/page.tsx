import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Discussion, Page } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { NewDiscussion } from '@/components/NewDiscussion';

interface Community { id: string; name: string; specialty: string; member_count: number }

export default async function NetworkPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const communities = await serverGet<{ data: Community[] }>('/network/communities');
  const discussions = await serverGet<Page<Discussion>>('/network/discussions?limit=30');

  return (
    <PageShell>
      <PageHeader
        title="Professional network"
        lede="Case discussions are shared as clinical questions, not patient identity."
      />

      <NewDiscussion communities={communities?.data ?? []} />

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-soft">Discussions</h2>
      {(discussions?.data ?? []).length === 0 ? (
        <Empty>No discussions have been opened yet.</Empty>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {(discussions?.data ?? []).map((d) => (
            <li key={d.id}>
              <Card>
                <Link href={`/doctor/network/${d.id}`} className="font-medium text-petrol underline underline-offset-4">
                  {d.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-[0.95rem] text-ink-soft">{d.body}</p>
                <p className="mt-2 text-sm text-ink-soft">
                  {d.reply_count} replies · {dateTime(d.created_at)}
                  {d.is_case_discussion ? <span> · <Badge tone="info">case discussion</Badge></span> : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
