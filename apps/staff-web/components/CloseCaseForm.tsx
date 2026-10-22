'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

interface Item {
  medication_name: string; dosage: string;
  frequency_per_day: number; duration_days: number; instructions: string; quantity_prescribed: number | '';
}
const EMPTY: Item = { medication_name: '', dosage: '', frequency_per_day: 2, duration_days: 5, instructions: '', quantity_prescribed: '' };

/**
 * One form, one submit. The backend writes the note, the prescription and the
 * follow-up schedule in a single transaction, so offering three separate saves
 * would let a clinician leave a signed note with no prescription attached —
 * a record that reads as complete while the patient has nothing to collect.
 */
export function CloseCaseForm({ consultationId }: { consultationId: string }) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState('');
  const [advice, setAdvice] = useState('');
  const [redFlags, setRedFlags] = useState('');
  const [prescribing, setPrescribing] = useState(false);
  const [items, setItems] = useState<Item[]>([{ ...EMPTY }]);
  const [validUntil, setValidUntil] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'twice_daily' | 'weekly'>('daily');
  const [days, setDays] = useState(7);
  const [closeThread, setCloseThread] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Item>) =>
    setItems((l) => l.map((it, x) => (x === i ? { ...it, ...p } : it)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const usable = items.filter((i) => i.medication_name.trim() && i.dosage.trim());
    if (prescribing && usable.length === 0) {
      setError('Umechagua kuandika dawa lakini hujajaza dawa yoyote.');
      return;
    }
    if (prescribing && (!validUntil || usable.some((item) => item.quantity_prescribed === '' || item.quantity_prescribed < 1))) {
      setError('Weka kiasi halisi cha kila dawa na tarehe ya mwisho iliyoamuliwa kitabibu. Mfumo hautakisia kiasi au muda wa uhalali.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/consultations/${consultationId}/complete`, {
        note: {
          diagnosis_text: diagnosis,
          advice_text: advice,
          red_flags_discussed: redFlags.split('\n').map((s) => s.trim()).filter(Boolean),
        },
        ...(prescribing ? { prescription: { items: usable, valid_until: validUntil } } : {}),
        ...(scheduling ? { follow_up_cycle: { frequency, duration_days: days } } : {}),
        close_care_thread: closeThread,
      }, idem());
      router.push(prescribing ? '/doctor/follow-up/medication-times' : scheduling ? '/doctor/follow-up' : '/doctor/queue');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Kesi haikufungwa. Hakuna kilichohifadhiwa — jaribu tena.'));
    } finally { setBusy(false); }
  }

  const legend = 'text-sm font-semibold uppercase tracking-wide text-ink-soft';

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-8">
      <fieldset className="flex flex-col gap-4">
        <legend className={legend}>Maelezo ya matibabu</legend>
        <Field label="Utambuzi" htmlFor="dx">
          <textarea id="dx" required rows={3} value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)} className={areaClass} />
        </Field>
        <Field label="Ushauri kwa mgonjwa" htmlFor="adv">
          <textarea id="adv" required rows={3} value={advice}
            onChange={(e) => setAdvice(e.target.value)} className={areaClass} />
        </Field>
        {/*
          Not an optional extra. These are the signs that tell a patient at
          home when to stop waiting and seek help — the difference between a
          safe discharge and a late presentation.
        */}
        <Field label="Dalili za hatari alizoelezwa" htmlFor="rf"
          hint="Moja kwa kila mstari. Hizi ndizo zitakazomwambia lini arudi haraka.">
          <textarea id="rf" rows={3} value={redFlags} onChange={(e) => setRedFlags(e.target.value)}
            placeholder={'Homa inayozidi\nKutapika damu'} className={areaClass} />
        </Field>
      </fieldset>

      <fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prescribing}
            onChange={(e) => setPrescribing(e.target.checked)} className="h-4 w-4" />
          <span className={legend}>Andika dawa</span>
        </label>
        {prescribing && (
          <div className="mt-3 flex flex-col gap-4">
            <Field label="Prescription valid through" htmlFor="prescription-valid-until" hint="Choose the date based on clinical judgment; no default period is assumed.">
              <input id="prescription-valid-until" type="date" required value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
            </Field>
            {items.map((it, i) => (
              <div key={i} className="border border-line bg-white p-3">
                <input value={it.medication_name} onChange={(e) => patch(i, { medication_name: e.target.value })}
                  placeholder="Jina la dawa" className={inputClass} />
                <div className="mt-2 flex gap-2">
                  <input value={it.dosage} onChange={(e) => patch(i, { dosage: e.target.value })}
                    placeholder="Kipimo (500mg)" className={`${inputClass} flex-1`} />
                  <input type="number" min={1} max={12} value={it.frequency_per_day}
                    onChange={(e) => patch(i, { frequency_per_day: Number(e.target.value) })}
                    aria-label="Mara kwa siku" className={`${inputClass} w-24`} />
                  <input type="number" min={1} max={365} value={it.duration_days}
                    onChange={(e) => patch(i, { duration_days: Number(e.target.value) })}
                    aria-label="Idadi ya siku" className={`${inputClass} w-24`} />
                </div>
                <Field label="Quantity prescribed (units as written)" htmlFor={`quantity-prescribed-${i}`} hint="Enter the clinician-selected dispensing unit quantity; the platform does not infer it from frequency.">
                  <input id={`quantity-prescribed-${i}`} type="number" min={1} max={100000} required
                    value={it.quantity_prescribed}
                    onChange={(e) => patch(i, { quantity_prescribed: e.target.value ? Number(e.target.value) : '' })}
                    className={`${inputClass} mt-1 max-w-56`} />
                </Field>
                <input value={it.instructions} onChange={(e) => patch(i, { instructions: e.target.value })}
                  placeholder="Maelekezo (baada ya chakula)" className={`${inputClass} mt-2`} />
                {/* Frequency alone is not consent to an inferred clock-time reminder. */}
                <p className="mt-2 text-xs text-ink-soft">
                  Mara {it.frequency_per_day} kwa siku kwa siku {it.duration_days} — jumla ya
                  dozi zilizopangwa {it.frequency_per_day * it.duration_days}. Weka muda wa vikumbusho
                  uliokubaliwa na mgonjwa kwenye Follow-up baada ya kusaini.
                </p>
              </div>
            ))}
            <button type="button" onClick={() => setItems((l) => [...l, { ...EMPTY }])}
              className="self-start text-sm text-petrol underline underline-offset-4">
              Ongeza dawa nyingine
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scheduling}
            onChange={(e) => setScheduling(e.target.checked)} className="h-4 w-4" />
          <span className={legend}>Panga ufuatiliaji</span>
        </label>
        {scheduling && (
          <div className="mt-3 flex gap-2">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              aria-label="Mara ngapi" className={`${inputClass} flex-1`}>
              <option value="daily">Kila siku</option>
              <option value="twice_daily">Mara mbili kwa siku</option>
              <option value="weekly">Kila wiki</option>
            </select>
            <input type="number" min={1} max={365} value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Kwa siku ngapi" className={`${inputClass} w-28`} />
          </div>
        )}
      </fieldset>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={closeThread}
          onChange={(e) => setCloseThread(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>
          <span className="text-sm font-medium">Funga tatizo hili kabisa</span>
          <span className="block text-xs text-ink-soft">
            Chagua hii tu kama tatizo limeisha. Bila hii, mgonjwa anaweza kuendelea
            kuwasiliana nawe kuhusu tatizo hili hili.
          </span>
        </span>
      </label>

      {error && <Notice>{error}</Notice>}

      <Button type="submit" disabled={busy || !diagnosis.trim() || !advice.trim()} className="self-start">
        {busy ? 'Inahifadhi...' : 'Hifadhi na funga kesi'}
      </Button>
    </form>
  );
}
