import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Discussion } from '@/lib/api';
import { Notice, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { ReplyForm } from '@/components/ReplyForm';

interface Reply { id: string; body: string; author_clinician_id: string; created_at: string }
type WithReplies = Discussion & { replies: Reply[] };

export default async function DiscussionPage({ params }: { params: { discussion_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const d = await serverGet<WithReplies>(`/network/discussions/${params.discussion_id}`);
  if (!d) {
    return <div className="mx-auto max-w-3xl px-6 py-8"><Notice>Majadiliano haya hayakupatikana.</Notice></div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/network" className="text-sm text-petrol underline underline-offset-4">Rudi kwenye jamii</Link>
      <div className="mt-4"><PageHeader title={d.title} lede={dateTime(d.created_at)} /></div>

      <p className="mt-6 whitespace-pre-wrap text-[0.95rem]">{d.body}</p>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Majibu ({d.replies?.length ?? 0})
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {(d.replies ?? []).map((r) => (
          <li key={r.id} className="border border-line bg-white p-4">
            <p className="whitespace-pre-wrap text-[0.95rem]">{r.body}</p>
            <p className="mt-2 text-sm text-ink-soft">{dateTime(r.created_at)}</p>
          </li>
        ))}
      </ul>

      <ReplyForm discussionId={d.id} />
    </div>
  );
}
