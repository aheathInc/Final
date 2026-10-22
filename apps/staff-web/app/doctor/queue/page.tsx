import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { ClinicianProfile } from '@/lib/api';
import { PageShell, PageHeader } from '@/components/ui';
import { QueueView } from '@/components/QueueView';
import { AvailabilityToggle } from '@/components/AvailabilityToggle';

export default async function QueuePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const profile = await serverGet<ClinicianProfile>('/clinicians/me');

  return (
    <PageShell>
      <PageHeader title={session.user?.name ? `Good morning, Dr. ${session.user.name}` : 'Your clinical workspace'}
        lede="Your care overview, clearly connected. Review authorized offers and continue your active consultations."
        action={<AvailabilityToggle initial={profile?.is_available} initiallyVerified={profile ? profile.verification_status === 'verified' : undefined} />} />

      <QueueView />
    </PageShell>
  );
}
