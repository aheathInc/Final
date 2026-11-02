"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, errorMessage, idem, type Discussion, type Page } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Button, Notice, PageHeader, PageShell } from "./ui";
import s from "./network.module.css";
import { mergeMessages } from '@/lib/messageOrder';
interface Reply {
  id: string;
  body: string;
  author_name: string;
  author_clinician_id: string;
  parent_reply_id: string | null;
  created_at: string;
}
type Detail = Discussion & {
  community_name: string;
  replies: Reply[];
  replies_meta: Page<Reply>["meta"];
};
export function DiscussionThread({ discussionId }: { discussionId: string }) {
  const [discussion, setDiscussion] = useState<Detail | null>(null),
    [replies, setReplies] = useState<Reply[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [target, setTarget] = useState<Reply | null>(null),
    [body, setBody] = useState(""),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null),
    request = useRef<{
      signature: string;
      config: ReturnType<typeof idem>;
    } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<Detail>(`/network/discussions/${discussionId}`);
      setDiscussion(r.data);
      setReplies(mergeMessages([], r.data.replies));
      setCursor(r.data.replies_meta?.next_cursor ?? null);
    } catch (e) {
      setDiscussion(null);
      setReplies([]);
      setError(
        errorMessage(
          e,
          "Discussion unavailable. Check your group membership and refresh.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [discussionId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = {
        body: body.trim(),
        ...(target ? { parent_reply_id: target.id } : {}),
      },
      signature = JSON.stringify(data);
    if (request.current?.signature !== signature)
      request.current = { signature, config: idem() };
    try {
      const r = await api.post<Reply>(
        `/network/discussions/${discussionId}/replies`,
        data,
        request.current.config,
      );
      setReplies((p) => mergeMessages(p, [r.data]));
      setDiscussion((p) => (p ? { ...p, reply_count: p.reply_count + 1 } : p));
      setBody("");
      setTarget(null);
      request.current = null;
      setNotice("Reply posted to this discussion.");
    } catch (e) {
      setError(
        errorMessage(e, "Reply could not be posted. Your draft is still here."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    try {
      const r = await api.get<Page<Reply>>(
        `/network/discussions/${discussionId}/replies`,
        { params: { cursor, limit: 50 } },
      );
      setReplies((p) => mergeMessages(p, r.data.data));
      setCursor(r.data.meta?.next_cursor ?? null);
    } catch (e) {
      setError(errorMessage(e, "More replies could not load. Try again."));
    } finally {
      setBusy(false);
    }
  }
  function choose(r: Reply | null) {
    setTarget(r);
    input.current?.focus();
  }
  const byId = new Map(replies.map((r) => [r.id, r]));
  function render(r: Reply, depth = 0): React.ReactNode {
    const children = replies.filter((x) => x.parent_reply_id === r.id),
      parent = r.parent_reply_id ? byId.get(r.parent_reply_id) : null;
    return (
      <li className={s.reply} key={r.id} id={`reply-${r.id}`}>
        <article>
          <header>
            <strong>{r.author_name || "Clinician"}</strong>
            <time dateTime={r.created_at}>{dateTime(r.created_at)}</time>
          </header>
          {r.parent_reply_id && (
            <p className={s.replyContext}>
              Reply to{" "}
              {parent ? (
                <a href={`#reply-${parent.id}`}>
                  {parent.author_name || "Clinician"}
                </a>
              ) : (
                "an earlier message (load more replies to view)"
              )}
            </p>
          )}
          <p>{r.body}</p>
          <Button variant="quiet" disabled={busy} onClick={() => choose(r)}>
            Reply to {r.author_name || "clinician"}
          </Button>
        </article>
        {children.length > 0 && (
          <ul className={`${s.replies} ${depth >= 2 ? s.flat : ""}`}>
            {children.map((x) => render(x, depth + 1))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <PageShell>
      <div className={`${s.workspace} ${s.thread}`}>
        <Link href="/doctor/network">Back to professional network</Link>
        {error && <Notice>{error}</Notice>}
        {notice && (
          <p role="status" className={s.muted}>
            {notice}
          </p>
        )}
        {loading ? (
          <p className={s.empty} role="status">
            Loading discussion…
          </p>
        ) : discussion ? (
          <>
            <PageHeader
              title={discussion.title}
              lede={`${discussion.community_name} · ${discussion.author_name ?? "Clinician"} · ${dateTime(discussion.created_at)}`}
              action={
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  Refresh
                </Button>
              }
            />
            <p>{discussion.body}</p>
            <div id="replies" className={s.toolbar}>
              <h2>Replies ({discussion.reply_count})</h2>
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => choose(null)}
              >
                Reply to discussion
              </Button>
            </div>
            {!replies.length ? (
              <p className={s.empty}>
                No replies yet. Share a response with the group.
              </p>
            ) : (
              <ul className={s.replies}>
                {replies
                  .filter(
                    (r) => !r.parent_reply_id || !byId.has(r.parent_reply_id),
                  )
                  .map((r) => render(r))}
              </ul>
            )}
            {cursor && (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => void more()}
              >
                Load more replies
              </Button>
            )}
            <form className={s.composer} onSubmit={send}>
              <h2>
                {target
                  ? `Reply to ${target.author_name || "clinician"}`
                  : "Reply to discussion"}
              </h2>
              {target && (
                <>
                  <p className={s.muted}>
                    {target.body.slice(0, 180)}
                    {target.body.length > 180 ? "…" : ""}
                  </p>
                  <Button
                    variant="quiet"
                    type="button"
                    disabled={busy}
                    onClick={() => choose(null)}
                  >
                    Cancel specific reply
                  </Button>
                </>
              )}
              <label>
                Your reply
                <textarea
                  ref={input}
                  required
                  maxLength={8000}
                  rows={4}
                  value={body}
                  disabled={busy}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <p className={s.muted}>
                All members of this group can read your reply. Keep patient
                identifiers out of this discussion.
              </p>
              <Button type="submit" disabled={busy || !body.trim()}>
                {busy ? "Posting…" : "Post reply"}
              </Button>
            </form>
          </>
        ) : (
          <Button onClick={() => void load()}>Try again</Button>
        )}
      </div>
    </PageShell>
  );
}
