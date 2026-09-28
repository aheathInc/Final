'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Field, Notice, areaClass } from './ui';

interface Interaction { pair: string[]; severity: string; description: string }

/**
 * Checked before prescribing, not after. The list is only as complete as the
 * data behind it, so an empty result is reported as "none found in the
 * dataset" rather than as a clean bill — the difference matters when someone
 * is about to act on it.
 */
export function DrugInteractions() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Interaction[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const medications = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (medications.length < 2) {
      setError('Andika angalau dawa mbili ili kulinganisha.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ interactions: Interaction[] }>('/ai/drug-interactions', { medications });
      setResult(res.data.interactions ?? []);
    } catch (e) {
      setError(errorMessage(e, 'Ukaguzi haukufanikiwa.'));
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Mwingiliano wa dawa</h2>

      <form onSubmit={check} className="mt-3 flex flex-col gap-3">
        <Field label="Dawa" htmlFor="meds" hint="Moja kwa kila mstari.">
          <textarea id="meds" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Warfarin\nAspirin'} className={areaClass} />
        </Field>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" disabled={busy} className="self-start">
          {busy ? 'Inakagua...' : 'Kagua'}
        </Button>
      </form>

      {result !== null && (
        result.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">
            Hakuna mwingiliano uliopatikana kwenye data iliyopo. Hii si uhakikisho kamili —
            tegemea pia uzoefu wako.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {result.map((i, n) => (
              <li key={n} className="border-l-4 border-amber bg-paper-sunk py-3 pl-4">
                <p className="font-medium text-amber">{i.pair.join(' + ')} — {i.severity}</p>
                <p className="mt-1 text-[0.95rem]">{i.description}</p>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
