'use client';
import { PageHeader } from './ui';

import { useEffect, useState } from 'react';

type System = {
  id: string; system_key: string; name: string; identifier: string;
  facility: { id: string; name: string }; status: 'pending' | 'active' | 'suspended';
  supported_types: string[]; authentication_configuration_reference: string;
};
type PendingIdentity = {
  id: string; status: 'ambiguous' | 'unmatched';
  source_system: { name: string; system_key: string }; imported_resource_count: number;
  created_at: string; updated_at: string;
};
type Facility = { id: string; name: string };
const resourceTypes = ['Patient', 'Organization', 'Practitioner', 'Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'MedicationRequest', 'AllergyIntolerance', 'Provenance'];

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function InteropConsole({ facilities }: { facilities: Facility[] }) {
  const [systems, setSystems] = useState<System[]>([]);
  const [pending, setPending] = useState<PendingIdentity[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [systemKey, setSystemKey] = useState('');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '');
  const [types, setTypes] = useState<string[]>(['Patient', 'Encounter', 'Observation', 'DiagnosticReport']);
  const [review, setReview] = useState<Record<string, { patientId: string; secondId: string; evidence: string }>>({});

  async function refresh() {
    const [systemsResponse, identityResponse] = await Promise.all([
      fetch('/bff/interop/systems', { cache: 'no-store' }),
      fetch('/bff/interop/identities/pending', { cache: 'no-store' }),
    ]);
    if (!systemsResponse.ok || !identityResponse.ok) throw new Error('Imeshindikana kupakia mipangilio ya ushirikiano.');
    const systemsJson = await systemsResponse.json();
    const identitiesJson = await identityResponse.json();
    setSystems(systemsJson.data ?? []);
    setPending(identitiesJson.data ?? []);
  }

  useEffect(() => { refresh().catch((error) => setMessage(error.message)); }, []);

  async function request(path: string, body?: unknown) {
    const response = await fetch(`/bff${path}`, {
      method: body === undefined ? 'POST' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message ?? 'Ombi halikufanikiwa.');
    }
    return response.json().catch(() => null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try { await action(); await refresh(); setMessage('Mabadiliko yamehifadhiwa.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ombi halikufanikiwa.'); }
    finally { setBusy(false); }
  }

  function updateReview(id: string, field: 'patientId' | 'secondId' | 'evidence', value: string) {
    setReview((current) => {
      const previous = current[id] ?? { patientId: '', secondId: '', evidence: '' };
      return { ...current, [id]: { ...previous, [field]: value } };
    });
  }

  return (
    <div className="staff-page ahp-page space-y-8">
      <PageHeader title="Health-system interoperability" lede="Register approved sources, review identity mappings and keep provenance visible. FHIR R4 subset — not a full FHIR server."/>
      {message && <p role="status" className="rounded border border-line bg-white p-3 text-sm">{message}</p>}

      <section className="rounded border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Register external system</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await request('/interop/systems', { system_key: systemKey, name, identifier, facility_id: facilityId, supported_types: types });
            setSystemKey(''); setName(''); setIdentifier('');
          });
        }}>
          <label className="grid gap-1 text-sm">System key<input required pattern="[a-z][a-z0-9-]{2,59}" value={systemKey} onChange={(e) => setSystemKey(e.target.value)} className="rounded border border-line p-2" placeholder="hospital-a-ehr" /></label>
          <label className="grid gap-1 text-sm">System name<input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-line p-2" /></label>
          <label className="grid gap-1 text-sm">Source identifier<input required maxLength={255} value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="rounded border border-line p-2" placeholder="urn:oid:..." /></label>
          <label className="grid gap-1 text-sm">AHP facility<select required value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="rounded border border-line p-2">{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-medium">Enabled resource profiles</legend>
            <div className="mt-2 flex flex-wrap gap-3">{resourceTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={types.includes(type)} onChange={(e) => setTypes((current) => e.target.checked ? [...current, type] : current.filter((value) => value !== type))} />{type}</label>)}</div>
          </fieldset>
          <button disabled={busy || !facilityId || types.length === 0} className="rounded bg-petrol px-4 py-2 text-white disabled:opacity-50 md:col-span-2">Register pending system</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Registered systems</h2>
        <ul className="mt-3 space-y-3">{systems.map((system) => <li key={system.id} className="rounded border border-line bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{system.name}</h3><p className="text-sm text-ink-soft">{system.system_key} · {system.facility.name} · {system.status}</p><p className="mt-1 text-xs text-ink-soft">Secret reference: {system.authentication_configuration_reference}</p><p className="mt-1 text-xs text-ink-soft">Profiles: {system.supported_types.join(', ')}</p></div>
            <div className="flex gap-2">{system.status !== 'active' && <button disabled={busy} onClick={() => void run(async () => { await request(`/interop/systems/${system.id}/activate`); })} className="rounded border border-line px-3 py-1 text-sm">Activate</button>}{system.status === 'active' && <button disabled={busy} onClick={() => void run(async () => { await request(`/interop/systems/${system.id}/suspend`); })} className="rounded border border-line px-3 py-1 text-sm">Suspend</button>}</div>
          </div>
        </li>)}</ul>
        {systems.length === 0 && <p className="mt-2 text-sm text-ink-soft">Hakuna mfumo uliosajiliwa.</p>}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Identity reconciliation queue</h2>
        <p className="mt-1 text-sm text-ink-soft">External patient identifiers and demographics are hidden here. Verify identity using the approved governance process before linking an AHP profile.</p>
        <ul className="mt-3 space-y-3">{pending.map((identity) => {
          const values = review[identity.id] ?? { patientId: '', secondId: '', evidence: '' };
          return <li key={identity.id} className="rounded border border-line bg-white p-4">
            <p className="font-medium">{identity.source_system.name} · {identity.status}</p><p className="text-sm text-ink-soft">{identity.imported_resource_count} quarantined/imported resource(s)</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <input aria-label="AHP patient profile ID" value={values.patientId} onChange={(e) => updateReview(identity.id, 'patientId', e.target.value)} className="rounded border border-line p-2 text-sm" placeholder="AHP patient profile UUID" />
              <input aria-label="Second candidate profile ID" value={values.secondId} onChange={(e) => updateReview(identity.id, 'secondId', e.target.value)} className="rounded border border-line p-2 text-sm" placeholder="Second candidate (ambiguous only)" />
              <input aria-label="Verification evidence reference" value={values.evidence} onChange={(e) => updateReview(identity.id, 'evidence', e.target.value)} className="rounded border border-line p-2 text-sm" placeholder="Governance evidence reference" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy || !values.patientId || !values.evidence} onClick={() => void run(async () => { await request(`/interop/identities/${identity.id}/confirm`, { patient_profile_id: values.patientId, evidence_reference: values.evidence }); })} className="rounded border border-line px-3 py-1 text-sm">Confirm verified mapping</button>
              <button disabled={busy || !values.patientId || !values.secondId || !values.evidence} onClick={() => void run(async () => { await request(`/interop/identities/${identity.id}/mark-ambiguous`, { candidate_patient_profile_ids: [values.patientId, values.secondId], evidence_reference: values.evidence }); })} className="rounded border border-line px-3 py-1 text-sm">Mark ambiguous</button>
              <button disabled={busy || !values.evidence} onClick={() => void run(async () => { await request(`/interop/identities/${identity.id}/reject`, { evidence_reference: values.evidence }); })} className="rounded border border-line px-3 py-1 text-sm">Reject match</button>
            </div>
          </li>;
        })}</ul>
        {pending.length === 0 && <p className="mt-2 text-sm text-ink-soft">Hakuna identity inayosubiri mapitio.</p>}
      </section>
    </div>
  );
}
