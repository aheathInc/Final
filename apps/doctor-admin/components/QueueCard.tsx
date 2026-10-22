'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DeclineReason, QueueEntry } from '@/lib/api';
import { countdown } from '@/lib/format';
import { urgencyStyle } from '@/lib/urgency';
import { Button, Card } from './ui';

const REASONS: { value: DeclineReason; label: string }[] = [
  { value: 'out_of_specialty', label: 'Si utaalamu wangu' },
  { value: 'language_mismatch', label: 'Lugha hailingani' },
  { value: 'at_capacity', label: 'Nina wagonjwa wengi' },
  { value: 'other', label: 'Sababu nyingine' },
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
  const [left, setLeft] = useState(entry.seconds_to_sla_breach ?? 0);
  const [choosing, setChoosing] = useState(false);

  // A queue that silently goes stale is worse than none: it shows time
  // remaining that has already run out.
  useEffect(() => {
    setLeft(entry.seconds_to_sla_breach ?? 0);
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [entry.seconds_to_sla_breach, entry.consultation.id]);

  const p = entry.patient_summary;

  return (
    <Card accent={s.border}>
      <header className="flex items-baseline justify-between gap-4">
        <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
        <span className={`font-mono text-sm tabular-nums ${left <= 0 ? 'font-semibold text-clay' : 'text-ink-soft'}`}>
          {countdown(left)}
        </span>
      </header>

      <p className="mt-2 text-[0.95rem] leading-snug">
        {entry.consultation.symptom_text || 'Hakuna maelezo ya maandishi.'}
      </p>

      {/*
        Only what the contract permits before acceptance: an age band, never a
        date of birth, and no name. The line under it says so, so the sparseness
        does not read as missing data.
      */}
      {p && (
        <p className="mt-3 text-sm text-ink-soft">
          {p.age_band && p.age_band !== 'unknown' ? p.age_band : 'Umri haujulikani'}
          {p.sex ? `, ${p.sex}` : ''}
          {p.preferred_language ? ` · ${p.preferred_language.toUpperCase()}` : ''}
          {p.has_chronic_conditions ? ' · ana ugonjwa sugu' : ''}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">Historia kamili itafunguka ukikubali kesi hii.</p>

      {scope === 'mine' ? (
        <Link
          href={`/case/${entry.consultation.id}`}
          className="mt-4 inline-block min-h-11 bg-petrol px-5 py-2.5 font-medium text-white hover:bg-petrol-lift"
        >
          Fungua kesi
        </Link>
      ) : !choosing ? (
        <div className="mt-4 flex gap-3">
          <Button onClick={() => onAccept(entry.consultation.id)} disabled={busy} className="flex-1">
            Kubali
          </Button>
          <Button variant="quiet" onClick={() => setChoosing(true)} disabled={busy}>
            Kataa
          </Button>
        </div>
      ) : (
        // Declining asks why, because routing weighs specialty, language and
        // load — a reason improves the next match, and its absence teaches
        // the router nothing.
        <div className="mt-4">
          <p className="text-sm font-medium">Kwa nini unakataa?</p>
          <div className="mt-2 flex flex-col gap-2">
            {REASONS.map((r) => (
              <button key={r.value} onClick={() => onDecline(entry.consultation.id, r.value)} disabled={busy}
                className="min-h-11 border border-line px-4 text-left text-[0.95rem] hover:bg-paper-sunk disabled:opacity-50">
                {r.label}
              </button>
            ))}
            <button onClick={() => setChoosing(false)}
              className="min-h-11 px-4 text-left text-sm text-ink-soft underline underline-offset-4">
              Ghairi
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
