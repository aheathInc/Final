import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { SurveillanceView } from '@/components/SurveillanceView';

export default async function SurveillancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <PageHeader
        title="Ufuatiliaji wa magonjwa"
        lede="Hesabu za magonjwa kutoka kwa vipimo vya madaktari, zilizokusanywa kwa eneo. Hakuna taarifa ya mtu binafsi hapa."
      />
      <SurveillanceView />
    </div>
  );
}
