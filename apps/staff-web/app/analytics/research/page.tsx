import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ResearchDataset } from '@/lib/api';
import { Badge, Card, Empty, PageHeader, PageShell } from '@/components/ui';
import { QueryForm } from '@/components/QueryForm';

export default async function ResearchPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const list = await serverGet<{ data: ResearchDataset[] }>('/research/datasets');
  const datasets = list?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Research"
        lede="Aggregate datasets only. Small cells are suppressed before results are returned."
      />

      {datasets.length === 0 ? (
        <Empty>No research datasets are active.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {datasets.map((d) => (
            <li key={d.id}>
              <Card>
                <p className="font-medium">{d.name}</p>
                <p className="mt-1 text-[0.95rem] text-ink-soft">{d.description}</p>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
                  <div>
                    <dt className="inline">Method: </dt>
                    <dd className="inline">{d.deidentification_method}</dd>
                  </div>
                  <div>
                    {/*
                      Stated on the card, not in help text. It is the number
                      that decides whether an answer comes back at all, and a
                      researcher planning a query needs it before they write one.
                    */}
                    <dt className="inline">Cell minimum: </dt>
                    <dd className="inline font-mono tabular-nums">{d.minimum_cell_size}</dd>
                  </div>
                  {d.requires_ethics_approval && (
                    <Badge tone="attention">Ethics approval required</Badge>
                  )}
                </dl>
                <QueryForm dataset={d} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
