import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Page, SecondOpinion } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { OpinionActions } from '@/components/OpinionActions';

export default async function SecondOpinionsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<SecondOpinion>>('/network/second-opinions?limit=50');
  const items = page?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Maoni ya pili"
        lede="Maswali yanayosubiri mtaalamu. Hakuna haja nyote wawili kuwa mtandaoni kwa wakati mmoja."
      />

      {items.length === 0 ? (
        <Empty>Hakuna maswali yanayosubiri.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((o) => (
            <li key={o.id}>
              <Card accent={o.status === 'open' ? 'border-l-4 border-amber' : 'border border-line'}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{o.specialty.replace(/_/g, ' ')}</span>
                  <span className="text-sm text-ink-soft">{dateTime(o.requested_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[0.95rem]">{o.question}</p>
                {o.answer && (
                  <div className="mt-3 border-l-4 border-petrol bg-paper-sunk py-3 pl-4">
                    <p className="whitespace-pre-wrap text-[0.95rem]">{o.answer}</p>
                    <p className="mt-1 text-xs text-ink-soft">Alijibu {dateTime(o.answered_at)}</p>
                  </div>
                )}
                <OpinionActions id={o.id} status={o.status} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
