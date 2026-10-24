import Link from 'next/link';
import { Activity, Database } from 'lucide-react';
import { Card, PageHeader, PageShell } from '@/components/ui';
import { MetricBars } from '@/components/premium/MetricBars';
import { serverGet } from '@/lib/serverToken';
import { requireRole } from '@/lib/roles';
import type { ConditionCount, Page } from '@/lib/api';

export default async function AnalyticsDashboard() {
  await requireRole(['platform_admin']);
  const [signals, datasets] = await Promise.all([
    serverGet<Page<ConditionCount>>('/surveillance/conditions?limit=12'),
    serverGet<{ data: { collections: { id: string; name: string; status: string }[] } }>('/research/portal/bootstrap'),
  ]);

  return (
    <PageShell>
      <PageHeader title="Service insights" lede="Understand recorded activity and explore approved aggregate research. Clear sources, protected identities." />

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Link href="/analytics/surveillance" className="ahp-stat">
          <Activity className="text-blue" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">Surveillance</h2>
          <p className="ahp-stat-value">{signals ? signals.data.length : 'Unavailable'}</p>
          <p className="text-sm text-ink-soft">Recent disease signals available through the surveillance service.</p>
        </Link>
        <Link href="/analytics/research" className="ahp-stat">
          <Database className="text-petrol" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">Research</h2>
          <p className="ahp-stat-value">{datasets ? datasets.data.collections.filter(d=>d.status==='published').length : 'Unavailable'}</p>
          <p className="text-sm text-ink-soft">Available de-identified datasets for approved research workflows.</p>
        </Link>
      </section>

      <section className="ahp-bento mt-6"><Card><div className="ahp-section-heading"><h2>Reported condition counts</h2></div>{signals?<MetricBars rows={signals.data.map(s=>({label:s.condition_name,value:s.count}))} caption="Observed counts in the returned surveillance response. Not a clinical diagnosis or a forecast."/>:<p className="ahp-caption">Surveillance service unavailable.</p>}</Card><Card><div className="ahp-section-heading"><h2>Approved research datasets</h2></div>{datasets?<ul>{datasets.data.collections.filter(d=>d.status==='published').map(d=><li key={d.id} className="py-2 border-b border-slate-200">{d.name} — published</li>)}</ul>:<p className="ahp-caption">Research service unavailable.</p>}</Card></section>
      <Card className="mt-6">
        <h2 className="font-semibold">Access boundary</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Clinician sessions are blocked before these routes render. Platform administrators can move between operations and analytics in one app.
        </p>
      </Card>
    </PageShell>
  );
}
