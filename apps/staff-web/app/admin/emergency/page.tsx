import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader, PageShell } from '@/components/ui';
import { EmergencyBoard } from '@/components/EmergencyBoard';

export default async function EmergencyPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <PageShell>
      <PageHeader
        title="Emergency operations"
        lede="Mass-casualty and unhandled reports are prioritised. Resolved requests move out of the active work queue."
      />
      <EmergencyBoard />
    </PageShell>
  );
}
