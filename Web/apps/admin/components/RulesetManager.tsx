'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Card, Field, Notice, areaClass, inputClass } from './ui';
import { dateTime } from '@/lib/format';

interface Ruleset {
  id: string;
  label: string;
  status: 'draft' | 'active' | 'retired';
  rules: Record<string, unknown>;
  sla_seconds: { emergency: number; urgent: number; routine: number };
  notes: string | null;
  activated_at: string | null;
  created_at: string;
}

interface Check { name: string; expected: string; got: string; passed: boolean }

const MINUTES = (s: number) => (s % 60 === 0 ? `${s / 60} dak` : `${s}s`);

export function RulesetManager({ rulesets }: { rulesets: Ruleset[] }) {
  const router = useRouter();
  const active = rulesets.find((r) => r.status === 'active');

  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [sla, setSla] = useState({ emergency: 180, urgent: 900, routine: 7200 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checks, setChecks] = useState<{ label: string; results: Check[]; allPassed: boolean } | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  function startFrom(source: Ruleset) {
    setRulesText(JSON.stringify(source.rules, null, 2));
    setSla(source.sla_seconds);
    setLabel('');
    setCreating(true);
    setError(null);
  }

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    let rules: unknown;
    try {
      rules = JSON.parse(rulesText);
    } catch {
      setError('Sheria si JSON sahihi. Angalia mabano na koma.');
      setBusy(false);
      return;
    }
    try {
      await api.post('/triage-rulesets', { label, rules, sla_seconds: sla }, idem());
      setCreating(false); setLabel(''); setRulesText('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Rasimu haikuundwa.'));
    } finally { setBusy(false); }
  }

  async function preview(l: string) {
    setBusy(true); setError(null); setChecks(null);
    try {
      const res = await api.post<{ safety_checks: Check[]; all_passed: boolean }>(
        `/triage-rulesets/${l}/preview`, {});
      setChecks({ label: l, results: res.data.safety_checks, allPassed: res.data.all_passed });
    } catch (e) {
      setError(errorMessage(e, 'Ukaguzi haukufanikiwa.'));
    } finally { setBusy(false); }
  }

  async function activate(l: string) {
    setBusy(true); setError(null);
    try {
      await api.post(`/triage-rulesets/${l}/activate`, { notes }, idem());
      setActivating(null); setNotes('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Haikuwezeshwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {/*
        Stated once, plainly, where the decisions are made. An administrator
        who does not know the floor exists might think this screen is more
        dangerous than it is — or, worse, less.
      */}
      <Notice tone="attention">
        Dalili za kiharusi, maumivu ya kifua, kuvuja damu kwingi, kupoteza fahamu na
        mawazo ya kujiua ni dharura daima — hilo limeandikwa ndani ya mfumo na
        haliwezi kubadilishwa hapa. Toleo linaloshusha mojawapo litakataliwa.
      </Notice>

      {error && <Notice>{error}</Notice>}

      {checks && (
        <Card accent={checks.allPassed ? 'border-l-4 border-petrol' : 'border-l-4 border-clay'}>
          <p className="font-medium">
            Ukaguzi wa {checks.label}: {checks.results.filter((c) => c.passed).length} kati ya {checks.results.length} zimepita
          </p>
          {!checks.allPassed && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-clay">
              {checks.results.filter((c) => !c.passed).map((c) => (
                <li key={c.name}>{c.name} → {c.got} (inatakiwa dharura)</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!creating ? (
        <div>
          <Button onClick={() => (active ? startFrom(active) : setCreating(true))}>
            Tengeneza toleo jipya
          </Button>
          {active && (
            <p className="mt-2 text-sm text-ink-soft">
              Litaanzia na sheria za toleo linalotumika sasa ({active.label}).
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={createDraft} className="flex flex-col gap-4 border border-line bg-white p-4">
          <Field label="Jina la toleo" htmlFor="lbl" hint="Mfano: 2026.09.1. Litahifadhiwa kwenye kila kesi.">
            <input id="lbl" required value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
          </Field>

          <div>
            <p className="text-sm font-medium">Muda wa kujibu</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {(['emergency', 'urgent', 'routine'] as const).map((k) => (
                <Field key={k} label={k === 'emergency' ? 'Dharura' : k === 'urgent' ? 'Haraka' : 'Kawaida'} htmlFor={k}>
                  <input id={k} type="number" min={60} value={sla[k]}
                    onChange={(e) => setSla({ ...sla, [k]: Number(e.target.value) })}
                    className={`${inputClass} w-32`} />
                </Field>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Kwa sekunde. Dharura lazima iwe fupi kuliko haraka, na haraka fupi kuliko kawaida.
            </p>
          </div>

          <Field label="Sheria" htmlFor="rules"
            hint="JSON. Ni rahisi kuanzia na toleo lililopo kisha kubadilisha kidogo kuliko kuandika upya.">
            <textarea id="rules" required rows={16} value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              className={`${areaClass} font-mono text-xs`} />
          </Field>

          <div className="flex gap-3">
            <Button type="submit" disabled={busy || !label.trim()}>Hifadhi rasimu</Button>
            <Button type="button" variant="quiet" onClick={() => setCreating(false)}>Ghairi</Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {rulesets.map((r) => (
          <Card key={r.id}
            accent={r.status === 'active' ? 'border-l-4 border-petrol' : undefined}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-medium">{r.label}</span>
              <span className={`text-sm ${r.status === 'active' ? 'text-petrol' : 'text-ink-soft'}`}>
                {r.status === 'active' ? 'Inatumika' : r.status === 'draft' ? 'Rasimu' : 'Imestaafu'}
              </span>
            </div>
            <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">
              dharura {MINUTES(r.sla_seconds.emergency)} · haraka {MINUTES(r.sla_seconds.urgent)} · kawaida {MINUTES(r.sla_seconds.routine)}
            </p>
            {r.notes && <p className="mt-2 text-[0.95rem]">{r.notes}</p>}
            <p className="mt-1 text-xs text-ink-soft">
              {r.status === 'active' && r.activated_at
                ? `Ilianza kutumika ${dateTime(r.activated_at)}`
                : `Iliundwa ${dateTime(r.created_at)}`}
            </p>

            {r.status !== 'retired' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <Button variant="quiet" onClick={() => preview(r.label)} disabled={busy}>
                  Kagua usalama
                </Button>
                {r.status === 'draft' && activating !== r.label && (
                  <Button variant="quiet" onClick={() => { setActivating(r.label); setNotes(''); }}>
                    Anza kutumia
                  </Button>
                )}
                {r.status !== 'draft' && r.status !== 'active' && null}
              </div>
            )}

            {activating === r.label && (
              <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                {/*
                  Required by the API too. Asked for here rather than after a
                  rejection, so the reason is written while it is still in mind.
                */}
                <Field label="Kwa nini unabadilisha?" htmlFor={`n-${r.id}`}
                  hint="Inahifadhiwa kwenye kumbukumbu pamoja na toleo hili.">
                  <textarea id={`n-${r.id}`} rows={2} value={notes}
                    onChange={(e) => setNotes(e.target.value)} className={areaClass} />
                </Field>
                <div className="flex gap-3">
                  <Button onClick={() => activate(r.label)} disabled={busy || !notes.trim()}>
                    Thibitisha
                  </Button>
                  <Button variant="quiet" onClick={() => setActivating(null)}>Ghairi</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
