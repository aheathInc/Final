import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Consultation, Message, Page } from '@/lib/api';
import { Badge, Card, Notice, PageHeader, PageShell } from '@/components/ui';
import { MessageThread } from '@/components/MessageThread';
import { OrderInvestigation } from '@/components/OrderInvestigation';
import { ReferForOpinion } from '@/components/ReferForOpinion';
import { urgencyStyle } from '@/lib/urgency';
import { dateTime } from '@/lib/format';

export default async function CasePage({ params }: { params: { consultation_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const c = await serverGet<Consultation>(`/consultations/${params.consultation_id}`);

  if (!c) {
    return (
      <PageShell>
        <Notice>This case was not found, or you are not assigned to it.</Notice>
        <Link href="/doctor/" className="mt-4 inline-block text-petrol underline underline-offset-4">
          Back to queue
        </Link>
      </PageShell>
    );
  }

  const s = urgencyStyle(c.urgency_level);
  const messages = await serverGet<Page<Message>>(`/care-threads/${c.care_thread_id}/messages?limit=100`);

  return (
    <PageShell>
      <Link href="/doctor/" className="text-sm text-petrol underline underline-offset-4">
        Back to queue
      </Link>

      <Card className="mt-4">
        <PageHeader
          title="Active case"
          lede={c.symptom_text ?? 'No symptom text provided.'}
          action={<Badge tone={c.urgency_level === 'emergency' ? 'problem' : c.urgency_level === 'urgent' ? 'attention' : 'neutral'}>{s.label}</Badge>}
        />
      </Card>

      <dl className="mt-4 grid gap-3 text-sm text-ink-soft sm:grid-cols-3">
        <div className="rounded-md border border-line bg-white p-3"><dt>Started</dt><dd className="font-medium text-ink">{dateTime(c.created_at)}</dd></div>
        <div className="rounded-md border border-line bg-white p-3"><dt>Channel</dt><dd className="font-medium capitalize text-ink">{c.channel}</dd></div>
        <div className="rounded-md border border-line bg-white p-3"><dt>Status</dt><dd className="font-medium capitalize text-ink">{c.status.replace(/_/g, ' ')}</dd></div>
      </dl>

      <MessageThread
        careThreadId={c.care_thread_id}
        meId={session.user?.id ?? ''}
        initialMessages={messages?.data ?? []}
      />

      <div className="mt-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <Link href={`/doctor/case/${c.id}/close`}
            className="min-h-11 bg-petrol px-5 py-2.5 font-medium text-white hover:bg-petrol-lift">
            Close case
          </Link>
          <Link href={`/doctor/patients/${c.patient_profile_id}`}
            className="text-sm text-petrol underline underline-offset-4">
            Patient record
          </Link>
        </div>
        <OrderInvestigation careThreadId={c.care_thread_id} consultationId={c.id} />
        <ReferForOpinion careThreadId={c.care_thread_id} />
      </div>
    </PageShell>
  );
}
