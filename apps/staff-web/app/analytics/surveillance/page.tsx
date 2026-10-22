import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader, PageShell } from '@/components/ui';
import { SurveillanceView } from '@/components/SurveillanceView';

export default async function SurveillancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

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
