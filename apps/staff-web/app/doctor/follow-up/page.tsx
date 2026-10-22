import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { CareContinuityWorkspace } from '@/components/CareContinuityWorkspace';

export default async function FollowUpPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  // The existing DoctorLayout enforces clinician role. Backend rechecks role,
  // current verification and assigned-cycle ownership for every operation.
  return <CareContinuityWorkspace key={session.user.id} identityKey={session.user.id} />;
}
