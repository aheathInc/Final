import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { CloseCaseForm } from '@/components/CloseCaseForm';

export default async function CloseCasePage({ params }: { params: { consultation_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href={`/case/${params.consultation_id}`} className="text-sm text-petrol underline underline-offset-4">
        Rudi kwenye kesi
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Funga kesi"
          lede="Maelezo, dawa na ufuatiliaji huhifadhiwa kwa pamoja. Kikishindikana kimoja, hakuna kinachohifadhiwa."
        />
      </div>
      <CloseCaseForm consultationId={params.consultation_id} />
    </div>
  );
}
