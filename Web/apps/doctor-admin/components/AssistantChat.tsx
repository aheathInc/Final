'use client';

import { useState } from 'react';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Notice, inputClass } from './ui';

interface Turn { role: 'me' | 'assistant'; text: string }

export function AssistantChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setBusy(true); setError(null); setDraft('');
    setTurns((t) => [...t, { role: 'me', text }]);

    try {
      let id = conversationId;
      if (!id) {
        const res = await api.post<{ id: string }>('/ai/conversations',
          { audience: 'clinician', language: 'sw' }, idem());
        id = res.data.id;
        setConversationId(id);
      }
      const res = await api.post<{ text: string }>(`/ai/conversations/${id}/messages`, { body: text }, idem());
      setTurns((t) => [...t, { role: 'assistant', text: res.data.text }]);
    } catch (e) {
      setError(errorMessage(e, 'Msaidizi hakupatikana. Jaribu tena.'));
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Uliza swali</h2>

      {turns.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3 border border-line bg-white p-4">
          {turns.map((t, i) => (
            <li key={i} className={t.role === 'me' ? 'text-right' : 'text-left'}>
              <div className={`inline-block max-w-[85%] whitespace-pre-wrap px-3 py-2 text-left text-[0.95rem] ${
                t.role === 'me' ? 'bg-petrol text-white' : 'bg-paper-sunk'
              }`}>
                {t.text}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-2"><Notice>{error}</Notice></div>}

      <form onSubmit={send} className="mt-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="Andika swali lako..." className={inputClass} />
        <Button type="submit" disabled={busy || !draft.trim()}>Tuma</Button>
      </form>
    </section>
  );
}
