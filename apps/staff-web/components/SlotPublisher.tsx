'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Field, Notice, inputClass } from './ui';

interface Draft { date: string; from: string; to: string; minutes: number }

/**
 * Publishing replaces the whole future schedule, which is why the backend
 * refuses to drop a slot that already has an appointment on it. Saying that
 * here means a clinician does not have to discover it by losing a booking.
 */
export function SlotPublisher() {
  const [draft, setDraft] = useState<Draft>({ date: '', from: '09:00', to: '12:00', minutes: 30 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function build(): { starts_at: string; duration_min: number; modality: string }[] {
    const out = [];
    const start = new Date(`${draft.date}T${draft.from}:00`);
    const end = new Date(`${draft.date}T${draft.to}:00`);
    for (let t = start.getTime(); t + draft.minutes * 60000 <= end.getTime(); t += draft.minutes * 60000) {
      out.push({ starts_at: new Date(t).toISOString(), duration_min: draft.minutes, modality: 'chat' });
    }
    return out;
  }

  const preview = draft.date ? build() : [];

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.put('/clinicians/me/slots', { slots: preview });
      setMessage(`Nafasi ${preview.length} zimetumwa.`);
    } catch (e) {
      setError(errorMessage(e, 'Ratiba haikutumwa. Angalia kuwa hakuna nafasi zinazogongana.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={publish} className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Field label="Tarehe" htmlFor="d">
          <input id="d" type="date" required value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Kuanzia" htmlFor="f">
          <input id="f" type="time" required value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Hadi" htmlFor="t">
          <input id="t" type="time" required value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Urefu (dakika)" htmlFor="m">
          <input id="m" type="number" min={10} max={120} step={5} value={draft.minutes}
            onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })} className={inputClass} />
        </Field>
      </div>

      {preview.length > 0 && (
        <p className="text-sm text-ink-soft">
          Itatengeneza nafasi {preview.length} za dakika {draft.minutes} kila moja.
        </p>
      )}

      {message && <p className="text-sm text-petrol">{message}</p>}
      {error && <Notice>{error}</Notice>}

      <Button type="submit" disabled={busy || preview.length === 0} className="self-start">
        {busy ? 'Inatuma...' : 'Tuma ratiba'}
      </Button>
    </form>
  );
}
