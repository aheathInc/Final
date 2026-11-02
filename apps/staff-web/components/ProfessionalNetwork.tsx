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
type Mode = "all" | "replies" | "muted";
interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  is_member: boolean;
  notification_mode: Mode | null;
}
interface Notification {
  id: string;
  kind: string;
  title: string;
  group_name: string;
  href: string;
  read_at: string | null;
  created_at: string;
}
export function ProfessionalNetwork() {
  const [groupsOpen, setGroupsOpen] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 850px)');
    const adapt = () => setGroupsOpen(!media.matches);
    adapt();
    media.addEventListener('change', adapt);
    return () => media.removeEventListener('change', adapt);
  }, []);
  const [groups, setGroups] = useState<Group[]>([]),
    [posts, setPosts] = useState<Discussion[]>([]),
    [selected, setSelected] = useState("");
  const [notifications, setNotifications] = useState<{
    data: Notification[];
    unread_count: number;
  }>({ data: [], unread_count: 0 });
  const [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [cursor, setCursor] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [groupId, setGroupId] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const request = useRef<{
      signature: string;
      config: ReturnType<typeof idem>;
    } | null>(null),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const [g, d, n] = await Promise.all([
        api.get<{ data: Group[] }>("/network/communities"),
        api.get<Page<Discussion>>("/network/discussions", {
          params: {
            limit: 30,
            ...(selected ? { community_id: selected } : {}),
          },
        }),
        api.get<typeof notifications>("/network/notifications"),
      ]);
      if (version !== epoch.current) return;
      setGroups(g.data.data);
      setPosts(d.data.data);
      setCursor(d.data.meta?.next_cursor ?? null);
      setNotifications(n.data);
    } catch (e) {
      if (version === epoch.current) {
        setLoadFailed(true);
        setPosts([]);
        setError(
          errorMessage(
            e,
            "Professional network could not load. Refresh to try again.",
          ),
        );
      }
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [selected]);
  useEffect(() => {
    void load();
    return () => {
      ++epoch.current;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void api
          .get<typeof notifications>("/network/notifications")
          .then((r) => setNotifications(r.data))
          .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  async function membership(g: Group, mode?: Mode) {
    setBusy(true);
    setError(null);
    try {
      if (mode)
        await api.put(`/network/communities/${g.id}/membership`, {
          notification_mode: mode,
        });
      else await api.delete(`/network/communities/${g.id}/membership`);
      setNotice(
        mode
          ? `${g.name}: notification preference saved.`
          : `You left ${g.name}.`,
      );
      if (!mode && selected === g.id) setSelected("");
      else await load();
    } catch (e) {
      setError(errorMessage(e, "Group membership could not be updated."));
    } finally {
      setBusy(false);
    }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
        community_id: groupId,
        title: title.trim(),
        body: body.trim(),
      },
      signature = JSON.stringify(input);
    if (request.current?.signature !== signature)
      request.current = { signature, config: idem() };
    try {
      await api.post("/network/discussions", input, request.current.config);
      request.current = null;
      setOpen(false);
      setTitle("");
      setBody("");
      setNotice("Your discussion is visible to members of the selected group.");
      if (selected && selected !== groupId) setSelected(groupId);
      else await load();
    } catch (e) {
      setError(
        errorMessage(e, "Your discussion could not be posted. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const r = await api.get<Page<Discussion>>("/network/discussions", {
        params: {
          limit: 30,
          cursor,
          ...(selected ? { community_id: selected } : {}),
        },
      });
      setPosts((p) => [
        ...p,
        ...r.data.data.filter((d) => !p.some((x) => x.id === d.id)),
      ]);
      setCursor(r.data.meta?.next_cursor ?? null);
    } catch (e) {
      setError(errorMessage(e, "More discussions could not load."));
    } finally {
      setBusy(false);
    }
  }
  async function read(n: Notification) {
    try {
      await api.post(`/network/notifications/${n.id}/read`);
      setNotifications((p) => ({
        ...p,
        unread_count: Math.max(
          0,
          p.unread_count - (p.data.find((x) => x.id === n.id)?.read_at ? 0 : 1),
        ),
        data: p.data.map((x) =>
          x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x,
        ),
      }));
    } catch (e) {
      setError(errorMessage(e, "Could not mark notification as read."));
    }
  }
  const joined = groups.filter((g) => g.is_member);
  return (
    <PageShell>
      <div className={s.workspace}>
        <PageHeader
          title="Professional network"
          lede="Discuss clinical questions with colleagues. Keep patient identifiers out of groups; use a patient-authorized referral for clinical handoffs."
          action={
            <Button
              variant="quiet"
              disabled={loading || busy}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          }
        />
        {error && <Notice>{error}</Notice>}
        {notice && (
          <p role="status" className={s.muted}>
            {notice}
          </p>
        )}
        <div className={s.layout}>
          <aside className={s.sidebar}>
            <details className={s.groups} open={groupsOpen} onToggle={e=>setGroupsOpen(e.currentTarget.open)}>
            <summary>Professional groups · {joined.length} joined</summary>
            {loadFailed ? <p className={s.empty}>Groups could not be loaded. Use Refresh to try again.</p> : loading && !groups.length ? (
              <p role="status">Loading groups…</p>
            ) : !groups.length ? (
              <p className={s.empty}>
                No professional groups are available yet.
              </p>
            ) : (
              groups.map((g) => (
                <section className={s.group} key={g.id}>
                  <strong>{g.name}</strong>
                  <p className={s.muted}>
                    {g.description || `${g.member_count} members`}
                  </p>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      void membership(g, g.is_member ? undefined : "replies")
                    }
                  >
                    {g.is_member ? "Leave group" : "Join group"}
                  </Button>
                  {g.is_member && (
                    <label>
                      Notifications for {g.name}
                      <select
                        disabled={busy}
                        value={g.notification_mode ?? "replies"}
                        onChange={(e) =>
                          void membership(g, e.target.value as Mode)
                        }
                      >
                        <option value="replies">
                          Replies in discussions I follow
                        </option>
                        <option value="all">All group activity</option>
                        <option value="muted">Muted</option>
                      </select>
                    </label>
                  )}
                </section>
              ))
            )}
            <p className={s.muted}>
              Posting or replying follows that discussion. Notifications stay
              inside AHP.
            </p>
            </details>
          </aside>
          <section className={s.feed}>
            <div className={s.toolbar}>
              <label>
                Show discussions
                <select
                  value={selected}
                  disabled={loading || busy || loadFailed}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">All my groups</option>
                  {joined.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!joined.length || busy || loadFailed}
                onClick={() => {
                  setGroupId(selected || joined[0]?.id || "");
                  setOpen((v) => !v);
                }}
              >
                {open ? "Close composer" : "New discussion"}
              </Button>
            </div>
            {open && (
              <form className={s.composer} onSubmit={publish}>
                <h2>Start a group discussion</h2>
                <label>
                  Group
                  <select
                    required
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                  >
                    {joined.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Subject
                  <input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    required
                    rows={5}
                    maxLength={8000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
                <p className={s.muted}>
                  Every member of this group can read and reply. Do not include
                  names, phone numbers or other patient identifiers.
                </p>
                <div className={s.actions}>
                  <Button
                    disabled={
                      busy ||
                      !title.trim() ||
                      !body.trim() ||
                      !joined.some((g) => g.id === groupId)
                    }
                    type="submit"
                  >
                    {busy ? "Posting…" : "Post to group"}
                  </Button>
                  <Button
                    variant="quiet"
                    type="button"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            <div className={s.notifications}>
              <details>
                <summary>
                  Notifications · {notifications.unread_count} unread
                </summary>
                {loadFailed ? <p className={s.empty}>Notifications could not be refreshed. Use Refresh to try again.</p> : !notifications.data.length ? (
                  <p className={s.empty}>
                    Replies to your discussions will appear here.
                  </p>
                ) : (
                  <ul>
                    {notifications.data.map((n) => (
                      <li key={n.id}>
                        <Link href={n.href}>
                          {n.kind === "reply"
                            ? "New reply: "
                            : "New discussion: "}
                          {n.title}
                        </Link>
                        <p className={s.muted}>
                          {n.group_name} · {dateTime(n.created_at)}
                          {n.read_at ? " · Read" : ""}
                        </p>
                        {!n.read_at && (
                          <Button variant="quiet" onClick={() => void read(n)}>
                            Mark as read
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </div>
            <h2 className="mt-6">Discussions</h2>
            {loadFailed ? <p className={s.empty}>Discussions could not be loaded. Use Refresh to try again.</p> : loading ? (
              <p role="status" className={s.empty}>
                Loading discussions…
              </p>
            ) : !posts.length ? (
              <p className={s.empty}>
                {joined.length
                  ? "No discussions here yet. Start a clinical question for your group."
                  : "Join a professional group to read and start discussions."}
              </p>
            ) : (
              <ul className={s.posts}>
                {posts.map((d) => (
                  <li key={d.id} className={s.post}>
                    <Link href={`/doctor/network/${d.id}`}>{d.title}</Link>
                    <p className={s.preview}>{d.body}</p>
                    <p className={s.muted}>
                      {d.author_name ?? "Clinician"} ·{" "}
                      {groups.find((g) => g.id === d.community_id)?.name} ·{" "}
                      {dateTime(d.created_at)} · {d.reply_count} replies
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {cursor && !loadFailed && (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => void more()}
              >
                Load more discussions
              </Button>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
