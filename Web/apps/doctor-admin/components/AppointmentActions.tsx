'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Notice } from './ui';

/**
 * Starting an appointment opens the consultation — the clinician is already
 * fixed by the booking, so no triage runs. Cancelling releases the slot back
 * to the pool rather than leaving it dead.
 */
export function AppointmentActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ id: string }>(`/appointments/${id}/start`, {}, idem());
      router.push(`/case/${res.data.id}`);
    } catch (e) {
      setError(errorMessage(e, 'Miadi haikuweza kuanzishwa. Huenda ni mapema mno.'));
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true); setError(null);
    try {
      await api.post(`/appointments/${id}/cancel`, {}, idem());
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Haikuweza kughairiwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3">
      <div className="flex gap-3">
        <Button onClick={start} disabled={busy}>Anzisha</Button>
        <Button variant="quiet" onClick={cancel} disabled={busy}>Ghairi</Button>
      </div>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  );
}
