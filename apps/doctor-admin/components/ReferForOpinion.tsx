'use client';

import { useState } from 'react';
import { api, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

const SPECIALTIES = [
  'general_practice', 'paediatrics', 'obstetrics_gynaecology', 'internal_medicine',
  'dermatology', 'psychiatry', 'oncology', 'surgery', 'other',
];

/**
 * Store-and-forward by design: the specialist answers when able, and nothing
 * requires both clinicians online at once. That requirement is exactly what
 * makes specialist access fail outside the cities.
 */
export function ReferForOpinion({ careThreadId }: { careThreadId: string }) {
  const [open, setOpen] = useState(false);
  const [specialty, setSpecialty] = useState(SPECIALTIES[1]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/network/second-opinions', { care_thread_id: careThreadId, specialty, question }, idem());
      setDone(true); setOpen(false);
    } catch {
      setError('Ombi halikutumwa. Jaribu tena.');
    } finally { setBusy(false); }
  }

  if (done) return <p className="text-sm text-ink-soft">Ombi limetumwa. Mtaalamu atajibu atakapoweza.</p>;
  if (!open) return <Button variant="quiet" onClick={() => setOpen(true)}>Omba maoni ya pili</Button>;

  return (
    <form onSubmit={submit} className="w-full border border-line bg-white p-4">
      <p className="text-sm font-medium">Omba maoni ya mtaalamu</p>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Utaalamu" htmlFor="sp">
          <select id="sp" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className={inputClass}>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="Swali lako" htmlFor="q">
          <textarea id="q" required rows={3} value={question}
            onChange={(e) => setQuestion(e.target.value)} className={areaClass} />
        </Field>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-3">
          <Button type="submit" disabled={busy || !question.trim()}>Tuma ombi</Button>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Ghairi</Button>
        </div>
      </div>
    </form>
  );
}
