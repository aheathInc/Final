'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { deskStatusLabels, type DeskVisit, type DeskFacility, type DeskDepartment } from '@/lib/frontDesk';
import { Badge, Button, Card, Empty, Field, Notice, PageHeader, PageShell, inputClass } from './ui';

export function FrontDeskWorkspace({ mode }: { mode: 'administration' | 'clinical' }) {
  const { data, status } = useSession();
  if (status !== 'authenticated' || !data?.user?.id) return <p role="status">Verifying staff session…</p>;
  return <FrontDeskContent key={`${data.user.id}:${data.user.role}`} mode={mode} />;
}

/** No clinical/financial action runs on mount. Every write requires an explicit operator action. */
function FrontDeskContent({ mode }: { mode: 'administration' | 'clinical' }) {
  const { data: session } = useSession();
  const identity = `${session?.user?.id ?? ''}:${session?.user?.role ?? ''}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const revision = useRef(0);
  const [facilities, setFacilities] = useState<DeskFacility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [departments, setDepartments] = useState<DeskDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [visits, setVisits] = useState<DeskVisit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = facilities.find((f) => f.id === facilityId);

  useEffect(() => {
    identityRef.current = identity;
    const generation = ++revision.current;
    const actor = identity;
    setFacilities([]); setFacilityId(''); setDepartmentId(''); setDepartments([]); setVisits([]); setMore(false); setError(null); setMessage(null); setBusy(false);
    setLoading(true);
    if (!session?.user) { setLoading(false); return; }
    void api.get<{ data: DeskFacility[] }>('/front-desk/facilities?limit=100').then((response) => {
      if (generation === revision.current && actor === identityRef.current) setFacilities(response.data.data);
    }).catch((cause) => {
      if (generation === revision.current && actor === identityRef.current) setError(errorMessage(cause, 'Facility directory could not be loaded.'));
    }).finally(() => { if (generation === revision.current && actor === identityRef.current) setLoading(false); });
    return () => { revision.current += 1; identityRef.current = ""; };
  }, [identity, session?.user]);

  const load = useCallback(async () => {
    if (!facilityId) return;
    const generation = ++revision.current;
    const actor = identityRef.current;
    setLoading(true); setError(null); setVisits([]); setMore(false);
    try {
      const [departmentResponse, response] = await Promise.all([
        api.get<{ data: DeskDepartment[] }>(`/front-desk/facilities/${facilityId}/departments`),
        api.get<{ data: DeskVisit[]; meta: { has_more: boolean } }>('/front-desk/staff/visits', { params: {
          facility_id: facilityId, ...(departmentId ? { department_id: departmentId } : {}), limit: 100,
        } }),
      ]);
      if (generation !== revision.current || actor !== identityRef.current) return;
      setDepartments(departmentResponse.data.data); setVisits(response.data.data); setMore(response.data.meta.has_more);
    } catch (cause) {
      if (generation === revision.current && actor === identityRef.current) setError(errorMessage(cause, 'Queue could not be loaded. No clearance was changed.'));
    } finally { if (generation === revision.current && actor === identityRef.current) setLoading(false); }
  }, [facilityId, departmentId]);
  useEffect(() => { void load(); }, [load]);

  async function act(visit: DeskVisit, action: string, body: Record<string, unknown> = {}) {
    if (busy) return;
    const actor = identityRef.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await api.post<DeskVisit>(`/front-desk/visits/${visit.id}/${action}`, { base_version: visit.version, ...body });
      if (actor !== identityRef.current) return;
      setMessage(`${response.data.ticket}: ${deskStatusLabels[response.data.status]}.`);
      await load();
    } catch (cause) {
      if (actor === identityRef.current) setError(errorMessage(cause, 'Action was not confirmed. Reload the queue before retrying.'));
    } finally { if (actor === identityRef.current) setBusy(false); }
  }
  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || busy) return;
    const actor = identityRef.current;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const input = { base_version: selected.version, enabled: form.get('enabled') === 'on',
        payment_required: form.get('payment') === 'on', insurance_required: form.get('insurance') === 'on' };
      const response = await api.patch<{ version: number }>(`/front-desk/facilities/${selected.id}/policy`, input);
      if (actor !== identityRef.current) return;
      setFacilities((all) => all.map((f) => f.id === selected.id ? { ...f, ...input, version: response.data.version } : f));
      setMessage('Facility policy saved. Existing visits retain their recorded requirements. Clinical review is always required.');
    } catch (cause) { if (actor === identityRef.current) setError(errorMessage(cause, 'Policy could not be saved.')); }
    finally { if (actor === identityRef.current) setBusy(false); }
  }
  async function aliases(event: FormEvent<HTMLFormElement>, d: DeskDepartment) {
    event.preventDefault(); if (busy) return;
    const actor = identityRef.current;
    const input = String(new FormData(event.currentTarget).get('aliases') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    setBusy(true); setError(null);
    try {
      await api.patch(`/front-desk/facilities/${facilityId}/departments/${d.id}/navigation`, { base_version: d.version, aliases: input });
      if (actor === identityRef.current) await load();
    } catch (cause) { if (actor === identityRef.current) setError(errorMessage(cause, 'Navigation labels could not be saved.')); }
    finally { if (actor === identityRef.current) setBusy(false); }
  }
  return <PageShell className="space-y-6">
    <PageHeader title={mode === 'administration' ? 'Digital front desk' : 'Hospital intake queue'}
      lede="AHP-registered visits only. Administrative preparation is separate from clinical assessment and treatment."
      action={<Button variant="quiet" disabled={!facilityId || loading || busy} onClick={() => void load()}>Refresh queue</Button>} />
    <Notice tone="attention">No automatic payment, insurer verification or clinical triage is performed here. Manual facility review must be genuine. Urgent patients need hospital assistance, not a digital waiting number.</Notice>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Facility" htmlFor="desk-facility"><select id="desk-facility" className={inputClass} value={facilityId} disabled={busy}
        onChange={(event) => { ++revision.current; setVisits([]); setDepartments([]); setDepartmentId(''); setMessage(null); setFacilityId(event.target.value); }}>
        <option value="">Choose facility</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}{!f.enabled ? ' — desk disabled' : ''}</option>)}
      </select></Field>
      <Field label="Department" htmlFor="desk-department"><select id="desk-department" className={inputClass} value={departmentId} disabled={!facilityId || busy}
        onChange={(event) => { ++revision.current; setVisits([]); setDepartmentId(event.target.value); }}>
        <option value="">{mode === 'clinical' ? 'My authorized department' : 'All departments'}</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select></Field>
    </div>
    {error && <Notice>{error}</Notice>}{message && <p role="status" className="rounded-lg border border-line p-3 text-petrol">{message}</p>}
    {mode === 'administration' && selected && <Card><details><summary className="cursor-pointer font-semibold">Facility policy & directory labels</summary>
      <form key={`${selected.id}:${selected.version}`} onSubmit={configure} className="mt-4 space-y-3">
        <p className="text-sm text-ink-soft">Enable only after the facility agrees to operate this queue. This does not establish a hospital integration or waive clinical triage.</p>
        <label className="block"><input type="checkbox" name="enabled" defaultChecked={selected.enabled} /> Enable AHP digital front desk</label>
        <label className="block"><input type="checkbox" name="payment" defaultChecked={selected.payment_required} /> Require manual payment-clearance confirmation</label>
        <label className="block"><input type="checkbox" name="insurance" defaultChecked={selected.insurance_required} /> Require manual insurance-clearance confirmation</label>
        <Button disabled={busy}>Save facility policy</Button>
      </form>
      {departments.map((d) => <form key={`${d.id}:${d.version}`} onSubmit={(e) => void aliases(e, d)} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="grow"><Field label={`${d.name}: directory terms (comma separated)`} htmlFor={`aliases-${d.id}`} hint="Navigation keywords only. Not diagnosis or urgency rules."><input id={`aliases-${d.id}`} name="aliases" className={inputClass} defaultValue={d.navigation_aliases?.join(', ') ?? ''} maxLength={1800} /></Field></div>
        <Button variant="quiet" disabled={busy}>Save labels</Button>
      </form>)}
    </details></Card>}
    {loading ? <p role="status">Loading verified queue…</p> : !error && visits.length === 0 ? <Empty>{facilityId ? 'No active visits in this authorized queue.' : 'Select a facility to open its queue.'}</Empty> : null}
    {!loading && !error && visits.map((visit) => <Card key={`${visit.id}:${visit.version}`} className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">{visit.ticket} · {visit.patient_name}</h2><p className="text-sm text-ink-soft">{visit.department.name} · {visit.requested_clinician?.name ?? 'Department pool'}</p></div><Badge>{deskStatusLabels[visit.status]}</Badge></div>
      {visit.purpose && <p className="max-w-prose whitespace-pre-wrap">{visit.purpose}</p>}
      <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-ink-soft">Arrival</dt><dd>{visit.checked_in_at ? 'Patient declared arrival' : 'Not declared'}</dd></div>
        <div><dt className="text-ink-soft">Clinical review</dt><dd>{visit.clearance.clinical_review}</dd></div>
        <div><dt className="text-ink-soft">Payment review</dt><dd>{visit.clearance.payment.replaceAll('_', ' ')}</dd></div>
        <div><dt className="text-ink-soft">Insurance review</dt><dd>{visit.clearance.insurance.replaceAll('_', ' ')}</dd></div></dl>
      {visit.clearance.clinical_review === 'escalated' && <Notice>Clinician marked this visit for immediate review. Do not admit to the routine queue without a new clinical assessment.</Notice>}
      {mode === 'administration' && ['preregistered','awaiting_review'].includes(visit.status) &&
        <AdministrativeForm visit={visit} busy={busy} submit={(body) => act(visit, 'administrative-review', body)} />}
      {mode === 'clinical' && <div className="flex flex-wrap gap-3">
        {['preregistered','awaiting_review'].includes(visit.status) && <>
          <Button disabled={busy} onClick={() => { if (window.confirm('Confirm you have assessed this patient and cleared them for the routine department queue.')) void act(visit, 'clinical-review', { decision: 'cleared' }); }}>Record routine-queue clearance</Button>
          <Button variant="danger" disabled={busy} onClick={() => { if (window.confirm('Record that immediate clinician review is required? This does not dispatch emergency help.')) void act(visit, 'clinical-review', { decision: 'escalated' }); }}>Needs immediate review</Button>
        </>}
        {visit.status === 'waiting' && <Button disabled={busy} onClick={() => void act(visit, 'call')}>Call patient</Button>}
        {visit.status === 'called' && <Button disabled={busy} onClick={() => { if (window.confirm('Start this patient’s consultation now?')) void act(visit, 'start'); }}>Start consultation</Button>}
        {visit.consultation_id && <Link className="inline-flex min-h-11 items-center text-petrol underline" href={`/doctor/case/${visit.consultation_id}`}>Open consultation & chat</Link>}
      </div>}
      {['preregistered','awaiting_review','waiting','called'].includes(visit.status) && <Button variant="quiet" disabled={busy} onClick={() => {
        if (window.confirm('Cancel this visit? No consultation or clinical history will be deleted.')) void act(visit, 'cancel');
      }}>Cancel visit</Button>}
    </Card>)}
    {more && <Notice tone="attention">Showing the first 100 active visits. Filter by department. Do not interpret this limited list as the complete facility census.</Notice>}
  </PageShell>;
}

function AdministrativeForm({ visit, busy, submit }: { visit: DeskVisit; busy: boolean; submit: (body: Record<string, unknown>) => Promise<void> }) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    void submit({ registration_confirmed: true,
      payment_check: visit.requirements.payment ? 'manually_verified' : 'not_required',
      insurance_check: visit.requirements.insurance ? 'manually_verified' : 'not_required',
      ...(visit.requirements.payment ? { payment_reference: String(values.get('payment_reference') ?? '').trim() } : {}),
      ...(visit.requirements.insurance ? { insurance_reference: String(values.get('insurance_reference') ?? '').trim() } : {}),
    });
  }
  return <form onSubmit={save} className="max-w-2xl space-y-3 rounded-lg border border-line p-4">
    <h3 className="font-semibold">Manual administrative clearance</h3><p className="text-sm text-ink-soft">Record checks already performed by the facility. This does not charge money or verify insurance electronically. Use a non-sensitive internal reference, never a bank/card/member number.</p>
    {visit.requirements.payment && <Field label="Payment verification reference" htmlFor={`payment-${visit.id}`}><input id={`payment-${visit.id}`} name="payment_reference" className={inputClass} required maxLength={120} /></Field>}
    {visit.requirements.insurance && <Field label="Insurance verification reference" htmlFor={`insurance-${visit.id}`}><input id={`insurance-${visit.id}`} name="insurance_reference" className={inputClass} required maxLength={120} /></Field>}
    <label className="flex items-start gap-2"><input type="checkbox" required /> I have checked patient registration and the required administrative clearances.</label>
    <Button disabled={busy}>Record manual clearance</Button>
  </form>;
}
