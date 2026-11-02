"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  errorMessage,
  idem,
  type DigitalReferral,
  type Page,
} from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Button, Notice } from "./ui";
import s from "./network.module.css";
import { mergeMessages } from '@/lib/messageOrder';
interface Message {
  id: string;
  author_name: string | null;
  body: string;
  created_at: string;
}
export function ReferralConversation({
  referral,
}: {
  referral: DigitalReferral;
}) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false);
  const request = useRef<{
    body: string;
    id: string;
    config: ReturnType<typeof idem>;
  } | null>(null);
  const readable =
      !["draft", "cancelled", "expired"].includes(referral.status) &&
      !!referral.clinical_summary,
    writable = ["submitted", "received", "accepted", "in_care"].includes(
      referral.status,
    );
  useEffect(() => {
    if (!readable) {
      setMessages([]);
      setLoaded(false);
      setOpen(false);
    }
  }, [readable]);
  async function load(more = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<Page<Message>>(
        `/referrals/${referral.id}/messages`,
        { params: { limit: 50, ...(more && cursor ? { cursor } : {}) } },
      );
      setMessages((p) => mergeMessages(more ? p : [], r.data.data));
      setCursor(r.data.meta?.next_cursor ?? null);
      setLoaded(true);
    } catch (e) {
      setMessages([]);
      setLoaded(false);
      setError(
        errorMessage(
          e,
          "Handoff unavailable. Refresh the referral to check patient authorization.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const text = body.trim();
    if (request.current?.body !== text)
      request.current = { body: text, id: crypto.randomUUID(), config: idem() };
    try {
      const r = await api.post<Message>(
        `/referrals/${referral.id}/messages`,
        { body: text, client_message_id: request.current.id },
        request.current.config,
      );
      setMessages((p) => mergeMessages(p, [r.data]));
      setBody("");
      request.current = null;
    } catch (e) {
      setMessages([]);
      setLoaded(false);
      setError(
        errorMessage(
          e,
          "Message could not be sent. Check authorization or retry.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!readable)
    return (
      <p className="text-sm text-ink-soft">
        Handoff messages become available after submission while patient
        authorization is active.
      </p>
    );
  return (
    <details
      open={open}
      className={`${s.workspace} ${s.conversation}`}
      onToggle={(e) => {
        const value = e.currentTarget.open;
        setOpen(value);
        if (value && !loaded && !busy) void load();
      }}
    >
      <summary>Secure clinician handoff</summary>
      <p className={s.muted}>
        Visible to the referring clinician and authorized destination
        clinicians. Share only information needed for this referral.
      </p>
      {error && <Notice>{error}</Notice>}
      <Button variant="quiet" disabled={busy} onClick={() => void load()}>
        Refresh messages
      </Button>
      {busy && !loaded ? (
        <p role="status">Loading messages…</p>
      ) : loaded && !messages.length ? (
        <p className={s.empty}>No handoff messages yet.</p>
      ) : (
        <ul>
          {messages.map((m) => (
            <li key={m.id}>
              <strong>{m.author_name ?? "Clinician"}</strong>
              <p className={s.muted}>{dateTime(m.created_at)}</p>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button variant="quiet" disabled={busy} onClick={() => void load(true)}>
          Load more messages
        </Button>
      )}
      {writable ? (
        <form onSubmit={send}>
          <label htmlFor={`handoff-${referral.id}`}>
            Message to the referral team
          </label>
          <textarea
            id={`handoff-${referral.id}`}
            rows={3}
            required
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy ? "Sending…" : "Send handoff message"}
          </Button>
        </form>
      ) : (
        <p className={s.muted}>
          This referral is closed. The conversation is read-only.
        </p>
      )}
    </details>
  );
}
