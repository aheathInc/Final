'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, idem, type DigitalReferral, type Page,
  type ReferralAuthorization, type ReferralCase } from '@/lib/api';
import { Badge, Button, Card, Empty, Field, Notice, PageHeader, PageShell, areaClass, inputClass } from './ui';
import { dateTime } from '@/lib/format';
import { Icon } from './premium/Icon';
import { ReferralConversation } from './ReferralConversation';

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
  const [facilityId, setFacilityId] = useState('');
  const [facilities, setFacilities] = useState<Array<{id:string;name:string;type:string}>>([]);
  const [facilitySearch, setFacilitySearch] = useState('');
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesError, setFacilitiesError] = useState<string|null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState<string|null>(null);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentsError, setDepartmentsError] = useState<string|null>(null);
  const consentRequest = useRef(0), departmentRequest = useRef(0);
  const loadFacilities = useCallback(async () => {
    setFacilitiesLoading(true); setFacilitiesError(null);
    try {
      const lists = await Promise.all(['hospital','clinic'].map(async type => {
        const result: Array<{id:string;name:string;type:string}> = [];
        let cursor: string|undefined;
        do {
          const response = await api.get<Page<{id:string;name:string;type:string}>>('/facilities', {params:{type,limit:100,...(cursor?{cursor}:{})}});
          result.push(...response.data.data); cursor=response.data.meta?.next_cursor??undefined;
        } while(cursor);
        return result;
      }));
      setFacilities(lists.flat().sort((a,b)=>a.name.localeCompare(b.name)));
    } catch(cause) { setFacilitiesError(errorMessage(cause,'Hospitals could not be loaded. Try again.')); }
    finally { setFacilitiesLoading(false); }
  },[]);
  useEffect(()=>{void loadFacilities();},[loadFacilities]);
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

  async function refreshAuthorizations(consultationId: string) {
    const request = ++consentRequest.current;
    setAuthorizations([]); setConsentError(null); setConsentLoading(Boolean(consultationId));
    if (!consultationId) return;
    try {
      const response = await api.get<Page<ReferralAuthorization>>('/referrals/authorizations', {params:{consultation_id:consultationId}});
      if(request===consentRequest.current)setAuthorizations(response.data.data);
    } catch(cause) {
      if(request===consentRequest.current)setConsentError(errorMessage(cause,'Patient consent could not be checked. Try again.'));
    } finally { if(request===consentRequest.current)setConsentLoading(false); }
  }

  function chooseCase(consultationId: string) {
    setSelectedCase(consultationId);
    setSummary(cases.find(item=>item.consultation_id===consultationId)?.clinical_summary??'');
    void refreshAuthorizations(consultationId);
  }

  const selectedFacility = facilities.find(item=>item.id===facilityId);
  const selectedAuthorization = authorizations.find(item=>item.facility_id===facilityId && (!item.expires_at || Date.parse(item.expires_at)>Date.now()));
  const visibleFacilities = facilities.filter(item=>item.id===facilityId || item.name.toLocaleLowerCase().includes(facilitySearch.trim().toLocaleLowerCase()));

  async function selectFacility(id: string) {
    const request=++departmentRequest.current;
    setFacilityId(id); setDepartmentId(''); setDepartments([]); setDepartmentsError(null); setDepartmentsLoading(Boolean(id));
    if(!id)return;
    try {
      const response=await api.get<{data:Array<{id:string;name:string}>}>(`/facilities/${id}/departments`);
      if(request===departmentRequest.current)setDepartments(response.data.data);
    } catch(cause) {
      if(request===departmentRequest.current)setDepartmentsError(errorMessage(cause,'Departments could not be loaded. Try again.'));
    } finally { if(request===departmentRequest.current)setDepartmentsLoading(false); }
  }

  async function submitNewReferral(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase || !selectedFacility || !selectedAuthorization || consentLoading || facilitiesLoading || facilitiesError) return;
    setBusyId('create');
    setError(null);
    setNotice(null);
    try {
      const created = await api.post<DigitalReferral>('/referrals', {
        consultation_id: selectedCase,
        destination_facility_id: selectedFacility.id,
        ...(departmentId ? { destination_department_id: departmentId } : {}),
        patient_consent_id: selectedAuthorization.consent_id,
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
        <dl className="grid gap-1 text-xs text-ink-soft sm:grid-cols-2 break-words">
          <div>Patient reference: <code>{referral.patient_reference ?? 'Unavailable'}</code></div>
          <div>Referring clinician: {referral.source.clinician?.full_name ?? 'Clinician'}</div>
          <div>From: {referral.source.facility.name}{referral.source.department ? ` / ${referral.source.department.name}` : ''}</div>
          <div>Referral ID: <code>{referral.id}</code></div>
          <div>Consultation: <code>{referral.consultation_id}</code></div>
          <div>Created: {dateTime(referral.created_at)}</div>
          <div>Submitted: {dateTime(referral.submitted_at)}</div>
          <div>Updated: {dateTime(referral.updated_at)}</div>
          <div>Expires: {dateTime(referral.expires_at)}</div>
          <div>Received: {dateTime(referral.received_at)}</div>
          <div>Accepted: {dateTime(referral.accepted_at)}</div>
          <div>Care started: {dateTime(referral.care_started_at)}</div>
          <div>Completed: {dateTime(referral.completed_at)}</div>
          <div>Declined: {dateTime(referral.declined_at)}</div>
          <div>Cancelled: {dateTime(referral.cancelled_at)}</div>
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
        <ReferralConversation referral={referral} />
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
      <PageHeader title="Create a referral" lede="Send a secure, patient-authorized handoff with the clinical context the receiving team needs." action={<Button variant="quiet" disabled={loading || facilitiesLoading || busyId==='create'} onClick={() => { void load(); void loadFacilities(); void refreshAuthorizations(selectedCase); }}>Refresh</Button>} />
      <div className="mt-5 space-y-4">
        {error && <Notice>{error}</Notice>}
        {notice && <p role="status" className="rounded border border-teal/30 bg-teal/5 p-3 text-sm">{notice}</p>}
      </div>
      <div className="ahp-referral-layout">
      <Card className="ahp-referral-card">
        <div className="ahp-toolbar"><h2>Referral details</h2><span className="ahp-caption">Patient-authorized information only</span></div>
        <form className="ahp-referral-form" onSubmit={submitNewReferral}>
          <h3 className="ahp-form-section-line"><span className="ahp-step-number">1</span>Case & destination</h3>
          <Field label="Case" htmlFor="referral-case-select">
            <select id="referral-case-select" className={inputClass} value={selectedCase} disabled={busyId==='create'} onChange={(event) => void chooseCase(event.target.value)} required>
              <option value="">Select a case</option>
              {cases.map((item) => <option key={item.consultation_id} value={item.consultation_id}>{item.consultation_id} · {item.status} · {item.clinical_summary?.slice(0, 80) ?? 'Case'}</option>)}
            </select>
          </Field>
          <div className="ahp-full">
            <Field label="Destination hospital / facility" htmlFor="referral-destination-facility" hint="Choose the hospital or clinic that will receive this referral.">
              <label htmlFor="referral-facility-search" className="mt-2 block text-sm">Search hospitals and clinics</label>
              <input id="referral-facility-search" type="search" className={inputClass} placeholder="Type a hospital name" value={facilitySearch} onChange={event=>setFacilitySearch(event.target.value)} disabled={facilitiesLoading || busyId==='create'} />
              <select id="referral-destination-facility" className={inputClass+' mt-2'} value={facilityId} onChange={event=>void selectFacility(event.target.value)} required disabled={facilitiesLoading || !!facilitiesError || busyId==='create'}>
                <option value="">{facilitiesLoading?'Loading hospitals...':'Select destination hospital / facility'}</option>
                {visibleFacilities.map(item=><option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}
              </select>
              {facilitiesError?<div className="mt-2"><Notice>{facilitiesError}</Notice><Button type="button" variant="quiet" onClick={()=>void loadFacilities()}>Retry hospital list</Button></div>:!facilitiesLoading&&!facilities.length?<p className="mt-2 text-sm text-ink-soft">No active hospitals or clinics are registered. Ask the facility administrator to register the destination.</p>:!facilitiesLoading&&!visibleFacilities.length?<p className="mt-2 text-sm text-ink-soft">No hospitals match this search. Try another name.</p>:null}
            </Field>
          </div>
          <Field label="Destination department (optional)" htmlFor="referral-department-select">
            <select id="referral-department-select" className={inputClass} value={departmentId} onChange={event=>setDepartmentId(event.target.value)} disabled={!facilityId || departmentsLoading || busyId==='create'}>
              <option value="">{!facilityId?'Choose a destination hospital first':departmentsLoading?'Loading departments...':'Any eligible department at this facility'}</option>
              {departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
            {departmentsError&&<div className="mt-2"><Notice>{departmentsError}</Notice><Button type="button" variant="quiet" onClick={()=>void selectFacility(facilityId)}>Retry departments</Button></div>}
          </Field>
          <div className="ahp-full rounded-md bg-paper-sunk p-3 text-sm" aria-live="polite">
            <strong>Patient consent for the destination</strong>
            <p className="mt-1">{!facilityId?'Choose the destination hospital to check patient consent.':!selectedCase?'Select a case to check consent for this hospital.':consentLoading?'Checking patient consent...':consentError?consentError:selectedAuthorization?`Patient has authorized ${selectedFacility?.name??'this hospital'} for this case.`:`Patient consent is required for ${selectedFacility?.name??'this hospital'}. Ask the patient to authorize this hospital for this case in Privacy & Consent, then refresh the consent check.`}</p>
            {facilityId&&selectedCase&&<Button type="button" variant="quiet" className="mt-2" disabled={consentLoading || busyId==='create'} onClick={()=>void refreshAuthorizations(selectedCase)}>Refresh patient consent</Button>}
          </div>
          <h3 className="ahp-form-section-line"><span className="ahp-step-number">2</span>Clinical context</h3>
          <div className="ahp-full"><Field label="Referral purpose" htmlFor="referral-purpose"><textarea id="referral-purpose" className={areaClass} value={purpose} minLength={5} maxLength={1000} required rows={2} onChange={(event) => setPurpose(event.target.value)} /></Field></div>
          <div className="ahp-full"><Field label="Minimum necessary summary — review and edit before sending" htmlFor="referral-summary"><textarea id="referral-summary" className={areaClass} value={summary} minLength={5} maxLength={4000} required rows={3} onChange={(event) => setSummary(event.target.value)} /></Field></div>
          <Field label="Priority" htmlFor="referral-priority">
            <select id="referral-priority" className={inputClass} value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
              <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
            </select>
          </Field>
          <div className="ahp-form-actions"><Button disabled={loading || facilitiesLoading || !!facilitiesError || consentLoading || busyId === 'create' || !selectedFacility || !selectedAuthorization}>{busyId === 'create' ? 'Saving…' : 'Confirm and submit referral'}</Button></div>
        </form>
      </Card>
      <aside className="ahp-context"><Icon name="shield" size={27}/><h2>Patient consent sets the boundary.</h2><p>Choose a registered destination hospital or clinic. Sending requires patient consent for that facility and this case.</p><hr/><strong>Share the minimum necessary</strong><p>Review the summary before sending. A referral never grants unrestricted access to a patient’s record.</p><hr/><strong>Keep each stage clear</strong><p>Submitted, accepted and care started are separate states.</p></aside>
      </div>
      <div className="ahp-referral-lists">
      <section className="ahp-card space-y-3">
        <h2 className="text-lg font-semibold">Receiving facility inbox</h2>
        {loading ? <p>Loading referrals…</p> : inbox.length ? <div className="space-y-3">{inbox.map((item) => referralCard(item, 'inbox'))}</div> : <Empty>No authorized incoming referrals are waiting.</Empty>}
      </section>
      <section className="ahp-card space-y-3">
        <h2 className="text-lg font-semibold">Referrals I sent</h2>
        {loading ? <p>Loading referrals…</p> : source.length ? <div className="space-y-3">{source.map((item) => referralCard(item, 'source'))}</div> : <Empty>You have not sent any referrals.</Empty>}
      </section>
      </div>
    </PageShell>
  );
}
