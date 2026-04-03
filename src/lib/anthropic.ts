/**
 * Server-only Anthropic API client. Uses ANTHROPIC_API_KEY from env.
 * Do not import or use in client components.
 */

import { conversationHasPdf, type ChatConversationTurn, type ChatUserContentPart } from "@/lib/chat-multimodal-types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/** @deprecated Use ChatConversationTurn for multimodal; string-only turns are still valid. */
export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ClaudeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

/** Web search tool for Claude to browse the internet. Must be enabled in Anthropic Console. */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
} as const;

/**
 * Call Anthropic Messages API. Returns result with text or error details.
 * API key must be set in ANTHROPIC_API_KEY.
 * Pass tools: [WEB_SEARCH_TOOL] to allow Claude to search the web.
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  options: {
    maxTokens?: number;
    model?: string;
    tools?: readonly { type: string; name: string; max_uses?: number }[];
  } = {}
): Promise<ClaudeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key?.trim()) {
    console.error("ANTHROPIC_API_KEY is not set");
    return { ok: false, error: "API key not set" };
  }

  const defaultModel = process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001";
  const { maxTokens = 2048, model = defaultModel, tools } = options;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      // Avoid letting undici's implicit headers timeout turn into a browser-side "fetch failed".
      signal: AbortSignal.timeout(120_000),
    });

    const errBody = await res.text();
    if (!res.ok) {
      console.error("Anthropic API error:", res.status, errBody);
      if (res.status === 401) {
        return { ok: false, error: "Invalid API key", status: 401 };
      }
      if (res.status === 429) {
        return { ok: false, error: "Rate limit exceeded", status: 429 };
      }
      try {
        const parsed = JSON.parse(errBody) as { error?: { type?: string; message?: string } };
        const t = (parsed?.error?.type || "").toLowerCase();
        const msg = (parsed?.error?.message || "").toLowerCase();
        if (t.includes("overload") || msg.includes("overload")) {
          return { ok: false, error: "Claude is overloaded right now — wait ~30–60s and retry.", status: res.status };
        }
      } catch {
        // ignore
      }
      return { ok: false, error: errBody || `HTTP ${res.status}`, status: res.status };
    }

    let data: { content?: Array<{ type: string; text?: string }> };
    try {
      data = JSON.parse(errBody) as { content?: Array<{ type: string; text?: string }> };
    } catch {
      return { ok: false, error: "Invalid response from API" };
    }
    const parts = (data.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => (c as { text: string }).text);
    const text = parts.length > 0 ? parts.join("").trim() : null;
    if (!text) return { ok: false, error: "Empty response from API" };
    return { ok: true, text };
  } catch (e) {
    console.error("Anthropic request failed:", e);
    const msg = e instanceof Error ? e.message : "Network error";
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "UND_ERR_HEADERS_TIMEOUT" || msg.toLowerCase().includes("headers timeout")) {
      return { ok: false, error: "Claude request timed out (provider slow/overloaded). Retry in ~30–60s.", status: 504 };
    }
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "Claude request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}

function normalizeUserContentForApi(content: string | ChatUserContentPart[]): string | ChatUserContentPart[] {
  if (typeof content === "string") return content;
  return content;
}

/**
 * Multi-turn Messages API call. `messages` must alternate user / assistant, start with user, and end with user.
 * User turns may use multimodal `content` arrays (images, PDF documents, text).
 */
export async function callClaudeConversation(
  systemPrompt: string,
  messages: ChatConversationTurn[],
  options: {
    maxTokens?: number;
    model?: string;
    tools?: readonly { type: string; name: string; max_uses?: number }[];
  } = {}
): Promise<ClaudeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key?.trim()) {
    console.error("ANTHROPIC_API_KEY is not set");
    return { ok: false, error: "API key not set" };
  }

  const defaultModel = process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001";
  const { maxTokens = 4096, model = defaultModel, tools } = options;

  const usePdfBeta = conversationHasPdf(messages);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? m.content : normalizeUserContentForApi(m.content),
    })),
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        ...(usePdfBeta ? { "anthropic-beta": "pdfs-2024-09-25" } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    const errBody = await res.text();
    if (!res.ok) {
      console.error("Anthropic API error:", res.status, errBody);
      if (res.status === 401) {
        return { ok: false, error: "Invalid API key", status: 401 };
      }
      if (res.status === 429) {
        return { ok: false, error: "Rate limit exceeded", status: 429 };
      }
      try {
        const parsed = JSON.parse(errBody) as { error?: { type?: string; message?: string } };
        const t = (parsed?.error?.type || "").toLowerCase();
        const msg = (parsed?.error?.message || "").toLowerCase();
        if (t.includes("overload") || msg.includes("overload")) {
          return { ok: false, error: "Claude is overloaded right now — wait ~30–60s and retry.", status: res.status };
        }
      } catch {
        // ignore
      }
      return { ok: false, error: errBody || `HTTP ${res.status}`, status: res.status };
    }

    let data: { content?: Array<{ type: string; text?: string }> };
    try {
      data = JSON.parse(errBody) as { content?: Array<{ type: string; text?: string }> };
    } catch {
      return { ok: false, error: "Invalid response from API" };
    }
    const parts = (data.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => (c as { text: string }).text);
    const text = parts.length > 0 ? parts.join("").trim() : null;
    if (!text) return { ok: false, error: "Empty response from API" };
    return { ok: true, text };
  } catch (e) {
    console.error("Anthropic request failed:", e);
    const msg = e instanceof Error ? e.message : "Network error";
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "UND_ERR_HEADERS_TIMEOUT" || msg.toLowerCase().includes("headers timeout")) {
      return { ok: false, error: "Claude request timed out (provider slow/overloaded). Retry in ~30–60s.", status: 504 };
    }
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "Claude request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}
