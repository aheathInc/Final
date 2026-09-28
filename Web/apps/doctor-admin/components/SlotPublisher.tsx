'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, Field, Notice, inputClass } from './ui';

interface Draft { date: string; from: string; to: string; minutes: number; modality: 'chat' | 'voice' | 'video' | 'async' }

/**
 * Publishing replaces the whole future schedule, which is why the backend
 * refuses to drop a slot that already has an appointment on it. Saying that
 * here means a clinician does not have to discover it by losing a booking.
 */
export function SlotPublisher() {
  const [draft, setDraft] = useState<Draft>({ date: '', from: '09:00', to: '12:00', minutes: 30, modality: 'chat' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function build(): { starts_at: string; duration_minutes: number; modality: string }[] {
    const out = [];
    const start = new Date(`${draft.date}T${draft.from}:00`);
    const end = new Date(`${draft.date}T${draft.to}:00`);
    for (let t = start.getTime(); t + draft.minutes * 60000 <= end.getTime(); t += draft.minutes * 60000) {
      out.push({ starts_at: new Date(t).toISOString(), duration_minutes: draft.minutes, modality: draft.modality });
    }
    return out;
  }

  const preview = draft.date ? build() : [];

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.put('/clinicians/me/slots', {
        from: draft.date,
        to: draft.date,
        slots: preview,
      });
      setMessage(`Nafasi ${preview.length} zimetumwa.`);
    } catch (e) {
      setError(errorMessage(e, 'Ratiba haikutumwa. Angalia kuwa hakuna nafasi zinazogongana.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={publish} className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
      <Card className="border-0">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#789087]">Tengeneza muda</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">Ongeza upatikanaji</h2>
            <p className="mt-1 text-sm text-ink-soft">Chagua dirisha moja la kazi. Nafasi zilizowekewa miadi zitalindwa.</p>
          </div>
          <span className="rounded-full bg-[#e2eee7] px-3 py-1 text-xs font-semibold text-petrol">Hatua 1 / 1</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tarehe ya kazi" htmlFor="d">
            <input id="d" type="date" required value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Aina ya mawasiliano" htmlFor="modality">
            <select id="modality" value={draft.modality}
              onChange={(e) => setDraft({ ...draft, modality: e.target.value as Draft['modality'] })} className={inputClass}>
              <option value="chat">Mazungumzo</option>
              <option value="voice">Simu</option>
              <option value="video">Video</option>
              <option value="async">Ujumbe wa baadaye</option>
            </select>
          </Field>
          <Field label="Kuanzia" htmlFor="f">
            <input id="f" type="time" required value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Hadi" htmlFor="t">
            <input id="t" type="time" required value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Muda wa kila miadi" hint="Dakika 5 hadi 120" htmlFor="m">
            <input id="m" type="number" min={5} max={120} step={5} value={draft.minutes}
              onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })} className={inputClass} />
          </Field>
        </div>

        <div className="mt-6 rounded-xl border border-[#ead9b9] bg-[#fffaf0] px-4 py-3 text-sm text-[#805b18]">
          <strong>Inavyofanya kazi:</strong> kuchapisha hubadilisha nafasi ambazo bado hazijawekewa miadi ndani ya tarehe hii. Miadi iliyopo haitaguswa.
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || preview.length === 0}>
            {busy ? 'Inachapisha...' : 'Chapisha ratiba'}
          </Button>
          {message && <p className="text-sm font-medium text-petrol">{message}</p>}
        </div>
        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
      </Card>

      <Card className="border-0 bg-[#143f38] text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a9d5c1]">Muhtasari wa ratiba</p>
            <h2 className="mt-1 text-lg font-semibold">Nafasi zitakazopatikana</h2>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[#d5eee2]">Preview</span>
        </div>
        <div className="mt-7 flex items-end gap-3">
          <span className="font-mono text-5xl font-medium tracking-tight">{preview.length || '—'}</span>
          <span className="mb-2 text-sm text-[#c2dfd2]">nafasi za dakika {draft.minutes}</span>
        </div>
        <div className="mt-7 space-y-2">
          {preview.slice(0, 5).map((slot) => (
            <div key={slot.starts_at} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-sm">
              <span>{new Date(slot.starts_at).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-[#b9ddcc]">{draft.modality === 'chat' ? 'Mazungumzo' : draft.modality === 'voice' ? 'Simu' : draft.modality === 'video' ? 'Video' : 'Ujumbe'}</span>
            </div>
          ))}
          {preview.length > 5 && <p className="pt-1 text-xs text-[#a9d5c1]">+ nafasi {preview.length - 5} zaidi</p>}
          {!draft.date && <p className="rounded-xl border border-dashed border-white/20 px-3 py-5 text-center text-sm text-[#b9ddcc]">Chagua tarehe kuona preview ya ratiba.</p>}
        </div>
      </Card>
    </form>
  );
}
