'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DeclineReason, QueueEntry } from '@/lib/api';
import { countdown } from '@/lib/format';
import { urgencyStyle } from '@/lib/urgency';
import { Button, Card } from './ui';

const REASONS: { value: DeclineReason; label: string }[] = [
  { value: 'out_of_specialty', label: 'Outside my specialty' },
  { value: 'language_mismatch', label: 'Language mismatch' },
  { value: 'at_capacity', label: 'At capacity' },
  { value: 'other', label: 'Other reason' },
];

export function QueueCard({
  entry, busy, scope, onAccept, onDecline,
}: {
  entry: QueueEntry;
  busy: boolean;
  scope: 'offered' | 'mine';
  onAccept: (id: string) => void;
  onDecline: (id: string, reason: DeclineReason) => void;
}) {
  const s = urgencyStyle(entry.consultation.urgency_level);
  const [now, setNow] = useState(() => Date.now());
  const [choosing, setChoosing] = useState(false);
  const deadline = scope === 'offered'
    ? Date.parse(entry.offer?.expires_at ?? '')
    : Date.parse(entry.consultation.sla_deadline_at);
  const left = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const expired = scope === 'offered' && left <= 0;

  // A queue that silently goes stale is worse than none: it shows time
  // remaining that has already run out.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const p = entry.patient_summary;

  return (
    <Card accent={s.border}>
      <header className="flex items-center justify-between gap-4">
        <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
        <span className={`font-mono text-sm tabular-nums ${left <= 0 ? 'font-semibold text-clay' : 'text-ink-soft'}`}>
          {scope === 'offered' ? `Offer expires ${countdown(left)}` : `SLA ${countdown(left)}`}
        </span>
      </header>

      <p className="mt-2 text-xs text-ink-soft">
        Request {entry.consultation.id.slice(0, 8)} · {entry.offer?.state ?? (scope === 'mine' ? 'assigned' : 'offer state unavailable')}
      </p>

      <p className="mt-2 text-[0.95rem] leading-snug">
        {entry.consultation.symptom_text || 'No symptom text provided.'}
      </p>

      {/*
        Only what the contract permits before acceptance: an age band, never a
        date of birth, and no name. The line under it says so, so the sparseness
        does not read as missing data.
      */}
      {p && (
        <p className="mt-3 text-sm text-ink-soft">
          {p.age_band && p.age_band !== 'unknown' ? p.age_band : 'Age unknown'}
          {p.sex ? `, ${p.sex}` : ''}
          {p.preferred_language ? ` · ${p.preferred_language.toUpperCase()}` : ''}
          {p.has_chronic_conditions ? ' · chronic condition noted' : ''}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">Full record access opens only after you accept this case.</p>

      {scope === 'mine' ? (
        <Link
          href={`/doctor/case/${entry.consultation.id}`}
          className="mt-4 inline-block min-h-11 bg-petrol px-5 py-2.5 font-medium text-white hover:bg-petrol-lift"
        >
          Open case
        </Link>
      ) : expired ? (
        <p className="mt-4 text-sm text-ink-soft">This offer has expired and is no longer actionable.</p>
      ) : !choosing ? (
        <div className="mt-4 flex gap-3">
          <Button onClick={() => onAccept(entry.consultation.id)} disabled={busy} className="flex-1">
            Accept
          </Button>
          <Button variant="quiet" onClick={() => setChoosing(true)} disabled={busy}>
            Decline
          </Button>
        </div>
      ) : (
        // Declining asks why, because routing weighs specialty, language and
        // load — a reason improves the next match, and its absence teaches
        // the router nothing.
        <div className="mt-4">
          <p className="text-sm font-medium">Why are you declining?</p>
          <div className="mt-2 flex flex-col gap-2">
            {REASONS.map((r) => (
              <button key={r.value} onClick={() => onDecline(entry.consultation.id, r.value)} disabled={busy}
                className="min-h-11 rounded-md border border-line px-4 text-left text-[0.95rem] hover:bg-paper-sunk disabled:opacity-50">
                {r.label}
              </button>
            ))}
            <button onClick={() => setChoosing(false)}
              className="min-h-11 px-4 text-left text-sm text-ink-soft underline underline-offset-4">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
