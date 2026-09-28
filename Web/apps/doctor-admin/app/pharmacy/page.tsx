import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { MedicationSearch } from '@/components/MedicationSearch';

export default async function PharmacyPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Upatikanaji wa dawa"
        lede="Angalia dawa ipo wapi kabla ya kuiandika. Maandiko yasiyo na dawa inayopatikana si matibabu."
      />
      <MedicationSearch />
    </div>
  );
}
