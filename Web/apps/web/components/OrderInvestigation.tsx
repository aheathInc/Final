'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

const OPTIONS = [
  { code: 'Complete Blood Count (CBC)', type: 'laboratory' },
  { code: 'Malaria rapid diagnostic test', type: 'point_of_care' },
  { code: 'Chest X-ray', type: 'imaging' },
] as const;

export function OrderInvestigation({
  careThreadId,
  consultationId,
}: {
  careThreadId: string;
  consultationId: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState<string>(OPTIONS[0]!.code);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const selected = OPTIONS.find((o) => o.code === code) ?? OPTIONS[0]!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOrderId(null);
    try {
      const res = await api.post('/investigation-orders', {
        care_thread_id: careThreadId,
        consultation_id: consultationId,
        investigation_code: selected.code,
        investigation_type: selected.type,
        urgency: 'routine',
        clinical_notes: notes.trim() || undefined,
      }, idem());
      setOrderId(res.data.id);
      setNotes('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'The investigation order could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Order investigation</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Investigation" htmlFor="investigation-code">
          <select
            id="investigation-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
          >
            {OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>{o.code}</option>
            ))}
          </select>
        </Field>
        <div className="self-end text-sm text-ink-soft">{selected.type}</div>
      </div>
      <div className="mt-3">
        <Field label="Clinical notes" htmlFor="investigation-notes" hint="Optional">
          <textarea
            id="investigation-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={areaClass}
            rows={3}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy}>
          {busy ? 'Ordering...' : 'Order investigation'}
        </Button>
        {orderId && (
          <Link href={`/doctor/diagnostics/${orderId}`} className="text-sm text-petrol underline underline-offset-4">
            Open order
          </Link>
        )}
      </div>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </form>
  );
}
