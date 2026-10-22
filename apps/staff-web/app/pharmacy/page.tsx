import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader, PageShell } from '@/components/ui';
import { PharmacistWorkspace } from '@/components/PharmacistWorkspace';

export default async function PharmacyWorkspacePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user?.role !== 'pharmacist') redirect('/login');

  return (
    <PageShell>
      <PageHeader
        title="Prescription handoff"
        lede="Verify the patient reference, confirm available stock, and record only the quantity physically dispensed."
      />
      <PharmacistWorkspace />
    </PageShell>
  );
}
