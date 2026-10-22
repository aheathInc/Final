'use client';

import { useState } from 'react';
import { api, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

const SPECIALTIES = [
  'general_practice', 'paediatrics', 'obstetrics_gynaecology', 'internal_medicine',
  'cardiology', 'dermatology', 'psychiatry', 'oncology', 'surgery',
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
      setError('The opinion request was not sent. Try again.');
    } finally { setBusy(false); }
  }

  if (done) return <p className="text-sm text-ink-soft">Opinion request sent. A specialist can answer when available.</p>;
  if (!open) return <Button variant="quiet" onClick={() => setOpen(true)}>Request second opinion</Button>;

  return (
    <form onSubmit={submit} className="w-full rounded-lg border border-line bg-white p-4 shadow-sm">
      <p className="text-sm font-medium">Request a specialist opinion</p>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Specialty" htmlFor="sp">
          <select id="sp" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className={inputClass}>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="Question" htmlFor="q">
          <textarea id="q" required rows={3} value={question}
            onChange={(e) => setQuestion(e.target.value)} className={areaClass} />
        </Field>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-3">
          <Button type="submit" disabled={busy || !question.trim()}>Send request</Button>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </form>
  );
}
