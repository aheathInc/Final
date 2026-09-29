import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { SlotPublisher } from '@/components/SlotPublisher';

export default async function SlotsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Ratiba yangu"
        lede="Nafasi unazozitoa kwa miadi. Nafasi ambazo tayari zimewekewa miadi hazitafutwa unapotuma ratiba mpya."
      />
      <SlotPublisher />
    </div>
  );
}
