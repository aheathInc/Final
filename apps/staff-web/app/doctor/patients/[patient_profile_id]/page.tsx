import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Page } from '@/lib/api';
import { Card, Empty, Notice, PageHeader, PageShell } from '@/components/ui';
import { dateOnly, dateTime } from '@/lib/format';
import { ComputeRisk } from '@/components/ComputeRisk';
import { HealthTimeline } from '@/components/premium/HealthTimeline';

interface RiskScore {
  id: string; condition_code: string; score: number; band: string;
  model_version: string; computed_at: string;
  contributing_factors?: Record<string, unknown>;
}
interface Vaccination { id: string; vaccine_code: string; dose_number: number; status: string; administered_at: string | null }
interface Prescription {
  id: string; status: string; created_at: string;
  items: { id: string; medication_name: string; dosage: string; frequency_per_day: number; duration_days: number }[];
}
interface TimelineEntry {
  id: string; category: string; occurred_at: string; status: string;
  verification_state: string; summary: string;
  source: { type: 'ahp' | 'external'; name: string; facility_name: string | null; record_id: string };
  detail: Record<string, unknown>;
  provenance?: { source_version: string | null; imported_at: string; transformation_version: string; payload_hash: string };
}

const BAND_STYLE: Record<string, string> = {
  very_high: 'text-clay font-semibold',
  high: 'text-clay',
  moderate: 'text-amber',
  low: 'text-ink-soft',
};

export default async function PatientPage({ params }: { params: { patient_profile_id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const id = params.patient_profile_id;
  const [risk, vaccinations, prescriptions, history] = await Promise.all([
    serverGet<{ data: RiskScore[] }>(`/patient-profiles/${id}/risk-scores`),
    serverGet<{ data: Vaccination[] }>(`/patient-profiles/${id}/vaccinations`),
    serverGet<Page<Prescription>>(`/patient-profiles/${id}/prescriptions?limit=20`),
    serverGet<{ data: TimelineEntry[] }>(`/interop/patients/${id}/timeline`),
  ]);

  return (
    <PageShell>
      <PageHeader title="Patient health history" lede="One authorized care story, with each source clearly identified. Clinical access stays within the permitted care scope." />
      <div className="ahp-history-grid"><HealthTimeline entries={history?.data ?? []} unavailable={!history}/>
      <aside className="ahp-card ahp-patient-summary">
        <h2>Clinical context</h2><p className="ahp-caption">Patient reference: <code className="break-all">{id}</code></p>
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Hatari za magonjwa</h2>
        {!risk ? <Notice>Risk information is unavailable for this view.</Notice> : (risk.data).length === 0 ? (
          <Empty>Hakuna alama za hatari zilizohesabiwa.</Empty>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {(risk?.data ?? []).map((r) => (
              <li key={r.id} className="border border-line bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{r.condition_code.replace(/_/g, ' ')}</span>
                  <span className={BAND_STYLE[r.band] ?? 'text-ink-soft'}>{r.band.replace('_', ' ')}</span>
                </div>
                {/*
                  The factors are shown, not just the number. A score nobody can
                  interrogate cannot be acted on responsibly, and this one is a
                  documented rule, not a model whose reasoning is hidden.
                */}
                <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">
                  {r.score} · {r.model_version} · {dateTime(r.computed_at)}
                </p>
                {r.contributing_factors && (
                  <p className="mt-1 text-xs text-ink-soft">
                    {Object.entries(r.contributing_factors)
                      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <ComputeRisk patientProfileId={id} />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Chanjo</h2>
        {!vaccinations ? <Notice>Vaccination information is unavailable for this view.</Notice> : vaccinations.data.length === 0 ? (
          <Empty>Hakuna rekodi ya chanjo.</Empty>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {(vaccinations?.data ?? []).map((v) => (
              <li key={v.id} className="border border-line bg-white p-3 text-[0.95rem]">
                {v.vaccine_code} · dozi {v.dose_number} · {v.status}
                {v.administered_at ? ` · ${dateOnly(v.administered_at)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Dawa alizoandikiwa</h2>
        {!prescriptions ? <Notice>Prescription information is unavailable for this view.</Notice> : prescriptions.data.length === 0 ? (
          <Empty>Hakuna dawa zilizoandikwa.</Empty>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {(prescriptions?.data ?? []).map((p) => (
              <li key={p.id}>
                <Card>
                  <p className="text-sm text-ink-soft">{dateTime(p.created_at)} · {p.status}</p>
                  <ul className="mt-2 flex flex-col gap-1 text-[0.95rem]">
                    {p.items.map((i) => (
                      <li key={i.id}>
                        {i.medication_name} {i.dosage} — mara {i.frequency_per_day} kwa siku, siku {i.duration_days}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      </aside></div>
    </PageShell>
  );
}
