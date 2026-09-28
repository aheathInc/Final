'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, type ResearchDataset, type ResearchQuery } from '@/lib/api';
import { Button, Field, Notice, inputClass } from './ui';

/**
 * Only the fields the backend actually allows grouping by. This is not a
 * convenience list — the allow-list is what makes the dataset safe, and
 * offering a free-text field would invite queries the server will reject
 * while suggesting the boundary is negotiable.
 */
const GROUP_FIELDS = [
  { value: 'urgencyLevel', label: 'Kiwango cha uharaka' },
  { value: 'channel', label: 'Njia ya kufika' },
  { value: 'status', label: 'Hali ya kesi' },
];

export function QueryForm({ dataset }: { dataset: ResearchDataset }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ethicsRef, setEthicsRef] = useState('');
  const [groupBy, setGroupBy] = useState<string[]>(['urgencyLevel']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(field: string) {
    setGroupBy((g) => (g.includes(field) ? g.filter((f) => f !== field) : [...g, field]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post<ResearchQuery>('/research/queries', {
        dataset_id: dataset.id,
        ethics_approval_ref: ethicsRef,
        query: { measure: 'count', group_by: groupBy },
      });
      router.push(`/research/${res.data.id}`);
    } catch (e) {
      setError(errorMessage(e, 'Ombi halikukubaliwa.'));
      setBusy(false);
    }
  }

  if (!open) {
    return <div className="mt-4"><Button variant="quiet" onClick={() => setOpen(true)}>Uliza swali</Button></div>;
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      {dataset.requires_ethics_approval && (
        <Field label="Kumbukumbu ya kibali cha maadili" htmlFor={`e-${dataset.id}`}
          hint="Inaandikwa kwenye kumbukumbu pamoja na swali lako.">
          <input id={`e-${dataset.id}`} required value={ethicsRef}
            onChange={(e) => setEthicsRef(e.target.value)} className={inputClass} />
        </Field>
      )}

      <fieldset>
        <legend className="text-sm font-medium">Kusanya kwa</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {GROUP_FIELDS.map((f) => (
            <label key={f.value} className="flex items-center gap-2 text-[0.95rem]">
              <input type="checkbox" checked={groupBy.includes(f.value)}
                onChange={() => toggle(f.value)} className="h-4 w-4" />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <Notice>{error}</Notice>}

      <div className="flex gap-3">
        <Button type="submit" disabled={busy || groupBy.length === 0}>
          {busy ? 'Inatuma...' : 'Endesha'}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Ghairi</Button>
      </div>
    </form>
  );
}
