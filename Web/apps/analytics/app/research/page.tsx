import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ResearchDataset } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { QueryForm } from '@/components/QueryForm';

export default async function ResearchPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const list = await serverGet<{ data: ResearchDataset[] }>('/research/datasets');
  const datasets = list?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Utafiti"
        lede="Data iliyokusanywa pekee. Hakuna safu inayoweza kurudi kwa mtu binafsi, na matokeo madogo kuliko kikomo yanaondolewa kabla hujayaona."
      />

      {datasets.length === 0 ? (
        <Empty>Hakuna seti ya data iliyofunguliwa.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {datasets.map((d) => (
            <li key={d.id}>
              <Card>
                <p className="font-medium">{d.name}</p>
                <p className="mt-1 text-[0.95rem] text-ink-soft">{d.description}</p>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
                  <div>
                    <dt className="inline">Njia: </dt>
                    <dd className="inline">{d.deidentification_method}</dd>
                  </div>
                  <div>
                    {/*
                      Stated on the card, not in help text. It is the number
                      that decides whether an answer comes back at all, and a
                      researcher planning a query needs it before they write one.
                    */}
                    <dt className="inline">Kikomo cha seli: </dt>
                    <dd className="inline font-mono tabular-nums">{d.minimum_cell_size}</dd>
                  </div>
                  {d.requires_ethics_approval && (
                    <div className="text-amber">Inahitaji kibali cha maadili</div>
                  )}
                </dl>
                <QueryForm dataset={d} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
