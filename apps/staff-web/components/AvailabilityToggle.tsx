'use client';

import { useEffect, useState } from 'react';
import { api, type ClinicianProfile } from '@/lib/api';

/**
 * Routing weighs availability and current load. A clinician who is off shift
 * but still marked available is why a case sits unanswered until it escalates,
 * so this sits in the header rather than inside a settings page.
 */
export function AvailabilityToggle({
  initial,
  initiallyVerified,
}: { initial?: boolean; initiallyVerified?: boolean }) {
  const [on, setOn] = useState<boolean | null>(initial ?? null);
  const [verified, setVerified] = useState<boolean | null>(initiallyVerified ?? null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial !== undefined && initiallyVerified !== undefined) return;
    let active = true;
    void api.get<ClinicianProfile>('/clinicians/me').then(({ data }) => {
      if (!active) return;
      setOn(data.is_available);
      setVerified(data.verification_status === 'verified');
    }).catch(() => {
      if (active) setError('Availability could not be loaded.');
    });
    return () => { active = false; };
  }, [initial, initiallyVerified]);

  async function toggle() {
    if (on === null || verified !== true) return;
    const next = !on;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { data } = await api.put<ClinicianProfile>('/clinicians/me/availability', { is_available: next });
      setOn(data.is_available);
      setSaved(true);
    } catch (e) {
      const message = (e as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message;
      setError(message ?? 'Availability was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button onClick={toggle} disabled={busy || on === null || verified !== true} aria-pressed={on ?? false}
        className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm disabled:opacity-50">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${on ? 'bg-teal' : 'bg-ink-soft'}`} />
        {on === null ? 'Availability unavailable' : on ? 'Accepting cases' : 'Not accepting cases'}
      </button>
      {saved && <span role="status" className="text-xs text-petrol">Availability saved</span>}
      {verified === false && <span className="text-xs text-ink-soft">Availability changes require a verified clinician.</span>}
      {error && <span role="alert" className="text-xs text-clay">{error}</span>}
    </div>
  );
}
