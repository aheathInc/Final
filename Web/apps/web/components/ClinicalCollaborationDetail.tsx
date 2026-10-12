'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem, type Page, type ProviderClinicalCollaboration,
  type ProviderClinicalCollaborationMessage, type ProviderClinicalCase } from '@/lib/api';
import { Badge, Button, Card, Empty, Notice, PageHeader, PageShell, areaClass } from './ui';
import { dateTime } from '@/lib/format';

interface SharedCaseResponse {
  collaboration_id: string;
  scope: 'consultation_summary';
  viewer_role: 'requester' | 'invitee';
  case: ProviderClinicalCase;
}

export function ClinicalCollaborationDetail({ collaborationId }: { collaborationId: string }) {
  const router = useRouter();
  const [collaboration, setCollaboration] = useState<ProviderClinicalCollaboration | null>(null);
  const [sharedCase, setSharedCase] = useState<SharedCaseResponse | null>(null);
  const [messages, setMessages] = useState<ProviderClinicalCollaborationMessage[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<ProviderClinicalCollaboration>(`/network/collaborations/${collaborationId}`);
      setCollaboration(response.data);
      if (response.data.status === 'accepted') {
        const [caseResponse, messageResponse] = await Promise.all([
          api.get<SharedCaseResponse>(`/network/collaborations/${collaborationId}/case`),
          api.get<Page<ProviderClinicalCollaborationMessage>>(`/network/collaborations/${collaborationId}/messages?limit=100`),
        ]);
        setSharedCase(caseResponse.data);
        setMessages(messageResponse.data.data);
      } else {
        setSharedCase(null);
        setMessages([]);
      }
    } catch (cause) {
      setError(errorMessage(cause, 'This case discussion could not be loaded. Access may have expired or been revoked.'));
    } finally {
      setLoading(false);
    }
  }, [collaborationId]);

  useEffect(() => { void load(); }, [load]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/network/collaborations/${collaborationId}/messages`, { body }, idem());
      setBody('');
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'The message was not sent.'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/network/collaborations/${collaborationId}/revoke`, {}, idem());
      router.push('/doctor/clinical-collaboration');
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Access could not be revoked.'));
      setBusy(false);
    }
  }

  const other = collaboration?.viewer_role === 'requester' ? collaboration.invited : collaboration?.requester;

  return (
    <PageShell>
      <PageHeader
        title="Case discussion"
        lede="Provider-only messages are stored separately from the patient's care-thread conversation."
        action={<Button variant="quiet" onClick={() => void load()} disabled={loading || busy}>Refresh</Button>}
      />
      <p className="mt-4"><Link href="/doctor/clinical-collaboration" className="text-sm font-medium text-petrol underline">Back to Clinical Collaboration</Link></p>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}
      {loading && <p className="py-8 text-ink-soft">Loading case collaboration...</p>}
      {!loading && collaboration && (
        <>
          <Card className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{other?.full_name ?? 'Clinician'} · {other?.specialty.replace(/_/g, ' ')}</h2>
                <p className="mt-1 text-sm text-ink-soft">{other?.facility_name ?? 'Facility unlisted'}{other?.department_name ? ` · ${other.department_name}` : ''}</p>
              </div>
              <Badge tone={collaboration.status === 'accepted' ? 'good' : collaboration.status === 'requested' ? 'attention' : 'problem'}>{collaboration.status}</Badge>
            </div>
            <p className="mt-3 text-sm">{collaboration.question}</p>
            <p className="mt-2 text-xs text-ink-soft">Scope: consultation summary · access expires {dateTime(collaboration.expires_at)}</p>
          </Card>

          {sharedCase && (
            <Card className="mt-4">
              <h2 className="font-semibold">Shared consultation summary</h2>
              <p className="mt-1 text-sm text-ink-soft">{sharedCase.case.urgency_level.replace(/_/g, ' ')} · {sharedCase.case.status} · {dateTime(sharedCase.case.created_at)}</p>
              {sharedCase.case.case_summary && <p className="mt-3 whitespace-pre-wrap text-sm">{sharedCase.case.case_summary}</p>}
              {sharedCase.case.structured_symptoms !== undefined && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-petrol">Structured symptom summary</summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-paper-sunk p-3 text-xs">{JSON.stringify(sharedCase.case.structured_symptoms, null, 2)}</pre>
                </details>
              )}
              <p className="mt-3 text-xs text-ink-soft">Patient identity, longitudinal records, prescriptions and signed notes are outside this share scope.</p>
            </Card>
          )}

          {collaboration.status === 'accepted' ? (
            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Clinician discussion</h2>
                <Button type="button" variant="danger" disabled={busy} onClick={() => void revoke()}>Revoke access</Button>
              </div>
              {messages.length === 0 ? <Empty>No provider messages yet.</Empty> : (
                <ol className="mt-3 flex flex-col gap-3">
                  {messages.map((message) => (
                    <li key={message.id}>
                      <Card className={message.author_clinician_id === (collaboration.viewer_role === 'requester' ? collaboration.requester.clinician_id : collaboration.invited.clinician_id) ? 'ml-8 border border-teal/30' : 'mr-8 border border-line'}>
                        <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                        <p className="mt-2 text-xs text-ink-soft">{message.author_clinician_id === collaboration.requester.clinician_id ? collaboration.requester.full_name : collaboration.invited.full_name} · {dateTime(message.created_at)}</p>
                      </Card>
                    </li>
                  ))}
                </ol>
              )}
              <form onSubmit={sendMessage} className="mt-4 flex flex-col gap-3">
                <label htmlFor="provider-collaboration-message" className="text-sm font-medium">Reply to the collaborating clinician</label>
                <textarea id="provider-collaboration-message" className={areaClass} rows={3} maxLength={8000} value={body} onChange={(event) => setBody(event.target.value)} required />
                <div><Button type="submit" disabled={busy || !body.trim()}>Send message</Button></div>
              </form>
            </section>
          ) : <p className="mt-5 text-sm text-ink-soft">The case summary and discussion are available only after acceptance while patient consent remains active.</p>}
        </>
      )}
    </PageShell>
  );
}
