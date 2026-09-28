import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { EmergencyBoard } from '@/components/EmergencyBoard';

export default async function EmergencyPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title="Dharura"
        lede="Matukio makubwa yanawekwa juu, kisha yasiyoshughulikiwa. Yaliyokamilika yanashuka chini."
      />
      <EmergencyBoard />
    </div>
  );
}
