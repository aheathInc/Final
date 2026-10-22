'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, Field, Notice, inputClass } from './ui';

interface Pharmacy { id: string; name: string }
interface HandoffItem {
  id: string;
  medication_name: string;
  dosage: string;
  instructions: string | null;
  quantity_prescribed: number;
  quantity_dispensed: number;
  quantity_remaining: number;
  quantity_on_hand: number | null;
  inventory_status: string;
}
interface Handoff {
  dispensing_id: string;
  prescription_id: string;
  valid_until: string;
  patient_display_name: string;
  prescribed_by: string;
  prescribed_at: string;
  pharmacy: Pharmacy;
  items: HandoffItem[];
}

export function PharmacistWorkspace() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [pharmacyId, setPharmacyId] = useState('');
  const [reference, setReference] = useState('');
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ data: Pharmacy[] }>('/pharmacist/me/pharmacies')
      .then((response) => {
        const rows = response.data.data ?? [];
        setPharmacies(rows);
        if (rows.length === 1) setPharmacyId(rows[0]!.id);
        if (!rows.length) setError('This account has no verified active pharmacy membership. Contact the platform administrator.');
      })
      .catch((reason: unknown) => setError(errorMessage(reason, 'Could not load pharmacy membership.')))
      .finally(() => setLoading(false));
  }, []);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setNotice(null); setHandoff(null);
    try {
      const response = await api.post<Handoff>('/dispensing/verify', { reference: reference.trim(), pharmacy_id: pharmacyId });
      setHandoff(response.data);
      setQuantities(Object.fromEntries(response.data.items.map((item) => [item.id, 0])));
    } catch (reason) {
      setError(errorMessage(reason, 'Reference verification failed. No dispensing was recorded.'));
    } finally { setBusy(false); }
  }

  async function dispense() {
    if (!handoff) return;
    const items = handoff.items
      .map((item) => ({ prescription_item_id: item.id, quantity_dispensed: quantities[item.id] ?? 0 }))
      .filter((item) => item.quantity_dispensed > 0);
    if (!items.length) { setError('Enter a positive quantity for at least one item.'); return; }
    setBusy(true); setError(null); setNotice(null);
    const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const response = await api.post<{ status: string; dispensed_at: string }>(
        `/dispensing/${handoff.dispensing_id}/complete`,
        { idempotency_key: key, items },
        { headers: { 'Idempotency-Key': key } },
      );
      setNotice(response.data.status === 'complete'
        ? 'Full quantity dispensed and recorded.'
        : 'Partial quantity dispensed and recorded. The remaining quantity stays on the prescription.');
      setHandoff(null); setReference(''); setQuantities({});
    } catch (reason) {
      setError(errorMessage(reason, 'Dispensing failed. Inventory and prescription quantities were not changed.'));
    } finally { setBusy(false); }
  }

  if (loading) return <p className="mt-6 text-sm text-ink-soft">Loading verified pharmacy membership...</p>;

  return (
    <div className="ahp-pharmacy-workspace mt-6 max-w-4xl space-y-5">
      {error && <Notice>{error}</Notice>}
      {notice && <p role="status" className="rounded-md border border-teal/30 bg-teal/10 p-3 text-sm text-petrol">{notice}</p>}
      <Card>
        <form onSubmit={verify} className="space-y-4">
          {pharmacies.length > 1 && (
            <Field label="Authorized pharmacy" htmlFor="pharmacy-id">
              <select id="pharmacy-id" required value={pharmacyId} onChange={(event) => setPharmacyId(event.target.value)} className={inputClass}>
                <option value="">Select pharmacy</option>
                {pharmacies.map((pharmacy) => <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>)}
              </select>
            </Field>
          )}
          {pharmacies.length === 1 && <p className="text-sm text-ink-soft">Authorized pharmacy: {pharmacies[0]!.name}</p>}
          <Field label="Secure prescription reference" htmlFor="handoff-reference" hint="The reference is not authorization. Your verified pharmacist account and pharmacy membership are checked by the server.">
            <input id="handoff-reference" required autoComplete="off" spellCheck={false} value={reference}
              onChange={(event) => setReference(event.target.value)} className={inputClass} />
          </Field>
          <Button type="submit" disabled={busy || !pharmacyId || reference.trim().length !== 43}>
            {busy ? 'Verifying...' : 'Verify reference'}
          </Button>
        </form>
      </Card>

      {handoff && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Authorized prescription</h2>
              <p className="mt-1 text-sm">Patient: {handoff.patient_display_name}</p>
              <p className="text-sm text-ink-soft">Prescriber: {handoff.prescribed_by} · Valid until {new Date(handoff.valid_until).toLocaleDateString()}</p>
            </div>
            <span className="rounded bg-paper-sunk px-2 py-1 text-xs">{handoff.pharmacy.name}</span>
          </div>
          <p className="mt-4 rounded border border-amber/30 bg-amber/10 p-3 text-sm">
            On-hand availability can change before dispensing. This workflow does not reserve stock; quantity is confirmed and deducted only when recorded below.
          </p>
          <div className="mt-4 space-y-3">
            {handoff.items.map((item) => {
              const max = Math.min(item.quantity_remaining, item.quantity_on_hand ?? 0);
              return (
                <div key={item.id} className="rounded border border-line p-3">
                  <p className="font-medium">{item.medication_name} · {item.dosage}</p>
                  {item.instructions && <p className="mt-1 text-sm">{item.instructions}</p>}
                  <p className="mt-2 text-sm text-ink-soft">Remaining {item.quantity_remaining} · confirmed on hand {item.quantity_on_hand ?? 'unknown'} · available to dispense now {max}</p>
                  <label className="mt-3 block text-sm font-medium" htmlFor={`quantity-${item.id}`}>Quantity dispensed</label>
                  <input id={`quantity-${item.id}`} type="number" min={0} max={max} value={quantities[item.id] ?? 0}
                    onChange={(event) => setQuantities((value) => ({ ...value, [item.id]: Math.min(max, Math.max(0, Number(event.target.value))) }))}
                    disabled={busy || max < 1} className={`${inputClass} mt-1 max-w-40`} />
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" disabled={busy || !handoff.items.some((item) => (quantities[item.id] ?? 0) > 0)} onClick={() => void dispense()}>
              {busy ? 'Recording...' : 'Record dispensing'}
            </Button>
            <button type="button" disabled={busy} onClick={() => { setHandoff(null); setReference(''); setQuantities({}); }} className="rounded border border-line px-4 py-2 text-sm">Cancel lookup</button>
          </div>
        </Card>
      )}
    </div>
  );
}
