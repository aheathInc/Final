import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { Page } from '@/lib/api';
import { Card, Empty, PageHeader } from '@/components/ui';
import { dateOnly, dateTime } from '@/lib/format';
import { ComputeRisk } from '@/components/ComputeRisk';

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
  const [risk, vaccinations, prescriptions] = await Promise.all([
    serverGet<{ data: RiskScore[] }>(`/patient-profiles/${id}/risk-scores`),
    serverGet<{ data: Vaccination[] }>(`/patient-profiles/${id}/vaccinations`),
    serverGet<Page<Prescription>>(`/patient-profiles/${id}/prescriptions?limit=20`),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Rekodi ya mgonjwa" lede="Inaonekana kwa sababu umekubali kesi ya mgonjwa huyu." />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Hatari za magonjwa</h2>
        {(risk?.data ?? []).length === 0 ? (
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
        {(vaccinations?.data ?? []).length === 0 ? (
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
        {(prescriptions?.data ?? []).length === 0 ? (
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
    </div>
  );
}
