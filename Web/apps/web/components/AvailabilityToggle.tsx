'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/**
 * Routing weighs availability and current load. A clinician who is off shift
 * but still marked available is why a case sits unanswered until it escalates,
 * so this sits in the header rather than inside a settings page.
 */
export function AvailabilityToggle({ initial = true }: { initial?: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    setOn(next); // optimistic
    try {
      await api.put('/clinicians/me/availability', { is_available: next });
    } catch {
      setOn(!next); // corrected: the switch must not lie about server state
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={toggle} disabled={busy} aria-pressed={on}
      className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm disabled:opacity-50">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${on ? 'bg-teal' : 'bg-ink-soft'}`} />
      {on ? 'Accepting cases' : 'Not accepting cases'}
    </button>
  );
}
