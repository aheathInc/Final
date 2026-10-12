'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, errorMessage, idem, type Page, type ProviderCollaborator,
  type ProviderClinicalCase, type ProviderClinicalCollaboration } from '@/lib/api';
import { Badge, Button, Card, Empty, Field, Notice, PageHeader, PageShell, areaClass, inputClass } from './ui';
import { dateTime } from '@/lib/format';

function pretty(value: string) {
  return value.replace(/_/g, ' ');
}

function statusTone(status: ProviderClinicalCollaboration['status']) {
  if (status === 'accepted') return 'good' as const;
  if (status === 'requested') return 'attention' as const;
  if (status === 'revoked' || status === 'expired') return 'problem' as const;
  return 'neutral' as const;
}

export function ClinicalCollaborationWorkspace() {
  const [cases, setCases] = useState<ProviderClinicalCase[]>([]);
  const [collaborations, setCollaborations] = useState<ProviderClinicalCollaboration[]>([]);
  const [selectedCase, setSelectedCase] = useState<ProviderClinicalCase | null>(null);
  const [eligible, setEligible] = useState<ProviderCollaborator[]>([]);
  const [inviteeId, setInviteeId] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseResponse, collaborationResponse] = await Promise.all([
        api.get<Page<ProviderClinicalCase>>('/network/collaborations/cases?limit=100'),
        api.get<Page<ProviderClinicalCollaboration>>('/network/collaborations?limit=100'),
      ]);
      setCases(caseResponse.data.data);
      setCollaborations(collaborationResponse.data.data);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not load clinical collaboration.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function startRequest(item: ProviderClinicalCase) {
    setSelectedCase(item);
    setEligible([]);
    setInviteeId('');
    setQuestion('');
    setError(null);
    try {
      const response = await api.get<{ data: ProviderCollaborator[] }>(
        `/network/collaborations/eligible-clinicians?consultation_id=${encodeURIComponent(item.consultation_id)}`,
      );
      setEligible(response.data.data);
      if (response.data.data.length === 0) {
        setNotice('No named clinician currently has active patient consent for this case. Ask the patient to authorize a specific clinician first.');
      } else {
        setNotice(null);
        setInviteeId(response.data.data[0]!.clinician_id);
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Could not check authorized clinicians for this case.'));
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase || !inviteeId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/network/collaborations', {
        consultation_id: selectedCase.consultation_id,
        invited_clinician_id: inviteeId,
        question,
      }, idem());
      setSelectedCase(null);
      setNotice('Request sent. The named clinician can accept or decline it from this workspace.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'The collaboration request was not sent.'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, action: 'accept' | 'decline' | 'revoke') {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/network/collaborations/${id}/${action}`, {}, idem());
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'The request could not be updated.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Clinical collaboration"
        lede="Share one consultation summary with a named, verified clinician after the patient has authorized that clinician for this care thread. Facility or department membership alone grants no access."
        action={<Button variant="quiet" onClick={() => void load()} disabled={loading || busy}>Refresh</Button>}
      />

      <div className="mt-5 flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
        {notice && <p role="status" className="rounded-md border border-teal/30 bg-teal/10 p-3 text-sm text-petrol">{notice}</p>}
      </div>

      {selectedCase && (
        <Card className="mt-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Request collaboration</h2>
              <p className="mt-1 text-sm text-ink-soft">Consultation {selectedCase.consultation_id}</p>
            </div>
            <Button variant="quiet" type="button" onClick={() => setSelectedCase(null)}>Close</Button>
          </div>
          {eligible.length > 0 ? (
            <form onSubmit={submitRequest} className="mt-4 flex flex-col gap-4">
              <Field label="Patient-authorized clinician" hint="Only clinicians with an active, individual consent grant appear here." htmlFor="collaboration-clinician">
                <select id="collaboration-clinician" value={inviteeId} onChange={(event) => setInviteeId(event.target.value)} className={inputClass} required>
                  {eligible.map((clinician) => (
                    <option key={clinician.clinician_id} value={clinician.clinician_id}>
                      {clinician.full_name ?? 'Clinician'} · {pretty(clinician.specialty)} · {clinician.facility_name ?? 'Facility unlisted'}
                      {clinician.department_name ? ` · ${clinician.department_name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Clinical question" hint="This text is visible to the named invitee. Avoid direct identifiers unless they are necessary for care." htmlFor="collaboration-question">
                <textarea id="collaboration-question" className={areaClass} rows={4} maxLength={4000} required value={question} onChange={(event) => setQuestion(event.target.value)} />
              </Field>
              <p className="text-sm text-ink-soft">Access covers this consultation summary and its separate provider discussion. It expires within 7 days by default, never outliving the patient's consent.</p>
              <div className="flex gap-3">
                <Button type="submit" disabled={busy || !question.trim()}>Send request</Button>
                <Button type="button" variant="quiet" onClick={() => setSelectedCase(null)}>Cancel</Button>
              </div>
            </form>
          ) : <p className="mt-3 text-sm text-ink-soft">No eligible clinician is available until the patient grants case-scoped consent to a named clinician.</p>}
        </Card>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">My cases</h2>
        {loading ? <p className="py-5 text-ink-soft">Loading cases...</p> : cases.length === 0 ? (
          <Empty>No cases are assigned to you or owned by your care-thread role.</Empty>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {cases.map((item) => (
              <li key={item.consultation_id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{pretty(item.urgency_level)} consultation · {pretty(item.status)}</p>
                      <p className="mt-1 text-xs text-ink-soft">{item.consultation_id} · {dateTime(item.created_at)}</p>
                      {item.case_summary && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{item.case_summary}</p>}
                    </div>
                    <Button variant="quiet" type="button" onClick={() => void startRequest(item)}>Request collaboration</Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Requests and shared cases</h2>
        {loading ? <p className="py-5 text-ink-soft">Loading requests...</p> : collaborations.length === 0 ? (
          <Empty>No collaboration requests yet.</Empty>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {collaborations.map((item) => {
              const other = item.viewer_role === 'requester' ? item.invited : item.requester;
              return (
                <li key={item.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{other.full_name ?? 'Clinician'} · {pretty(other.specialty)}</p>
                          <Badge tone={statusTone(item.status)}>{pretty(item.status)}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-soft">{other.facility_name ?? 'Facility unlisted'}{other.department_name ? ` · ${other.department_name}` : ''}</p>
                        <p className="mt-1 text-xs text-ink-soft">Consultation {item.consultation_id} · expires {dateTime(item.expires_at)}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm">{item.question}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.status === 'requested' && item.viewer_role === 'invitee' && <>
                          <Button type="button" disabled={busy} onClick={() => void decide(item.id, 'accept')}>Accept</Button>
                          <Button type="button" variant="quiet" disabled={busy} onClick={() => void decide(item.id, 'decline')}>Decline</Button>
                        </>}
                        {item.status === 'accepted' && <>
                          <Link className="inline-flex min-h-11 items-center rounded-md bg-petrol px-5 py-2.5 font-medium text-white" href={`/doctor/clinical-collaboration/${item.id}`}>Open case discussion</Link>
                          <Button type="button" variant="danger" disabled={busy} onClick={() => void decide(item.id, 'revoke')}>Revoke access</Button>
                        </>}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
