'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, idem, type DigitalReferral, type Page,
  type ReferralAuthorization, type ReferralCase } from '@/lib/api';
import { Badge, Button, Card, Empty, Field, Notice, PageHeader, PageShell, areaClass, inputClass } from './ui';
import { dateTime } from '@/lib/format';

const statusLabels: Record<DigitalReferral['status'], string> = {
  draft: 'Draft', submitted: 'Submitted — awaiting facility receipt', received: 'Received — awaiting clinician decision',
  accepted: 'Accepted — care has not started', declined: 'Declined', in_care: 'Care started',
  completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired',
};

function statusTone(status: DigitalReferral['status']) {
  if (status === 'accepted' || status === 'in_care' || status === 'completed') return 'good' as const;
  if (status === 'submitted' || status === 'received') return 'attention' as const;
  if (status === 'declined' || status === 'cancelled' || status === 'expired') return 'problem' as const;
  return 'neutral' as const;
}

export function DigitalReferralWorkspace() {
  const [cases, setCases] = useState<ReferralCase[]>([]);
  const [source, setSource] = useState<DigitalReferral[]>([]);
  const [inbox, setInbox] = useState<DigitalReferral[]>([]);
  const [authorizations, setAuthorizations] = useState<ReferralAuthorization[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCase, setSelectedCase] = useState('');
  const [consentId, setConsentId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [summary, setSummary] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'emergency'>('routine');
  const [outcomeStatus, setOutcomeStatus] = useState<'care_provided' | 'redirected' | 'unable_to_complete'>('care_provided');
  const [followUp, setFollowUp] = useState('');
  const [instructions, setInstructions] = useState('');
  const [declineReasons, setDeclineReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseResponse, sourceResponse, inboxResponse] = await Promise.all([
        api.get<Page<ReferralCase>>('/referrals/cases?limit=100'),
        api.get<Page<DigitalReferral>>('/referrals/source?limit=100'),
        api.get<Page<DigitalReferral>>('/referrals/inbox?limit=100'),
      ]);
      setCases(caseResponse.data.data);
      setSource(sourceResponse.data.data);
      setInbox(inboxResponse.data.data);
    } catch (cause) {
      setError(errorMessage(cause, 'Referral workspace could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function chooseCase(consultationId: string) {
    setSelectedCase(consultationId);
    setConsentId('');
    setDepartmentId('');
    setDepartments([]);
    const item = cases.find((value) => value.consultation_id === consultationId);
    setSummary(item?.clinical_summary ?? '');
    setError(null);
    if (!consultationId) { setAuthorizations([]); return; }
    try {
      const response = await api.get<Page<ReferralAuthorization>>('/referrals/authorizations', { params: { consultation_id: consultationId } });
      setAuthorizations(response.data.data);
    } catch (cause) {
      setAuthorizations([]);
      setError(errorMessage(cause, 'No active facility authorization could be verified.'));
    }
  }

  const selectedAuthorization = authorizations.find((item) => item.consent_id === consentId);

  async function selectAuthorization(id: string) {
    setConsentId(id);
    setDepartmentId('');
    if (!id) { setDepartments([]); return; }
    const authorization = authorizations.find((item) => item.consent_id === id);
    if (!authorization) return;
    try {
      const response = await api.get<{ data: Array<{ id: string; name: string }> }>(`/facilities/${authorization.facility_id}/departments`);
      setDepartments(response.data.data);
    } catch (cause) {
      setDepartments([]);
      setError(errorMessage(cause, 'Departments could not be loaded.'));
    }
  }

  async function submitNewReferral(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase || !selectedAuthorization) return;
    setBusyId('create');
    setError(null);
    setNotice(null);
    try {
      const created = await api.post<DigitalReferral>('/referrals', {
        consultation_id: selectedCase,
        destination_facility_id: selectedAuthorization.facility_id,
        ...(departmentId ? { destination_department_id: departmentId } : {}),
        patient_consent_id: consentId,
        purpose: purpose.trim(),
        clinical_summary: summary.trim(),
        priority,
      }, idem());
      try {
        await api.post(`/referrals/${created.data.id}/submit`, {}, idem());
        setNotice(`Referral ${created.data.id} was submitted. Submission is not acceptance or a start of care.`);
      } catch (cause) {
        setNotice(`Referral ${created.data.id} was saved as a draft. Submit it from your referral list after reviewing the error.`);
        setError(errorMessage(cause, 'The draft was saved but could not be submitted.'));
      }
      setPurpose('');
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Referral could not be created.'));
    } finally {
      setBusyId(null);
    }
  }

  async function act(referral: DigitalReferral, action: string, body: Record<string, unknown> = {}) {
    setBusyId(referral.id);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/referrals/${referral.id}/${action}`, body, idem());
      setNotice(`Referral ${referral.id}: ${action.replace('-', ' ')} recorded.`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, `Could not ${action.replace('-', ' ')} this referral.`));
    } finally {
      setBusyId(null);
    }
  }

  function referralCard(referral: DigitalReferral, mode: 'source' | 'inbox') {
    const busy = busyId === referral.id;
    return (
      <Card key={referral.id} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">{referral.destination.facility.name}</p>
            <p className="text-xs text-ink-soft">{referral.destination.department?.name ?? 'Facility-wide'} · {referral.priority}</p>
          </div>
          <Badge tone={statusTone(referral.status)}>{statusLabels[referral.status]}</Badge>
        </div>
        <p className="text-sm">{referral.purpose}</p>
        {referral.clinical_summary && <p className="whitespace-pre-wrap rounded bg-paper-sunk p-3 text-sm">{referral.clinical_summary}</p>}
        <dl className="grid gap-1 text-xs text-ink-soft sm:grid-cols-2">
          <div>Referral ID: <code>{referral.id}</code></div>
          <div>Consultation: <code>{referral.consultation_id}</code></div>
          <div>Created: {dateTime(referral.created_at)}</div>
          <div>Received: {dateTime(referral.received_at)}</div>
          <div>Accepted: {dateTime(referral.accepted_at)}</div>
          <div>Care started: {dateTime(referral.care_started_at)}</div>
          <div>Completed: {dateTime(referral.completed_at)}</div>
        </dl>
        {referral.decline_reason && <p className="text-sm text-clay">Decline reason: {referral.decline_reason}</p>}
        {referral.outcome && (
          <div className="rounded-md border border-teal/30 bg-teal/5 p-3 text-sm">
            <p className="font-semibold">Outcome: {referral.outcome.status.replaceAll('_', ' ')}</p>
            <p>Receiving clinician: {referral.outcome.receiving_clinician.full_name ?? 'Clinician'}</p>
            {referral.outcome.follow_up_recommendation && <p>Follow-up: {referral.outcome.follow_up_recommendation}</p>}
            {referral.outcome.patient_instructions && <p>Patient instructions: {referral.outcome.patient_instructions}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {mode === 'source' && referral.status === 'draft' && <Button disabled={busy} onClick={() => void act(referral, 'submit')}>Submit referral</Button>}
          {mode === 'inbox' && referral.status === 'submitted' && <Button disabled={busy} onClick={() => void act(referral, 'receive')}>Acknowledge receipt</Button>}
          {mode === 'inbox' && referral.status === 'received' && <>
            <Button disabled={busy} onClick={() => void act(referral, 'accept')}>Accept referral</Button>
            <Field label="Decline reason">
              <input className={inputClass} value={declineReasons[referral.id] ?? ''} onChange={(event) => setDeclineReasons((current) => ({ ...current, [referral.id]: event.target.value }))} />
            </Field>
            <Button variant="danger" disabled={busy || !(declineReasons[referral.id] ?? '').trim()} onClick={() => void act(referral, 'decline', { reason: declineReasons[referral.id]?.trim() })}>Decline</Button>
          </>}
          {mode === 'inbox' && referral.status === 'accepted' && <Button disabled={busy} onClick={() => void act(referral, 'start-care')}>Mark care started</Button>}
        </div>
        {mode === 'inbox' && referral.status === 'in_care' && (
          <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
            <Field label="Recorded outcome">
              <select className={inputClass} value={outcomeStatus} onChange={(event) => setOutcomeStatus(event.target.value as typeof outcomeStatus)}>
                <option value="care_provided">Care provided</option>
                <option value="redirected">Redirected</option>
                <option value="unable_to_complete">Unable to complete</option>
              </select>
            </Field>
            <Field label="Follow-up recommendation (optional)" htmlFor={`referral-follow-up-${referral.id}`}><input id={`referral-follow-up-${referral.id}`} className={inputClass} value={followUp} maxLength={1000} onChange={(event) => setFollowUp(event.target.value)} /></Field>
            <Field label="Patient instructions (optional)" htmlFor={`referral-patient-instructions-${referral.id}`}><textarea id={`referral-patient-instructions-${referral.id}`} className={areaClass} value={instructions} maxLength={1000} onChange={(event) => setInstructions(event.target.value)} /></Field>
            <div className="flex items-end"><Button disabled={busy} onClick={() => void act(referral, 'complete', {
              outcome_status: outcomeStatus,
              ...(followUp.trim() ? { follow_up_recommendation: followUp.trim() } : {}),
              ...(instructions.trim() ? { patient_instructions: instructions.trim() } : {}),
            })}>Complete and send feedback</Button></div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <PageShell>
      <PageHeader title="Digital referrals" lede="Refer a case only to a facility the patient authorized for this exact care thread. Submitted, accepted and care started are separate states." action={<Button variant="quiet" onClick={() => void load()}>Refresh</Button>} />
      <div className="mt-5 space-y-4">
        {error && <Notice>{error}</Notice>}
        {notice && <p role="status" className="rounded border border-teal/30 bg-teal/5 p-3 text-sm">{notice}</p>}
      </div>
      <Card className="mt-5">
        <h2 className="text-lg font-semibold">Create referral</h2>
        <p className="mb-4 text-sm text-ink-soft">Only your assigned or primary-clinician cases appear. Destination options are limited to active exact-thread facility consents.</p>
        <form className="grid gap-4" onSubmit={submitNewReferral}>
          <Field label="Case" htmlFor="referral-case-select">
            <select id="referral-case-select" className={inputClass} value={selectedCase} onChange={(event) => void chooseCase(event.target.value)} required>
              <option value="">Select a case</option>
              {cases.map((item) => <option key={item.consultation_id} value={item.consultation_id}>{item.consultation_id} · {item.status} · {item.clinical_summary?.slice(0, 80) ?? 'Case'}</option>)}
            </select>
          </Field>
          <Field label="Patient-authorized destination facility" htmlFor="referral-destination-consent">
            <select id="referral-destination-consent" className={inputClass} value={consentId} onChange={(event) => void selectAuthorization(event.target.value)} required>
              <option value="">Select an active consent</option>
              {authorizations.map((item) => <option key={item.consent_id} value={item.consent_id}>{item.facility_name}{item.expires_at ? ` · expires ${dateTime(item.expires_at)}` : ''}</option>)}
            </select>
            {selectedCase && authorizations.length === 0 && <p className="mt-1 text-xs text-amber">No exact-thread facility consent is available. Ask the patient to authorize the intended facility in Privacy & Consent.</p>}
          </Field>
          {departments.length > 0 && <Field label="Destination department (optional)" htmlFor="referral-department-select">
            <select id="referral-department-select" className={inputClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">Any eligible department at this facility</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>}
          <Field label="Referral purpose" htmlFor="referral-purpose"><textarea id="referral-purpose" className={areaClass} value={purpose} minLength={5} maxLength={1000} required onChange={(event) => setPurpose(event.target.value)} /></Field>
          <Field label="Minimum necessary summary — review and edit before sending" htmlFor="referral-summary"><textarea id="referral-summary" className={areaClass} value={summary} minLength={5} maxLength={4000} required onChange={(event) => setSummary(event.target.value)} /></Field>
          <Field label="Priority" htmlFor="referral-priority">
            <select id="referral-priority" className={inputClass} value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
              <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
            </select>
          </Field>
          <div><Button disabled={busyId === 'create' || !selectedAuthorization}>{busyId === 'create' ? 'Saving…' : 'Confirm and submit referral'}</Button></div>
        </form>
      </Card>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">Receiving facility inbox</h2>
        {loading ? <p>Loading referrals…</p> : inbox.length ? <div className="space-y-3">{inbox.map((item) => referralCard(item, 'inbox'))}</div> : <Empty>No authorized incoming referrals are waiting.</Empty>}
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">Referrals I sent</h2>
        {loading ? <p>Loading referrals…</p> : source.length ? <div className="space-y-3">{source.map((item) => referralCard(item, 'source'))}</div> : <Empty>You have not sent any referrals.</Empty>}
      </section>
    </PageShell>
  );
}
