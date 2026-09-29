import Link from 'next/link';
import { Activity, Database } from 'lucide-react';
import { Badge, Card, PageHeader, PageShell } from '@/components/ui';
import { serverGet } from '@/lib/serverToken';
import type { ConditionCount, ResearchDataset, Page } from '@/lib/api';

export default async function AnalyticsDashboard() {
  const [signals, datasets] = await Promise.all([
    serverGet<Page<ConditionCount>>('/surveillance/conditions?limit=12'),
    serverGet<{ data: ResearchDataset[] }>('/research/datasets'),
  ]);

  return (
    <PageShell>
      <Card className="bg-gradient-to-br from-white to-blue/10">
        <PageHeader
          title="Analytics dashboard"
          lede="Population surveillance and approved aggregate research workflows. No patient-identifying details are rendered here."
          action={<Badge tone="info">Blue analytics accent</Badge>}
        />
      </Card>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Link href="/analytics/surveillance" className="rounded-lg border border-line bg-white p-5 shadow-sm transition-colors hover:border-blue">
          <Activity className="text-blue" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">Surveillance</h2>
          <p className="mt-2 text-3xl font-semibold">{signals?.data?.length ?? 0}</p>
          <p className="text-sm text-ink-soft">Recent disease signals available through the surveillance service.</p>
        </Link>
        <Link href="/analytics/research" className="rounded-lg border border-line bg-white p-5 shadow-sm transition-colors hover:border-teal">
          <Database className="text-petrol" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">Research</h2>
          <p className="mt-2 text-3xl font-semibold">{datasets?.data?.length ?? 0}</p>
          <p className="text-sm text-ink-soft">Available de-identified datasets for approved research workflows.</p>
        </Link>
      </section>

      <Card className="mt-6">
        <h2 className="font-semibold">Access boundary</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Clinician sessions are blocked before these routes render. Platform administrators can move between operations and analytics in one app.
        </p>
      </Card>
    </PageShell>
  );
}
