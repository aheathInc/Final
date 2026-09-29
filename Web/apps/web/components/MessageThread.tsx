'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, idem, type Message, type Page } from '@/lib/api';
import { time } from '@/lib/format';
import { Button, Notice, inputClass } from './ui';

const POLL_MS = 8000;

export function MessageThread({
  careThreadId,
  meId,
  initialMessages = [],
}: {
  careThreadId: string;
  meId: string;
  initialMessages?: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Page<Message>>(`/care-threads/${careThreadId}/messages`, {
        params: { limit: 100 },
      });
      setMessages(res.data?.data ?? []);
      setError(null);
    } catch {
      setError('The conversation could not be loaded.');
    }
  }, [careThreadId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setDraft('');
    try {
      const res = await api.post<Message>(
        `/care-threads/${careThreadId}/messages`,
        { body, client_created_at: new Date().toISOString() },
        idem(),
      );
      setMessages((m) => [...m, res.data]);
    } catch {
      // Put the text back rather than losing it. Retyping a message you
      // already wrote is a small thing that feels like a large one.
      setDraft(body);
      setError('Message not sent. Your text is still here; try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Conversation</h2>

      <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-line bg-white p-4 shadow-sm">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-soft">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => {
              const mine = m.sender_user_id === meId;
              return (
                <li key={m.id} className={mine ? 'text-right' : 'text-left'}>
                  <div className={`inline-block max-w-[85%] px-3 py-2 text-left text-[0.95rem] ${
                    mine ? 'rounded-l-lg rounded-tr-lg bg-petrol text-white' : 'rounded-r-lg rounded-tl-lg bg-paper-sunk'
                  }`}>
                    {m.body}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {time(m.created_at)}{mine && m.read_at ? ' · read' : ''}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {error && <div className="mt-2"><Notice>{error}</Notice></div>}

      <form onSubmit={send} className="mt-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message..." className={inputClass} />
        <Button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending...' : 'Send'}</Button>
      </form>
    </section>
  );
}
