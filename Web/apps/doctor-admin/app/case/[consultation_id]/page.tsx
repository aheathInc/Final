import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Consultation } from '@/lib/api';
import { Notice, PageHeader } from '@/components/ui';
import { MessageThread } from '@/components/MessageThread';
import { ReferForOpinion } from '@/components/ReferForOpinion';
import { urgencyStyle } from '@/lib/urgency';
import { dateTime } from '@/lib/format';

export default async function CasePage({ params }: { params: { consultation_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const c = await serverGet<Consultation>(`/consultations/${params.consultation_id}`);

  if (!c) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Notice>Kesi hii haikupatikana, au si yako.</Notice>
        <Link href="/queue" className="mt-4 inline-block text-petrol underline underline-offset-4">
          Rudi kwenye foleni
        </Link>
      </div>
    );
  }

  const s = urgencyStyle(c.urgency_level);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/queue" className="text-sm text-petrol underline underline-offset-4">
        Rudi kwenye foleni
      </Link>

      <div className="mt-4">
        <PageHeader
          title="Kesi inayoendelea"
          lede={c.symptom_text ?? 'Hakuna maelezo ya maandishi.'}
          action={<span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>}
        />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
        <div><dt className="inline">Ilianza: </dt><dd className="inline">{dateTime(c.created_at)}</dd></div>
        <div><dt className="inline">Njia: </dt><dd className="inline">{c.channel}</dd></div>
        <div><dt className="inline">Hali: </dt><dd className="inline">{c.status}</dd></div>
      </dl>

      <MessageThread careThreadId={c.care_thread_id} meId={session.user?.id ?? ''} />

      <div className="mt-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <Link href={`/case/${c.id}/close`}
            className="min-h-11 bg-petrol px-5 py-2.5 font-medium text-white hover:bg-petrol-lift">
            Funga kesi
          </Link>
          <Link href={`/patients/${c.patient_profile_id}`}
            className="text-sm text-petrol underline underline-offset-4">
            Rekodi ya mgonjwa
          </Link>
        </div>
        <ReferForOpinion careThreadId={c.care_thread_id} />
      </div>
    </div>
  );
}
