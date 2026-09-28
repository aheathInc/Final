import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { IncidentReport, Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';

const SEVERITY_LABEL: Record<string, string> = {
  low: 'Ndogo', moderate: 'Wastani', serious: 'Kubwa', catastrophic: 'Mbaya sana',
};

export default async function IncidentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<IncidentReport>>('/incident-reports?limit=50');
  const items = page?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Ripoti za matukio"
        lede="Zilizopandishwa kwa uongozi zinawekwa juu. Lengo ni kuboresha, si kuadhibu — lakini hilo linafanya kazi tu kama ripoti inafika kwa mwenye uwezo wa kuchukua hatua."
      />

      {items.length === 0 ? (
        <Empty>Hakuna ripoti iliyowasilishwa.</Empty>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card accent={
                r.severity === 'catastrophic' || r.severity === 'serious'
                  ? 'border-l-4 border-clay'
                  : r.severity === 'moderate' ? 'border-l-4 border-amber' : 'border border-line'
              }>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{r.category.replace(/_/g, ' ')}</span>
                  <span className={`text-sm ${
                    r.severity === 'catastrophic' || r.severity === 'serious' ? 'text-clay' : 'text-ink-soft'
                  }`}>
                    {SEVERITY_LABEL[r.severity] ?? r.severity}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[0.95rem]">{r.description}</p>
                <p className="mt-2 text-sm text-ink-soft">
                  {dateTime(r.reported_at)} · {r.status}
                  {/*
                    Anonymity is real, not a display setting: the reporter's id
                    was never written to the row at all, including in the audit
                    trail. Saying so here keeps anyone from going looking.
                  */}
                  {r.anonymous ? ' · iliripotiwa bila jina (mtoa taarifa hajahifadhiwa popote)' : ''}
                  {r.escalated_to_governance ? ' · imepandishwa kwa uongozi' : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
