import { PageHeader, PageShell } from '@/components/ui';
import { requireRole } from '@/lib/roles';
import { SurveillanceView } from '@/components/SurveillanceView';

export default async function SurveillancePage() {
  await requireRole(['platform_admin']);

  return (
    <PageShell>
      <PageHeader
        title="Disease surveillance"
        lede="Aggregated condition counts by geography and period. Patient-identifying details are not rendered in this workspace."
      />
      <SurveillanceView />
    </PageShell>
  );
}
