'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

interface Community { id: string; name: string; specialty: string }

export function NewDiscussion({ communities }: { communities: Community[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (communities.length === 0) {
    return <p className="mt-4 text-sm text-ink-soft">Hakuna jamii iliyoanzishwa bado.</p>;
  }

  if (!open) {
    return <div className="mt-4"><Button onClick={() => setOpen(true)}>Anzisha majadiliano</Button></div>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/network/discussions', { community_id: communityId, title, body }, idem());
      setOpen(false); setTitle(''); setBody('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Majadiliano hayakuanzishwa.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border border-line bg-white p-4">
      <Field label="Jamii" htmlFor="c">
        <select id="c" value={communityId} onChange={(e) => setCommunityId(e.target.value)} className={inputClass}>
          {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Kichwa" htmlFor="t">
        <input id="t" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Maelezo" htmlFor="b"
        hint="Usiandike jina la mgonjwa wala kitu kinachoweza kumtambulisha.">
        <textarea id="b" required rows={4} value={body}
          onChange={(e) => setBody(e.target.value)} className={areaClass} />
      </Field>
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !title.trim() || !body.trim()}>Chapisha</Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Ghairi</Button>
      </div>
    </form>
  );
}
