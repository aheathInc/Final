'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { Badge, Card, Empty } from '@/components/ui';

type Category = 'all' | 'consent' | 'verification' | 'break_glass';
interface AuditEvent {
  seq: string;
  category: Exclude<Category, 'all'>;
  event_type: string;
  actor_id: string | null;
  resource_type: string;
  resource_id: string | null;
  occurred_at: string;
  details: Record<string, string>;
}

const labels: Record<Exclude<Category, 'all'>, string> = {
  consent: 'Consent',
  verification: 'Clinician verification',
  break_glass: 'Emergency access',
};

export function AuditLedgerPanel({ events, unavailable }: { events: AuditEvent[]; unavailable: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>('all');
  const [verification, setVerification] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = category === 'all' ? events : events.filter((event) => event.category === category);

  async function verify() {
    setChecking(true);
    setError(null);
    setVerification(null);
    try {
      const response = await api.post('/audit/verify');
      setVerification(response.data.status === 'VALID' ? 'VALID' : 'INVALID');
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Ledger verification could not be completed.'));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mt-6 space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            Event category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-ink"
            >
              <option value="all">All supported events</option>
              <option value="consent">Consent</option>
              <option value="verification">Clinician verification</option>
              <option value="break_glass">Emergency access</option>
            </select>
          </label>
          <button
            type="button"
            onClick={verify}
            disabled={checking || unavailable}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {checking ? 'Verifying…' : 'Verify full ledger'}
          </button>
        </div>
        {unavailable && <p className="mt-3 text-sm text-amber-800">The audit service is unavailable.</p>}
        {verification && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm font-semibold">
            Ledger status: <Badge tone={verification === 'VALID' ? 'good' : 'problem'}>{verification}</Badge>
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </Card>

      {shown.length === 0 ? (
        <Empty>No supported audit events are available in this category.</Empty>
      ) : (
        <ol className="space-y-3">
          {shown.map((event) => (
            <li key={event.seq}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge tone="neutral">{labels[event.category]}</Badge>
                    <h2 className="mt-2 font-semibold">{event.event_type.replace(/[._]/g, ' ')}</h2>
                  </div>
                  <time className="text-sm text-ink-soft" dateTime={event.occurred_at}>
                    {new Date(event.occurred_at).toLocaleString()}
                  </time>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-ink-soft">Actor reference</dt><dd className="break-all font-mono">{event.actor_id ?? 'System'}</dd></div>
                  <div><dt className="text-ink-soft">Resource reference</dt><dd className="break-all font-mono">{event.resource_type}{event.resource_id ? ` · ${event.resource_id}` : ''}</dd></div>
                  {Object.entries(event.details).map(([key, value]) => (
                    <div key={key}><dt className="text-ink-soft">{key.replace(/_/g, ' ')}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
