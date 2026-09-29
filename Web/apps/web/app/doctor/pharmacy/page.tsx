import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader, PageShell } from '@/components/ui';
import { MedicationSearch } from '@/components/MedicationSearch';

export default async function PharmacyPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <PageShell>
      <PageHeader
        title="Pharmacy availability"
        lede="Check stock before relying on a medication plan. This screen reads the existing pharmacy service."
      />
      <MedicationSearch />
    </PageShell>
  );
}
