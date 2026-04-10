"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSession } from "next-auth/react";
import { SavedRichText } from "@/components/SavedRichText";
import {
  AI_CHAT_MAX_MESSAGES_PER_SESSION,
  type AiChatAttachment,
  type AiChatMessage,
  type AiChatSession,
  type AiChatUserMessage,
  aiChatMessageToWire,
  createAiChatSession,
  deriveSessionTitle,
  fetchAiChatStateFromServer,
  markAiChatViewedNow,
  OREO_AI_CHAT_WAITING_REPLY_KEY,
  pruneSessions,
  pushAiChatStateToServer,
} from "@/lib/ai-chat-sessions";
import {
  prepareFileForAiChat,
  readTextFileForAppend,
} from "@/lib/ai-chat-attachments-client";
import { aiProviderChipStyle, type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { GEMINI_UI_BUTTON_COLOR } from "@/lib/gemini-open-url";
import { modelOverridePayloadForProvider } from "@/lib/ai-model-prefs-client";
import { AiModelPicker } from "@/components/AiModelPicker";
import { USER_LLM_API_KEYS_POLICY } from "@/lib/llm-user-key-messages";

const CHAT_SUGGESTIONS = ["LUMN full analysis", "Peer leverage: LUMN vs T", "Covenant summary"];

const MAX_PENDING_ATTACHMENTS = 8;

export function ChatDrawer({
  open,
  onOpen,
  onClose,
  ticker,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Sidebar ticker for AI context (optional). */
  ticker?: string | null;
}) {
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const persistRemoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionsHydrated, setSessionsHydrated] = useState(false);
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AiChatAttachment[]>([]);
  const [dragOverInput, setDragOverInput] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which message bubble last triggered copy (`${sessionId}-${i}-${role}`). */
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [anthropicConfigured, setAnthropicConfigured] = useState<boolean | null>(null);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  /** DeepSeek key/config from GET /api/committee-chat; null until first fetch. */
  const [deepseekConfigured, setDeepseekConfigured] = useState<boolean | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>("claude");
  /** When true and a sidebar ticker is set, POST includes saved OREO text (responses + Saved Documents .txt/.md). */
  const [includeOreoContext, setIncludeOreoContext] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const pendingAttachmentsRef = useRef<AiChatAttachment[]>([]);
  /** Always matches latest `messages` so POST body is built synchronously (not inside setState). */
  const messagesRef = useRef<AiChatMessage[]>([]);

  const messages = useMemo((): AiChatMessage[] => {
    if (!activeSessionId) return [];
    return sessions.find((s) => s.id === activeSessionId)?.messages ?? [];
  }, [sessions, activeSessionId]);

  messagesRef.current = messages;
  pendingAttachmentsRef.current = pendingAttachments;

  useEffect(() => {
    if (authStatus === "loading") return;
    let cancelled = false;

    void (async () => {
      if (authStatus !== "authenticated") {
        const s = createAiChatSession();
        if (!cancelled) {
          setSessions([s]);
          setActiveSessionId(s.id);
          setSessionsHydrated(true);
        }
        return;
      }

      const remote = await fetchAiChatStateFromServer();
      if (cancelled) return;
      if (remote && remote.sessions.length > 0) {
        setSessions(remote.sessions);
        const id =
          remote.activeId && remote.sessions.some((x) => x.id === remote.activeId)
            ? remote.activeId
            : remote.sessions[0].id;
        setActiveSessionId(id);
        setSessionsHydrated(true);
        return;
      }
      const s = createAiChatSession();
      setSessions([s]);
      setActiveSessionId(s.id);
      setSessionsHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  useEffect(() => {
    if (!sessionsHydrated) return;
    if (authStatus !== "authenticated") return;
    if (persistRemoteTimerRef.current) clearTimeout(persistRemoteTimerRef.current);
    persistRemoteTimerRef.current = setTimeout(() => {
      void pushAiChatStateToServer(sessions, activeSessionId);
    }, 800);
    return () => {
      if (persistRemoteTimerRef.current) clearTimeout(persistRemoteTimerRef.current);
    };
  }, [sessions, activeSessionId, sessionsHydrated, authStatus]);

  useEffect(() => {
    if (!sessionsHydrated || sessions.length === 0) return;
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId, sessionsHydrated]);

  useEffect(() => {
    if (!prefsReady) return;
    const n = normalizeAiProvider(preferences.aiProvider);
    if (n) setAiProvider(n);
    if (preferences.includeOreoContext !== undefined) {
      setIncludeOreoContext(preferences.includeOreoContext);
    }
  }, [prefsReady, preferences.aiProvider, preferences.includeOreoContext]);

  const persistProvider = useCallback(
    (p: AiProvider) => {
      setAiProvider(p);
      updatePreferences((prev) => ({ ...prev, aiProvider: p }));
    },
    [updatePreferences]
  );

  const refreshConfigured = useCallback(async () => {
    try {
      const res = await fetch("/api/committee-chat");
      const body = (await res.json()) as {
        anthropicConfigured?: boolean;
        openaiConfigured?: boolean;
        geminiConfigured?: boolean;
        deepseek?: { configured?: boolean };
      };
      setAnthropicConfigured(body.anthropicConfigured === true);
      setOpenaiConfigured(body.openaiConfigured === true);
      setGeminiConfigured(body.geminiConfigured === true);
      setDeepseekConfigured(body.deepseek?.configured === true);
    } catch {
      setAnthropicConfigured(false);
      setOpenaiConfigured(false);
      setGeminiConfigured(false);
      setDeepseekConfigured(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshConfigured();
  }, [open, refreshConfigured]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, messages, pending]);

  useEffect(() => {
    if (!open) return;
    markAiChatViewedNow();
  }, [open, messages, pending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (pending && !open) {
        sessionStorage.setItem(OREO_AI_CHAT_WAITING_REPLY_KEY, "1");
      } else {
        sessionStorage.removeItem(OREO_AI_CHAT_WAITING_REPLY_KEY);
      }
    } catch {
      /* private mode */
    }
  }, [pending, open]);

  const providerReady =
    aiProvider === "claude"
      ? anthropicConfigured === true
      : aiProvider === "openai"
        ? openaiConfigured === true
        : aiProvider === "gemini"
          ? geminiConfigured === true
          : deepseekConfigured === true;
  const assistantLabel =
    aiProvider === "openai"
      ? "ChatGPT"
      : aiProvider === "gemini"
        ? "Gemini"
        : aiProvider === "deepseek"
          ? "DeepSeek"
          : "Claude";

  const patchActiveMessages = useCallback(
    (updater: AiChatMessage[] | ((prev: AiChatMessage[]) => AiChatMessage[])) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === activeSessionId);
        if (idx < 0) return prev;
        const cur = prev[idx];
        const nextMsgs =
          typeof updater === "function" ? (updater as (p: AiChatMessage[]) => AiChatMessage[])(cur.messages) : updater;
        const capped = nextMsgs.slice(-AI_CHAT_MAX_MESSAGES_PER_SESSION);
        const updated: AiChatSession = {
          ...cur,
          messages: capped,
          updatedAt: new Date().toISOString(),
          title: deriveSessionTitle(capped),
        };
        const copy = [...prev];
        copy[idx] = updated;
        return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    },
    [activeSessionId]
  );

  const sessionsSorted = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions]
  );

  const addFilesFromList = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setError(null);
    const newBinary: AiChatAttachment[] = [];
    for (const file of list) {
      const textAppend = await readTextFileForAppend(file);
      if (textAppend !== null) {
        setInput((prev) => {
          const block = `[${file.name}]\n${textAppend}`;
          return prev.trim() ? `${prev.trim()}\n\n${block}` : block;
        });
        continue;
      }
      const prep = await prepareFileForAiChat(file);
      if (!prep.ok) {
        setError(prep.error);
        continue;
      }
      newBinary.push({
        id:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: prep.name,
        mediaType: prep.mediaType,
        data: prep.data,
      });
    }
    if (!newBinary.length) return;
    const room = Math.max(0, MAX_PENDING_ATTACHMENTS - pendingAttachmentsRef.current.length);
    if (room === 0) {
      setError(`At most ${MAX_PENDING_ATTACHMENTS} files per message.`);
      return;
    }
    const take = newBinary.slice(0, room);
    if (take.length < newBinary.length) {
      setError(`At most ${MAX_PENDING_ATTACHMENTS} files per message.`);
    }
    setPendingAttachments((prev) => [...prev, ...take]);
  }, []);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const copyMessageToClipboard = useCallback(async (key: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setCopiedMessageKey(key);
      window.setTimeout(() => {
        setCopiedMessageKey((cur) => (cur === key ? null : cur));
      }, 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }, []);

  const submitMessage = useCallback(
    async (override?: string) => {
      if (!activeSessionId) return;
      const text = (override ?? input).trim();
      const atSnapshot = [...pendingAttachments];
      if ((!text && atSnapshot.length === 0) || pendingRef.current) return;

      const savedInput = input;
      const savedPending = atSnapshot;
      if (override === undefined) setInput("");
      setPendingAttachments([]);
      setError(null);

      pendingRef.current = true;
      setPending(true);

      const userMsg: AiChatUserMessage = {
        role: "user",
        content: text,
        ...(atSnapshot.length
          ? {
              attachments: atSnapshot.map(({ id, name, mediaType, data }) => ({
                id,
                name,
                mediaType,
                data,
              })),
            }
          : {}),
      };

      const historyForApi: AiChatMessage[] = [...messagesRef.current, userMsg];
      patchActiveMessages(historyForApi);

      try {
        const res = await fetch("/api/committee-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi.map(aiChatMessageToWire),
            ticker: ticker?.trim() || undefined,
            provider: aiProvider,
            includeOreoContext: ticker?.trim() ? includeOreoContext : undefined,
            ...modelOverridePayloadForProvider(aiProvider),
          }),
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
        if (!res.ok || body?.ok !== true || typeof body.text !== "string") {
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        const assistantText = body.text;
        patchActiveMessages((m) => {
          const copy = [...m];
          const ui = copy.length - 1;
          const last = copy[ui] as AiChatUserMessage;
          if (last?.role === "user" && last.attachments?.length) {
            const names = last.attachments.map((a) => a.name).join(", ");
            copy[ui] = {
              role: "user",
              content: `${last.content || ""}\n\n[Attached: ${names}]`.trim(),
            };
          }
          copy.push({ role: "assistant", content: assistantText });
          return copy;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        patchActiveMessages((m) => m.slice(0, -1));
        if (override === undefined) setInput(savedInput);
        setPendingAttachments(savedPending);
      } finally {
        pendingRef.current = false;
        setPending(false);
        requestAnimationFrame(() => {
          chatInputRef.current?.focus();
        });
      }
    },
    [
      input,
      pendingAttachments,
      ticker,
      aiProvider,
      includeOreoContext,
      patchActiveMessages,
      activeSessionId,
    ]
  );

  function startNewChat() {
    const s = createAiChatSession();
    setSessions((prev) => pruneSessions([s, ...prev]));
    setActiveSessionId(s.id);
    setError(null);
    setInput("");
    setPendingAttachments([]);
  }

  function selectSession(id: string) {
    setActiveSessionId(id);
    setError(null);
    setInput("");
    setPendingAttachments([]);
  }

  function deleteSession(id: string, e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      return next.length === 0 ? [createAiChatSession()] : next;
    });
  }

  return (
    <>
      <div
        className="fixed bottom-0 right-0 z-[199] flex h-full w-[min(100vw,580px)] flex-row border-l transition-transform duration-200 ease-out"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        <aside
          className="flex w-[124px] flex-shrink-0 flex-col border-r sm:w-[148px]"
          style={{ background: "var(--sb)", borderColor: "var(--border)" }}
        >
          <div
            className="flex-shrink-0 border-b px-2 py-2.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--muted2)", borderColor: "var(--border)" }}
          >
            Chats
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {sessionsSorted.map((s) => {
              const active = s.id === activeSessionId;
              const shortDate = (() => {
                try {
                  return new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                } catch {
                  return "";
                }
              })();
              return (
                <div key={s.id} className="group relative mb-1">
                  <button
                    type="button"
                    onClick={() => selectSession(s.id)}
                    className="w-full rounded border px-1.5 py-1.5 text-left text-[11px] leading-snug transition-colors"
                    style={{
                      borderColor: active ? "var(--accent)" : "var(--border2)",
                      background: active ? "rgba(0,212,170,0.12)" : "var(--card)",
                      color: "var(--text)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span className="line-clamp-2">{s.title || "New chat"}</span>
                    {shortDate ? (
                      <span className="mt-0.5 block text-[9px] font-normal" style={{ color: "var(--muted)" }}>
                        {shortDate}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => deleteSession(s.id, e)}
                    className="absolute right-0.5 top-0.5 rounded px-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--danger)] hover:text-white"
                    style={{ color: "var(--muted2)" }}
                    aria-label="Delete chat"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex flex-shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-5 sm:py-4"
            style={{ background: "var(--sb)", borderColor: "var(--border)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold tracking-tight" style={{ color: "var(--text)" }}>
                AI Chat
              </div>
              <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                {anthropicConfigured === null ||
                openaiConfigured === null ||
                geminiConfigured === null ||
                deepseekConfigured === null
                  ? "Checking API…"
                  : providerReady
                    ? `Chat with ${assistantLabel} (${
                        aiProvider === "openai"
                          ? "OpenAI API"
                          : aiProvider === "gemini"
                            ? "Google Gemini API"
                            : aiProvider === "deepseek"
                              ? "DeepSeek API"
                              : "Anthropic API"
                      })`
                    : aiProvider === "deepseek"
                      ? "Add your DeepSeek API key in User Settings (gear icon), or use a hosted account with DEEPSEEK_API_KEY on the server."
                      : aiProvider === "gemini"
                        ? "Add your Gemini API key in User Settings (gear icon), or paste from the Gemini website."
                        : "Add your Claude or OpenAI API key in User Settings (gear icon), or use the external AI buttons in each tab."}
              </div>
              <div className="mt-2 inline-flex flex-wrap rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
                <button
                  type="button"
                  onClick={() => persistProvider("claude")}
                  className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide"
                  style={aiProviderChipStyle(aiProvider, "claude")}
                >
                  Claude
                </button>
                <button
                  type="button"
                  onClick={() => persistProvider("openai")}
                  className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "openai") }}
                >
                  ChatGPT
                </button>
                <button
                  type="button"
                  onClick={() => persistProvider("gemini")}
                  className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "gemini") }}
                  title="Google Gemini (GEMINI_API_KEY / GEMINI_MODEL)"
                >
                  Gemini
                </button>
                <button
                  type="button"
                  onClick={() => persistProvider("deepseek")}
                  className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "deepseek") }}
                  title="DeepSeek (DEEPSEEK_API_KEY / DEEPSEEK_MODEL or User Settings)"
                >
                  DeepSeek
                </button>
              </div>
              <AiModelPicker provider={aiProvider} className="mt-2" />
              {ticker?.trim() ? (
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                  <input
                    type="checkbox"
                    checked={includeOreoContext}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setIncludeOreoContext(v);
                      updatePreferences((prev) => ({ ...prev, includeOreoContext: v }));
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    Include saved OREO data for <span className="font-mono">{ticker.trim().toUpperCase()}</span> (tab saves, credit
                    agreement text, .txt/.md in Saved Documents). PDFs are listed but not read automatically.
                  </span>
                </label>
              ) : null}
            </div>
            <button
              type="button"
              onClick={startNewChat}
              className="flex-shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              New chat
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 rounded-md p-1.5 transition-colors hover:bg-[var(--card)]"
              style={{ color: "var(--muted2)" }}
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            providerReady || aiProvider !== "deepseek" ? (
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
                  {assistantLabel}
                </div>
                <div
                  className="rounded-lg border p-4 text-sm leading-relaxed"
                  style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {providerReady ? (
                    <>
                      Ask about covenants, capital structure, peers, or trade angles — {assistantLabel} answers here
                      {aiProvider === "deepseek" ? (
                        <> using the <span className="font-semibold">DeepSeek</span> API (text-only in this chat; use Claude or ChatGPT for PDF/images).</>
                      ) : (
                        <>
                          {" "}
                          using the API key saved in <strong>User Settings</strong> (gear icon). Paste or drop <strong>PDFs</strong> and{" "}
                          <strong>images</strong> into the box below (like the Claude / ChatGPT web app). <strong>PDF</strong> uploads use
                          Claude best; ChatGPT and Gemini here support <strong>images</strong> only.
                        </>
                      )}
                      {ticker?.trim() ? (
                        <>
                          {" "}
                          Sidebar ticker <span className="font-mono">{ticker.trim().toUpperCase()}</span> is sent as context.
                        </>
                      ) : (
                        <> Pick a ticker in the sidebar for extra context.</>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-2">
                        Pick <strong>Claude</strong>, <strong>ChatGPT</strong>, <strong>Gemini</strong>, or <strong>DeepSeek</strong> in the
                        header first.
                      </p>
                      <p className="mb-2 whitespace-pre-line text-[12px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                        {USER_LLM_API_KEYS_POLICY}
                      </p>
                      <p>
                        For DeepSeek add <span className="font-mono">DEEPSEEK_API_KEY</span> in server env (hosted accounts) or save a key
                        under User Settings.
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : null
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m, i) => {
                const bubbleKey = `${activeSessionId ?? "x"}-${i}-${m.role}`;
                const u = m.role === "user" ? (m as AiChatUserMessage) : null;
                const userCopyText =
                  u != null
                    ? [
                        u.content?.trim() ?? "",
                        u.attachments?.length
                          ? `[Attached: ${u.attachments.map((a) => a.name).join(", ")}]`
                          : "",
                      ]
                        .filter(Boolean)
                        .join("\n\n")
                    : "";
                const assistantCopyText = m.role === "assistant" ? m.content : "";
                const copyText = m.role === "user" ? userCopyText : assistantCopyText;
                const canCopy = copyText.trim().length > 0;

                return (
                  <div key={bubbleKey}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
                        {m.role === "user" ? "You" : assistantLabel}
                      </div>
                      {canCopy ? (
                        <button
                          type="button"
                          onClick={() => void copyMessageToClipboard(bubbleKey, copyText)}
                          className="rounded border px-2 py-0.5 text-[9px] font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          style={{
                            borderColor: "var(--border2)",
                            color: copiedMessageKey === bubbleKey ? "var(--accent)" : "var(--muted2)",
                            background: "var(--card)",
                          }}
                          aria-label={m.role === "user" ? "Copy question" : "Copy answer"}
                        >
                          {copiedMessageKey === bubbleKey ? "Copied!" : "Copy"}
                        </button>
                      ) : null}
                    </div>
                    {m.role === "user" ? (
                      <div
                        className="rounded-lg border p-3 text-sm leading-relaxed"
                        style={{
                          background: "var(--card2)",
                          borderColor: "var(--accent)",
                          color: "var(--text)",
                        }}
                      >
                        {u != null ? (
                          <>
                            {u.attachments && u.attachments.length > 0 ? (
                              <div className="mb-2 flex flex-wrap gap-2">
                                {u.attachments.map((a) =>
                                  a.mediaType.startsWith("image/") ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- user-provided data URL
                                    <img
                                      key={a.id}
                                      alt=""
                                      className="max-h-36 max-w-full rounded border object-contain"
                                      style={{ borderColor: "var(--border2)" }}
                                      src={`data:${a.mediaType};base64,${a.data}`}
                                    />
                                  ) : (
                                    <span
                                      key={a.id}
                                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                                      style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
                                    >
                                      📄 {a.name}
                                    </span>
                                  )
                                )}
                              </div>
                            ) : null}
                            {u.content ? <div className="whitespace-pre-wrap">{u.content}</div> : null}
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        className="rounded-lg border p-3 text-sm leading-relaxed"
                        style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                      >
                        <SavedRichText content={m.content} />
                      </div>
                    )}
                  </div>
                );
              })}
              {pending && (
                <div className="text-xs italic" style={{ color: "var(--muted)" }}>
                  {assistantLabel} is thinking…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
          {error && (
            <p className="mt-3 text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="flex flex-shrink-0 flex-col gap-3 border-t p-4"
          style={{ background: "var(--sb)", borderColor: "var(--border)" }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.md,.csv,.json"
            onChange={(e) => {
              const fl = e.target.files;
              e.target.value = "";
              if (fl?.length) void addFilesFromList(fl);
            }}
          />
          {pendingAttachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((a) => (
                <div
                  key={a.id}
                  className="group relative flex max-w-[140px] items-center gap-1 rounded border px-2 py-1 text-[10px]"
                  style={{ borderColor: "var(--border2)", background: "var(--card)" }}
                >
                  {a.mediaType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                      src={`data:${a.mediaType};base64,${a.data}`}
                    />
                  ) : (
                    <span className="truncate" style={{ color: "var(--muted2)" }}>
                      📄 {a.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(a.id)}
                    className="ml-auto rounded px-1 text-[12px] leading-none opacity-70 hover:opacity-100"
                    style={{ color: "var(--danger)" }}
                    aria-label={`Remove ${a.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <div
              className="relative min-w-0 flex-1"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverInput(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverInput(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverInput(false);
                if (e.dataTransfer.files?.length) void addFilesFromList(e.dataTransfer.files);
              }}
            >
              {dragOverInput ? (
                <div
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed text-xs font-medium"
                  style={{
                    borderColor: "var(--accent)",
                    background: "rgba(0,212,170,0.08)",
                    color: "var(--accent)",
                  }}
                >
                  Drop files here
                </div>
              ) : null}
              <textarea
                ref={chatInputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const files = e.clipboardData?.files;
                  if (files && files.length > 0) {
                    e.preventDefault();
                    void addFilesFromList(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitMessage();
                  }
                }}
                placeholder={
                  !providerReady &&
                  anthropicConfigured !== null &&
                  openaiConfigured !== null &&
                  geminiConfigured !== null &&
                  deepseekConfigured !== null
                    ? aiProvider === "deepseek"
                      ? "Add a DeepSeek API key (User Settings or server DEEPSEEK_API_KEY)…"
                      : "Configure API key for the selected model…"
                    : "Type a question, paste or drop PDF / images, or attach files…"
                }
                rows={2}
                disabled={pending || !providerReady}
                className="min-h-[44px] max-h-[120px] w-full resize-y rounded-lg border bg-[var(--card)] px-3 py-2.5 pr-10 text-sm leading-snug text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
                style={{ borderColor: dragOverInput ? "var(--accent)" : "var(--border)" }}
              />
              <button
                type="button"
                disabled={pending || !providerReady}
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-2 right-2 rounded p-1 text-base opacity-60 hover:opacity-100 disabled:opacity-30"
                style={{ color: "var(--muted2)" }}
                title="Attach files"
                aria-label="Attach files"
              >
                📎
              </button>
            </div>
            <button
              type="button"
              disabled={pending || (!input.trim() && pendingAttachments.length === 0) || !providerReady}
              onClick={() => void submitMessage()}
              className="flex-shrink-0 self-end rounded-lg px-3 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
              style={{
                background: aiProvider === "gemini" ? GEMINI_UI_BUTTON_COLOR : "var(--accent)",
              }}
            >
              ↑
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHAT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={pending || !providerReady}
                onClick={() => void submitMessage(s)}
                className="rounded-full border px-2.5 py-1.5 text-[10px] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                style={{ background: "var(--card)", borderColor: "var(--border2)", color: "var(--muted2)" }}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[9px] leading-snug" style={{ color: "var(--muted2)" }}>
            .txt / .md / .csv paste as text. Large files are capped (~5 MB each, 8 per message). History keeps file names only, not
            full files. For peer chat, open <strong>Egg-Hoc Committee Chat</strong> (Pari Passu Pals).
          </p>
        </div>
        </div>
      </div>
    </>
  );
}
