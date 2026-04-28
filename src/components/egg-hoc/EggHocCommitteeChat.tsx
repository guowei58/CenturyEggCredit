"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { playEggHocIncomingBark, unlockEggHocNotificationAudio } from "@/lib/sounds/playEggHocBark";
type PublicUser = { id: string; name: string | null; email: string | null; image: string | null; chatDisplayId?: string | null };

type ConvRow = {
  id: string;
  type: string;
  title: string;
  isLobby?: boolean;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  lastMessageSenderName: string | null;
};

type MsgReplyTo = {
  id: string;
  body: string;
  deletedAt: string | null;
  sender: PublicUser;
};

type MsgRow = {
  id: string;
  senderUserId: string;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  sender: PublicUser;
  /** FK for replies; kept on the wire so clients can resolve quotes if a merge drops nested `replyTo`. */
  replyToMessageId?: string | null;
  replyTo?: MsgReplyTo | null;
};

type ConvDetail = {
  id: string;
  type: string;
  name: string | null;
  title: string;
  isLobby?: boolean;
  myRole: string;
  members: Array<{ userId: string; role: string; joinedAt: string; user: PublicUser }>;
};

const POLL_LIST_MS = 8000;
const POLL_THREAD_MS = 5000;

/** Avoid `res.json()` on empty/HTML bodies (shows a clear error instead of JSON parse failure). */
async function parseResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    if (res.status === 401) {
      throw new Error("Not signed in or session expired.");
    }
    throw new Error(
      `Empty response from server (${res.status}). If chat tables are missing, run Prisma migrations (egg_hoc_chat).`
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `Invalid JSON (${res.status}). ${trimmed.slice(0, 160)}${trimmed.length > 160 ? "…" : ""}`
    );
  }
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          " " +
          d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Merge one row into another without dropping `replyTo` when the incoming JSON omitted it (poll vs optimistic). */
function mergeMsgRowById(existing: MsgRow, incoming: MsgRow): MsgRow {
  const merged: MsgRow = { ...existing, ...incoming };
  if (!("replyTo" in incoming)) merged.replyTo = existing.replyTo;
  else if (incoming.replyTo == null && existing.replyTo) {
    const incRid = typeof incoming.replyToMessageId === "string" ? incoming.replyToMessageId.trim() : "";
    if (incRid && (incRid === existing.replyTo.id || incRid === (existing.replyToMessageId ?? "").toString().trim())) {
      merged.replyTo = existing.replyTo;
    }
  }
  if (!("replyToMessageId" in incoming)) merged.replyToMessageId = existing.replyToMessageId;
  return merged;
}

/** Union by id, chronological — keeps paginated older rows while merging latest-page poll results. */
function mergeMessagesChronological(prev: MsgRow[], incoming: MsgRow[]): MsgRow[] {
  const map = new Map<string, MsgRow>();
  for (const m of prev) map.set(m.id, m);
  for (const m of incoming) {
    const old = map.get(m.id);
    if (old) map.set(m.id, mergeMsgRowById(old, m));
    else map.set(m.id, m);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** Prefer server `replyTo`; otherwise resolve from loaded thread (same conversation page). */
function effectiveReplyTo(m: MsgRow, thread: MsgRow[]): MsgReplyTo | null {
  if (m.replyTo) return m.replyTo;
  const rid = typeof m.replyToMessageId === "string" ? m.replyToMessageId.trim() : "";
  if (!rid) return null;
  const parent = thread.find((x) => x.id === rid);
  if (!parent) return null;
  return {
    id: parent.id,
    body: parent.deletedAt ? "" : parent.body,
    deletedAt: parent.deletedAt,
    sender: parent.sender,
  };
}

/** Server sets `chatDisplayId` from preferences (Egg-Hoc chat ID) or email slug — never from legacy `User.name`. */
function eggHocPublicUserLabel(u: PublicUser): string {
  return u.chatDisplayId?.trim() || "Pari Passu Pal";
}

export function EggHocCommitteeChat() {
  const { data: session, status } = useSession();
  const { preferences } = useUserPreferences();
  const eggHocBarkMuted = preferences.eggHocBarkMuted === true;
  const userId = session?.user?.id ?? null;

  const [conversations, setConversations] = useState<ConvRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  /** More older messages exist (from paginated fetch); not updated by poll merge. */
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadOlderLoading, setLoadOlderLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  /** Message the user is composing a reply to (server thread / `replyToMessageId`). */
  const [replyParent, setReplyParent] = useState<MsgRow | null>(null);
  const [inboxFilter, setInboxFilter] = useState("");

  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<PublicUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupSelected, setGroupSelected] = useState<PublicUser[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  /** Scrollable message column — scroll this element; `scrollIntoView` on children often scrolls the wrong ancestor. */
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const inboxSnapshotRef = useRef<Map<string, { unread: number }>>(new Map());
  const inboxPrimedRef = useRef(false);
  const threadMsgIdsRef = useRef<Set<string>>(new Set());
  const threadActiveIdRef = useRef<string | null>(null);
  /** Last conversation id we loaded the thread for — detect switches without clearing on callback-only effect re-runs. */
  const prevThreadConvIdRef = useRef<string | null>(null);
  const lastUserForInboxRef = useRef<string | null>(null);
  /** Latest selected thread — ignore stale `fetchDetail` / poll responses after switching conversations. */
  const activeConversationIdRef = useRef<string | null>(null);

  activeConversationIdRef.current = activeId;

  const fetchList = useCallback(async () => {
    if (!userId) return;
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    try {
      const res = await fetch("/api/egg-hoc/conversations", { signal: ac.signal });
      const data = await parseResponseJson<{ ok?: boolean; conversations?: ConvRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to load conversations");
      setConversations(data.conversations ?? []);
      setListError(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setListError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setListLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void fetchList();
    const t = setInterval(() => void fetchList(), POLL_LIST_MS);
    return () => clearInterval(t);
  }, [userId, fetchList]);

  useEffect(() => {
    if (!userId) {
      inboxPrimedRef.current = false;
      inboxSnapshotRef.current = new Map();
      lastUserForInboxRef.current = null;
      return;
    }
    if (lastUserForInboxRef.current !== userId) {
      lastUserForInboxRef.current = userId;
      inboxPrimedRef.current = false;
      inboxSnapshotRef.current = new Map();
    }
    if (listLoading && conversations.length === 0) return;

    const snap = new Map(conversations.map((c) => [c.id, { unread: c.unreadCount }]));
    if (!inboxPrimedRef.current) {
      inboxPrimedRef.current = true;
      inboxSnapshotRef.current = snap;
      return;
    }
    const prev = inboxSnapshotRef.current;
    for (const c of conversations) {
      const p = prev.get(c.id);
      const unreadUp = p !== undefined && c.unreadCount > p.unread;
      const newThreadUnread = p === undefined && c.unreadCount > 0;
      if (unreadUp || newThreadUnread) {
        if (!eggHocBarkMuted) playEggHocIncomingBark();
        break;
      }
    }
    inboxSnapshotRef.current = snap;
  }, [conversations, userId, listLoading, eggHocBarkMuted]);

  useEffect(() => {
    if (!userId || !activeId) {
      threadActiveIdRef.current = null;
      threadMsgIdsRef.current = new Set();
      return;
    }
    if (threadActiveIdRef.current !== activeId) {
      threadActiveIdRef.current = activeId;
      threadMsgIdsRef.current = new Set();
    }
    if (messages.length === 0) return;

    const prev = threadMsgIdsRef.current;
    const fromOthers = messages.filter(
      (m) =>
        !prev.has(m.id) && m.senderUserId !== userId && !m.id.startsWith("temp-")
    );
    if (fromOthers.length > 0 && prev.size > 0) {
      if (!eggHocBarkMuted) playEggHocIncomingBark();
    }
    threadMsgIdsRef.current = new Set(messages.map((m) => m.id));
  }, [messages, activeId, userId, eggHocBarkMuted]);

  const fetchMessageBatch = useCallback(async (conversationId: string, before?: string) => {
    const qs = new URLSearchParams({ take: "40" });
    if (before) qs.set("before", before);
    const res = await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`);
    const data = await parseResponseJson<{
      ok?: boolean;
      messages?: MsgRow[];
      hasMore?: boolean;
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error || "Failed to load messages");
    return { batch: data.messages ?? [], hasMore: Boolean(data.hasMore) };
  }, []);

  const mergeLatestPageIntoThread = useCallback(async () => {
    const id = activeConversationIdRef.current;
    if (!id) return;
    const { batch } = await fetchMessageBatch(id);
    if (id !== activeConversationIdRef.current) return;
    setMessages((prev) => mergeMessagesChronological(prev, batch));
  }, [fetchMessageBatch]);

  const fetchDetail = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(conversationId)}`);
    const data = await parseResponseJson<{ ok?: boolean; conversation?: ConvDetail; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Failed to load conversation");
    if (conversationId !== activeConversationIdRef.current) return;
    setDetail(data.conversation ?? null);
    if (data.conversation)
      setRenameDraft(data.conversation.name ?? data.conversation.title ?? "");
  }, []);

  useEffect(() => {
    if (!activeId || !userId) {
      setDetail(null);
      setMessages([]);
      setHasMoreOlder(false);
      prevThreadConvIdRef.current = null;
      return;
    }
    const switchedConv = prevThreadConvIdRef.current !== activeId;
    prevThreadConvIdRef.current = activeId;
    const convId = activeId;
    let cancelled = false;
    (async () => {
      setThreadLoading(true);
      setHasMoreOlder(false);
      if (switchedConv) setMessages([]);
      try {
        await fetchDetail(convId);
        if (cancelled || convId !== activeConversationIdRef.current) return;
        const { batch, hasMore } = await fetchMessageBatch(convId);
        if (cancelled || convId !== activeConversationIdRef.current) return;
        setMessages(batch);
        setHasMoreOlder(hasMore);
        await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(convId)}/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        void fetchList();
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : "Thread error");
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, userId, fetchDetail, fetchMessageBatch, fetchList]);

  useEffect(() => {
    setReplyParent(null);
  }, [activeId]);

  useEffect(() => {
    if (!activeId || !userId) return;
    const t = setInterval(() => {
      void (async () => {
        try {
          const id = activeConversationIdRef.current;
          if (!id) return;
          const { batch } = await fetchMessageBatch(id);
          if (id !== activeConversationIdRef.current) return;
          setMessages((prev) => mergeMessagesChronological(prev, batch));
          await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(id)}/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          void fetchList();
        } catch {
          /* ignore poll errors */
        }
      })();
    }, POLL_THREAD_MS);
    return () => clearInterval(t);
  }, [activeId, userId, fetchMessageBatch, fetchList]);

  const scrollThreadToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /** After switching chats or finishing the initial fetch, pin the viewport to the latest messages. */
  useLayoutEffect(() => {
    if (!activeId || threadLoading) return;
    scrollThreadToBottom("auto");
    requestAnimationFrame(() => scrollThreadToBottom("auto"));
  }, [activeId, threadLoading, scrollThreadToBottom]);

  const send = async () => {
    const text = composer.trim();
    if (!text || !activeId || sending) return;
    const savedParent = replyParent;
    setSending(true);
    setReplyParent(null);
    const replyId =
      savedParent && !savedParent.id.startsWith("temp-") ? savedParent.id : null;
    const optimistic: MsgRow = {
      id: `temp-${Date.now()}`,
      senderUserId: userId!,
      body: text,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      sender: {
        id: userId!,
        name: session?.user?.name ?? null,
        email: session?.user?.email ?? null,
        image: session?.user?.image ?? null,
        chatDisplayId: preferences.profile?.chatDisplayId?.trim() || undefined,
      },
      replyToMessageId: replyId,
      replyTo: savedParent
        ? {
            id: savedParent.id,
            body: savedParent.deletedAt ? "" : savedParent.body,
            deletedAt: savedParent.deletedAt,
            sender: savedParent.sender,
          }
        : null,
    };
    setMessages((m) => [...m, optimistic]);
    setComposer("");
    try {
      const res = await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(activeId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          ...(savedParent && !savedParent.id.startsWith("temp-") ? { replyToMessageId: savedParent.id } : {}),
        }),
      });
      const data = await parseResponseJson<{ ok?: boolean; message?: MsgRow; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Send failed");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id).concat(data.message!));
      void fetchList();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollThreadToBottom("smooth"));
      });
    } catch {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setComposer(text);
      setReplyParent(savedParent);
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
    }
  };

  const loadOlder = async () => {
    if (!activeId || !hasMoreOlder || loadOlderLoading || messages.length === 0) return;
    const convId = activeId;
    const oldest = messages[0].id;
    if (oldest.startsWith("temp-")) return;
    setLoadOlderLoading(true);
    try {
      const { batch, hasMore } = await fetchMessageBatch(convId, oldest);
      if (convId !== activeConversationIdRef.current) return;
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const prefix = batch.filter((m) => !ids.has(m.id));
        return [...prefix, ...prev];
      });
      setHasMoreOlder(hasMore);
    } finally {
      setLoadOlderLoading(false);
    }
  };

  const searchUsers = async (q: string) => {
    try {
      const res = await fetch(`/api/egg-hoc/users?q=${encodeURIComponent(q)}`);
      const data = await parseResponseJson<{ ok?: boolean; users?: PublicUser[]; error?: string }>(res);
      if (!res.ok) {
        setPickerResults([]);
        return;
      }
      setPickerResults(data.users ?? []);
    } catch {
      setPickerResults([]);
    }
  };

  useEffect(() => {
    if (!newDmOpen && !newGroupOpen && !manageOpen) return;
    const t = setTimeout(() => void searchUsers(pickerQuery), 200);
    return () => clearTimeout(t);
  }, [pickerQuery, newDmOpen, newGroupOpen, manageOpen]);

  const activeConvRow = useMemo(
    () => (activeId ? conversations.find((c) => c.id === activeId) ?? null : null),
    [activeId, conversations]
  );
  const detailMatchesActive = Boolean(activeId && detail?.id === activeId);
  const isAdmin = detailMatchesActive && detail?.myRole === "ADMIN";
  /** Inbox row is authoritative when `detail` is still loading or was cleared so the header never shows "…" / DM for the Lobby. */
  const isLobby = detailMatchesActive
    ? Boolean(detail?.isLobby)
    : Boolean(activeConvRow?.isLobby);
  const isGroup =
    isLobby ||
    (detailMatchesActive && detail?.type === "GROUP") ||
    Boolean(activeConvRow?.type === "GROUP");
  const chatTitle =
    (detailMatchesActive && detail?.title?.trim() ? detail.title.trim() : "") ||
    (activeConvRow?.title?.trim() ? activeConvRow.title.trim() : "") ||
    "…";

  const startDm = async (target: PublicUser) => {
    const res = await fetch("/api/egg-hoc/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "direct", targetUserId: target.id }),
    });
    const data = await parseResponseJson<{ ok?: boolean; conversationId?: string; error?: string }>(res);
    if (!res.ok) {
      alert(data.error || "Could not start DM");
      return;
    }
    setNewDmOpen(false);
    setPickerQuery("");
    await fetchList();
    setActiveId(data.conversationId!);
  };

  const createGroup = async () => {
    const res = await fetch("/api/egg-hoc/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "group",
        name: groupName,
        memberUserIds: groupSelected.map((u) => u.id),
      }),
    });
    const data = await parseResponseJson<{ ok?: boolean; conversationId?: string; error?: string }>(res);
    if (!res.ok) {
      alert(data.error || "Could not create group");
      return;
    }
    setNewGroupOpen(false);
    setGroupName("");
    setGroupSelected([]);
    setPickerQuery("");
    await fetchList();
    setActiveId(data.conversationId!);
  };

  const saveRename = async () => {
    if (!activeId || detail?.type !== "GROUP") return;
    const res = await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(activeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameDraft }),
    });
    const data = await parseResponseJson<{ error?: string }>(res);
    if (!res.ok) {
      alert(data.error || "Rename failed");
      return;
    }
    setManageOpen(false);
    void fetchDetail(activeId);
    void fetchList();
  };

  const addMember = async (u: PublicUser) => {
    if (!activeId) return;
    const res = await fetch(`/api/egg-hoc/conversations/${encodeURIComponent(activeId)}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [u.id] }),
    });
    const data = await parseResponseJson<{ error?: string }>(res);
    if (!res.ok) alert(data.error || "Add failed");
    else void fetchDetail(activeId);
  };

  const removeMember = async (uid: string) => {
    if (!activeId) return;
    if (!confirm("Remove this member?")) return;
    const res = await fetch(
      `/api/egg-hoc/conversations/${encodeURIComponent(activeId)}/members/${encodeURIComponent(uid)}`,
      { method: "DELETE" }
    );
    const data = await parseResponseJson<{ error?: string }>(res);
    if (!res.ok) alert(data.error || "Remove failed");
    else {
      void fetchDetail(activeId);
      if (uid === userId) {
        setActiveId(null);
        void fetchList();
      }
    }
  };

  const filteredConversations = [...conversations]
    .filter(
      (c) =>
        !inboxFilter.trim() ||
        c.title.toLowerCase().includes(inboxFilter.toLowerCase()) ||
        c.lastMessagePreview.toLowerCase().includes(inboxFilter.toLowerCase())
    )
    .sort((a, b) => {
      if (a.isLobby && !b.isLobby) return -1;
      if (!a.isLobby && b.isLobby) return 1;
      return 0;
    });

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm" style={{ color: "var(--muted2)" }}>
        Loading session…
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm" style={{ color: "var(--muted2)" }}>
        <p style={{ color: "var(--text)" }}>Sign in to use Egg-Hoc Committee chat.</p>
        <p>
          The Lobby, direct messages, and groups are available to signed-in Pari Passu Pals.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1"
      onPointerDownCapture={() => unlockEggHocNotificationAudio()}
    >
      <div
        className="flex w-[min(100%,280px)] shrink-0 flex-col border-r"
        style={{ borderColor: "var(--border2)" }}
      >
        <div className="flex shrink-0 flex-col gap-2 border-b p-3" style={{ borderColor: "var(--border2)" }}>
          <input
            type="search"
            placeholder="Search conversations…"
            value={inboxFilter}
            onChange={(e) => setInboxFilter(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-xs"
            style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              className="flex-1 rounded border px-2 py-1.5 text-[11px] font-semibold"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              onClick={() => {
                setNewDmOpen(true);
                setPickerQuery("");
                void searchUsers("");
              }}
            >
              New DM
            </button>
            <button
              type="button"
              className="flex-1 rounded border px-2 py-1.5 text-[11px] font-semibold"
              style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card2)" }}
              onClick={() => {
                setNewGroupOpen(true);
                setPickerQuery("");
                setGroupSelected([]);
                void searchUsers("");
              }}
            >
              New group
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listLoading && conversations.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--muted2)" }}>
              Loading inbox…
            </p>
          ) : listError && conversations.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--danger)" }}>
              {listError}
            </p>
          ) : filteredConversations.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--muted2)" }}>
              No matching conversations. Try another search, or start a DM / group.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border2)" }}>
              {filteredConversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-[var(--card)]"
                    style={{
                      background: activeId === c.id ? "var(--card2)" : undefined,
                      borderLeft: activeId === c.id ? "3px solid var(--accent)" : "3px solid transparent",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-xs font-semibold" style={{ color: "var(--text)" }}>
                        {c.title}
                        {c.isLobby ? (
                          <span
                            className="ml-1.5 align-middle text-[9px] font-semibold uppercase tracking-wide"
                            style={{ color: "var(--accent)" }}
                          >
                            Everyone
                          </span>
                        ) : null}
                      </span>
                      {c.unreadCount > 0 ? (
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ background: "var(--accent)", color: "#000" }}
                        >
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[10px]" style={{ color: "var(--muted2)" }}>
                      {c.lastMessagePreview || "No messages yet"}
                    </p>
                    <p className="mt-0.5 text-[9px]" style={{ color: "var(--muted)" }}>
                      {formatTime(c.lastMessageAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm" style={{ color: "var(--muted2)" }}>
            Select a conversation or start a new one.
          </div>
        ) : (
          <>
            <div
              className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"
              style={{ borderColor: "var(--border2)", background: "var(--sb)" }}
            >
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
                  {chatTitle}
                </h2>
                {isLobby ? (
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    General channel · all signed-in Pari Passu Pals
                  </p>
                ) : isGroup ? (
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    Group · {detail?.members.length ?? 0} members
                  </p>
                ) : (
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    Direct message
                  </p>
                )}
              </div>
              {detailMatchesActive && detail?.type === "GROUP" && !isLobby ? (
                <button
                  type="button"
                  className="shrink-0 rounded border px-2 py-1 text-[10px] font-medium"
                  style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                  onClick={() => {
                    setRenameDraft(detail?.name ?? detail?.title ?? "");
                    setPickerQuery("");
                    setManageOpen(true);
                    void searchUsers("");
                  }}
                >
                  {isAdmin ? "Manage group" : "Members"}
                </button>
              ) : null}
            </div>

            <div ref={threadScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {threadLoading && messages.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--muted2)" }}>
                  Loading messages…
                </p>
              ) : (
                <>
                  {hasMoreOlder ? (
                    <button
                      type="button"
                      className="mb-3 w-full rounded border py-1.5 text-[11px] font-medium"
                      style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
                      disabled={loadOlderLoading}
                      onClick={() => void loadOlder()}
                    >
                      {loadOlderLoading ? "Loading…" : "Load older messages"}
                    </button>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    {messages.map((m) => {
                      const replyCtx = effectiveReplyTo(m, messages);
                      const mine = m.senderUserId === userId;
                      const showSender = isGroup && !mine;
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}
                        >
                          {showSender ? (
                            <span className="px-1 text-[10px] font-medium" style={{ color: "var(--muted)" }}>
                              {eggHocPublicUserLabel(m.sender)}
                            </span>
                          ) : null}
                          <div
                            className="max-w-[min(100%,340px)] rounded-lg border px-3 py-2 text-sm"
                            style={{
                              borderColor: mine ? "var(--accent)" : "var(--border2)",
                              background: mine ? "rgba(0,212,170,0.08)" : "var(--card2)",
                              color: m.deletedAt ? "var(--muted)" : "var(--text)",
                            }}
                          >
                            {replyCtx ? (
                              <div
                                className="mb-2 border-l-2 pl-2 text-[11px] leading-snug"
                                style={{ borderColor: "var(--accent)", color: "var(--muted2)" }}
                              >
                                <div className="font-semibold" style={{ color: "var(--muted)" }}>
                                  Replying to {eggHocPublicUserLabel(replyCtx.sender)}
                                </div>
                                <div className="line-clamp-4 whitespace-pre-wrap break-words">
                                  {replyCtx.deletedAt ? "(Original message was deleted.)" : replyCtx.body}
                                </div>
                              </div>
                            ) : null}
                            {m.deletedAt ? (
                              <em className="text-xs">Message deleted</em>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            )}
                            <div
                              className="mt-1 flex flex-wrap items-center gap-x-2 text-[9px]"
                              style={{ color: "var(--muted)" }}
                            >
                              <span>{formatTime(m.createdAt)}</span>
                              {m.editedAt ? <span>(edited)</span> : null}
                              {!m.deletedAt && !m.id.startsWith("temp-") ? (
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() => setReplyParent(m)}
                                >
                                  Reply
                                </button>
                              ) : null}
                              {mine && !m.deletedAt && !m.id.startsWith("temp-") ? (
                                <>
                                  <button
                                    type="button"
                                    className="underline"
                                    onClick={() => {
                                      const next = prompt("Edit message", m.body);
                                      if (next == null || !next.trim()) return;
                                      void (async () => {
                                        const res = await fetch(
                                          `/api/egg-hoc/messages/${encodeURIComponent(m.id)}`,
                                          {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ body: next }),
                                          }
                                        );
                                        if (res.ok) void mergeLatestPageIntoThread();
                                      })();
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="underline"
                                    onClick={() => {
                                      if (!confirm("Delete this message?")) return;
                                      void (async () => {
                                        const res = await fetch(
                                          `/api/egg-hoc/messages/${encodeURIComponent(m.id)}`,
                                          { method: "DELETE" }
                                        );
                                        if (res.ok) void mergeLatestPageIntoThread();
                                      })();
                                    }}
                                  >
                                    Delete
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div
              className="shrink-0 border-t p-3"
              style={{ borderColor: "var(--border2)", background: "var(--sb)" }}
            >
              {replyParent ? (
                <div
                  className="mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug"
                  style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold" style={{ color: "var(--muted)" }}>
                      Replying to {eggHocPublicUserLabel(replyParent.sender)}
                    </div>
                    <div className="line-clamp-3 whitespace-pre-wrap break-words" style={{ color: "var(--muted2)" }}>
                      {replyParent.deletedAt ? "(Message deleted.)" : replyParent.body}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyParent(null)}
                    className="shrink-0 rounded border px-2 py-0.5 text-[9px] font-medium"
                    style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "var(--card)" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <div className="flex gap-2">
                <textarea
                  ref={composerRef}
                  rows={2}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Message… (Enter to send, Shift+Enter for newline)"
                  className="min-h-[44px] flex-1 resize-y rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--border2)",
                    background: "var(--card)",
                    color: "var(--text)",
                  }}
                  disabled={sending}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || !composer.trim()}
                  className="self-end rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {(newDmOpen || newGroupOpen) && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setNewDmOpen(false);
              setNewGroupOpen(false);
            }
          }}
        >
          <div
            className="max-h-[min(90vh,520px)] w-full max-w-md overflow-hidden rounded-xl border shadow-xl"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {newDmOpen ? "New direct message" : "New group"}
              </h3>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-4">
              {newGroupOpen ? (
                <label className="mb-3 block text-xs" style={{ color: "var(--muted2)" }}>
                  Group name
                  <input
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
                  />
                </label>
              ) : null}
              <input
                type="search"
                placeholder="Search Pari Passu Pals by user ID…"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                className="mb-2 w-full rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
              />
              <ul className="space-y-1">
                {pickerResults.map((u) => (
                  <li key={u.id}>
                    {/*
                      Privacy: never display email addresses here.
                      UX: show chat user ID only.
                    */}
                    {newGroupOpen ? (
                      <div className="flex items-center justify-between gap-2 rounded border px-2 py-1.5" style={{ borderColor: "var(--border2)" }}>
                        <span className="truncate text-xs" style={{ color: "var(--text)" }}>
                          {u.chatDisplayId?.trim() || "—"}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-[10px] font-semibold"
                          style={{ color: "var(--accent)" }}
                          onClick={() => {
                            if (u.id === userId) return;
                            if (!u.chatDisplayId?.trim()) return;
                            setGroupSelected((s) => (s.some((x) => x.id === u.id) ? s : [...s, u]));
                          }}
                          disabled={!u.chatDisplayId?.trim()}
                        >
                          Add
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--card)]"
                        style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                        onClick={() => void startDm(u)}
                        disabled={!u.chatDisplayId?.trim()}
                      >
                        {u.chatDisplayId?.trim() || "—"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {newGroupOpen && groupSelected.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
                    Selected ({groupSelected.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {groupSelected.map((u) => (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
                        style={{ borderColor: "var(--border2)" }}
                      >
                        {u.chatDisplayId?.trim() || "—"}
                        <button type="button" aria-label="Remove" onClick={() => setGroupSelected((s) => s.filter((x) => x.id !== u.id))}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-3 w-full rounded-lg border py-2 text-sm font-semibold"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                    onClick={() => void createGroup()}
                  >
                    Create group
                  </button>
                </div>
              ) : null}
            </div>
            <div className="border-t p-3 text-right" style={{ borderColor: "var(--border2)" }}>
              <button
                type="button"
                className="text-xs font-medium"
                style={{ color: "var(--muted2)" }}
                onClick={() => {
                  setNewDmOpen(false);
                  setNewGroupOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {manageOpen && detail && isGroup && !isLobby && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setManageOpen(false);
          }}
        >
          <div
            className="max-h-[min(90vh,480px)] w-full max-w-md overflow-hidden rounded-xl border"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <div className="border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Group settings
              </h3>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-4">
              {isAdmin ? (
                <label className="mb-4 block text-xs" style={{ color: "var(--muted2)" }}>
                  Rename group
                  <div className="mt-1 flex gap-2">
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      className="flex-1 rounded border px-2 py-1.5 text-sm"
                      style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
                    />
                    <button
                      type="button"
                      className="rounded border px-3 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                      onClick={() => void saveRename()}
                    >
                      Save
                    </button>
                  </div>
                </label>
              ) : null}
              <p className="mb-2 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
                Members
              </p>
              <ul className="space-y-2">
                {detail.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-2 text-xs"
                    style={{ color: "var(--text)" }}
                  >
                    <span>
                      {eggHocPublicUserLabel(m.user)}
                      <span style={{ color: "var(--muted)" }}> · {m.role}</span>
                    </span>
                    {isAdmin && m.userId !== userId ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold"
                        style={{ color: "var(--danger)" }}
                        onClick={() => void removeMember(m.userId)}
                      >
                        Remove
                      </button>
                    ) : m.userId === userId ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold"
                        style={{ color: "var(--muted2)" }}
                        onClick={() => void removeMember(m.userId)}
                      >
                        Leave
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {isAdmin ? (
                <>
                  <p className="mb-2 mt-4 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
                    Add people
                  </p>
                  <input
                    type="search"
                    placeholder="Search…"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    className="mb-2 w-full rounded border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
                  />
                  <ul className="space-y-1">
                    {pickerResults
                      .filter((u) => !detail.members.some((m) => m.userId === u.id))
                      .map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            className="w-full rounded border px-2 py-1 text-left text-xs"
                            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                            onClick={() => void addMember(u)}
                          >
                            + {eggHocPublicUserLabel(u)}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </div>
            <div className="border-t p-3 text-right" style={{ borderColor: "var(--border2)" }}>
              <button type="button" className="text-xs" style={{ color: "var(--muted2)" }} onClick={() => setManageOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
