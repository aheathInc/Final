'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

/**
 * A reason is required and the amount is not: refunding everything is the
 * common case, while why it happened is the part nobody can reconstruct later.
 */
export function RefundPayment({
  paymentId, maxAmount, currency,
}: { paymentId: string; maxAmount: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = amount.trim() ? Number(amount) : undefined;
    if (value !== undefined && (value <= 0 || value > maxAmount)) {
      setError(`Kiasi lazima kiwe kati ya 1 na ${maxAmount.toLocaleString()}.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      await api.post(`/payments/${paymentId}/refund`,
        { reason, ...(value !== undefined ? { amount: value } : {}) }, idem());
      setOpen(false); setAmount(''); setReason('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Marejesho hayakufanikiwa.'));
    } finally { setBusy(false); }
  }

  if (!open) {
    return <div className="mt-3"><Button variant="quiet" onClick={() => setOpen(true)}>Rejesha</Button></div>;
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <Field label="Kiasi" htmlFor="a"
        hint={`Acha wazi kurejesha kilichobaki chote (${maxAmount.toLocaleString()} ${currency}).`}>
        <input id="a" type="number" min={1} max={maxAmount} value={amount}
          onChange={(e) => setAmount(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Sababu" htmlFor="r">
        <textarea id="r" required rows={2} value={reason}
          onChange={(e) => setReason(e.target.value)} className={areaClass} />
      </Field>
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !reason.trim()}>Thibitisha marejesho</Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Ghairi</Button>
      </div>
    </form>
  );
}
