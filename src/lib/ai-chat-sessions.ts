/**
 * AI Chat session model and server sync (`/api/me/ai-chat`).
 */

/** Binary attachment kept in memory for the active thread until stripped after send. */
export type AiChatAttachment = {
  id: string;
  name: string;
  mediaType: string;
  data: string;
};

export type AiChatUserMessage = {
  role: "user";
  content: string;
  attachments?: AiChatAttachment[];
};

export type AiChatAssistantMessage = {
  role: "assistant";
  content: string;
};

export type AiChatMessage = AiChatUserMessage | AiChatAssistantMessage;

export type AiChatSession = {
  id: string;
  title: string;
  messages: AiChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export const AI_CHAT_MAX_SESSIONS = 80;
export const AI_CHAT_MAX_MESSAGES_PER_SESSION = 200;

/** `localStorage`: last time the user had AI Chat open (or its messages in view). */
export const OREO_AI_CHAT_LAST_SEEN_KEY = "oreo_ai_chat_last_seen_at";
/** `sessionStorage`: set while a reply is being generated and the drawer is closed. */
export const OREO_AI_CHAT_WAITING_REPLY_KEY = "oreo_ai_chat_waiting_reply";

export function markAiChatViewedNow(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(OREO_AI_CHAT_LAST_SEEN_KEY, new Date().toISOString());
  } catch {
    /* quota / private mode */
  }
}

export function getAiChatLastSeenIso(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(OREO_AI_CHAT_LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

/** Latest `session.updatedAt` among sessions whose last message is from the assistant. */
export function latestAssistantReplySessionUpdatedAt(sessions: AiChatSession[]): string | null {
  let best: string | null = null;
  for (const s of sessions) {
    const last = s.messages[s.messages.length - 1];
    if (!last || last.role !== "assistant") continue;
    if (!best || s.updatedAt > best) best = s.updatedAt;
  }
  return best;
}

/** True if an assistant reply is newer than the last “viewed” timestamp (nav dot). */
export function aiChatShowsUnreadNavDot(sessions: AiChatSession[], lastSeenIso: string | null): boolean {
  const latest = latestAssistantReplySessionUpdatedAt(sessions);
  if (!latest) return false;
  if (!lastSeenIso) return true;
  return latest > lastSeenIso;
}

export function createAiChatSession(): AiChatSession {
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `s-${now}-${Math.random().toString(16).slice(2)}`,
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveSessionTitle(messages: AiChatMessage[]): string {
  const first = messages.find((m) => m.role === "user") as AiChatUserMessage | undefined;
  if (!first) return "New chat";
  const t = (first.content ?? "").trim().replace(/\s+/g, " ");
  if (t) return t.length > 48 ? `${t.slice(0, 47)}…` : t;
  const n = first.attachments?.[0]?.name;
  if (n) return n.length > 48 ? `${n.slice(0, 47)}…` : n;
  return "New chat";
}

export function pruneSessions(sessions: AiChatSession[]): AiChatSession[] {
  if (sessions.length <= AI_CHAT_MAX_SESSIONS) return sessions;
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, AI_CHAT_MAX_SESSIONS);
}

function stripAttachmentsFromMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant") return m;
    const u = m as AiChatUserMessage;
    if (!u.attachments?.length) return m;
    const names = u.attachments.map((a) => a.name).join(", ");
    const note = names ? `\n\n[Attached files not kept in history: ${names}]` : "";
    return { role: "user", content: `${(u.content || "").trim()}${note}`.trim() };
  });
}

function parseSessionsArray(parsed: unknown): AiChatSession[] {
  if (!Array.isArray(parsed)) return [];
  const sessions: AiChatSession[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id) continue;
    const messages: AiChatMessage[] = [];
    if (Array.isArray(o.messages)) {
      for (const m of o.messages) {
        if (!m || typeof m !== "object") continue;
        const role = (m as { role?: string }).role;
        const content = (m as { content?: unknown }).content;
        if (role === "assistant") {
          if (typeof content === "string") messages.push({ role: "assistant", content });
          continue;
        }
        if (role === "user") {
          const c = typeof content === "string" ? content : "";
          messages.push({ role: "user", content: c });
        }
      }
    }
    sessions.push({
      id,
      title: typeof o.title === "string" ? o.title : deriveSessionTitle(messages),
      messages: messages.slice(-AI_CHAT_MAX_MESSAGES_PER_SESSION),
      createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
    });
  }
  return pruneSessions(sessions);
}

/** JSON blob stored in Postgres for signed-in users. */
export function serializeAiChatForServer(sessions: AiChatSession[], activeId: string | null): string {
  const pruned = pruneSessions(sessions).map((s) => ({
    ...s,
    messages: stripAttachmentsFromMessages(s.messages),
  }));
  return JSON.stringify({ sessions: pruned, activeId: activeId ?? null });
}

export function parseAiChatFromServerPayload(payload: string): { sessions: AiChatSession[]; activeId: string | null } {
  if (!payload?.trim()) return { sessions: [], activeId: null };
  try {
    const o = JSON.parse(payload) as { sessions?: unknown; activeId?: unknown };
    const sessions = parseSessionsArray(o.sessions);
    const activeRaw = o.activeId;
    const activeId = typeof activeRaw === "string" && activeRaw.trim() ? activeRaw.trim() : null;
    return { sessions, activeId };
  } catch {
    return { sessions: [], activeId: null };
  }
}

export async function fetchAiChatStateFromServer(): Promise<{ sessions: AiChatSession[]; activeId: string | null } | null> {
  try {
    const res = await fetch("/api/me/ai-chat");
    if (!res.ok) return null;
    const data = (await res.json()) as { payload?: string };
    return parseAiChatFromServerPayload(typeof data.payload === "string" ? data.payload : "");
  } catch {
    return null;
  }
}

export async function pushAiChatStateToServer(sessions: AiChatSession[], activeId: string | null): Promise<boolean> {
  try {
    const res = await fetch("/api/me/ai-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: serializeAiChatForServer(sessions, activeId) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Shape for POST /api/committee-chat */
export function aiChatMessageToWire(m: AiChatMessage): Record<string, unknown> {
  if (m.role === "assistant") {
    return { role: "assistant", content: m.content };
  }
  const u = m as AiChatUserMessage;
  const body: Record<string, unknown> = { role: "user", content: u.content ?? "" };
  if (u.attachments?.length) {
    body.attachments = u.attachments.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
      data: a.data,
    }));
  }
  return body;
}
