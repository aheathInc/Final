import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { QueueView } from '@/components/QueueView';
import { AvailabilityToggle } from '@/components/AvailabilityToggle';

export default async function QueuePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10 lg:py-10">
      <PageHeader
        title={session.user?.name ? `Dkt. ${session.user.name}` : 'Foleni'}
        lede="Kesi zinapangwa kwa uharaka kisha kwa muda uliobaki."
        action={<AvailabilityToggle />}
      />
      <div className="mt-7"><QueueView /></div>
    </div>
  );
}
