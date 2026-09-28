'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Notice, areaClass } from './ui';

export function ReplyForm({ discussionId }: { discussionId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/network/discussions/${discussionId}/replies`, { body }, idem());
      setBody('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Jibu halikutumwa.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
      <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="Andika jibu lako..." className={areaClass} />
      {error && <Notice>{error}</Notice>}
      <Button type="submit" disabled={busy || !body.trim()} className="self-start">Jibu</Button>
    </form>
  );
}
