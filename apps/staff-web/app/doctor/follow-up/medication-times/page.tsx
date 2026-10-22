import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { MedicationTimingWorkspace } from '@/components/MedicationTimingWorkspace';

export default async function MedicationTimesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  return <MedicationTimingWorkspace identityKey={session.user.id}/>;
}
