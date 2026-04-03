/**
 * Server-only OpenAI Chat Completions API. Uses OPENAI_API_KEY.
 */

import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export type OpenAIResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

export type OpenAIMessage = { role: "user" | "assistant" | "system"; content: string };

export async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  options: { maxTokens?: number; model?: string } = {}
): Promise<OpenAIResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) {
    return { ok: false, error: "OPENAI_API_KEY is not set" };
  }

  const model = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const maxTokens = options.maxTokens ?? 4096;

  const normalizeApiError = (status: number, raw: string): OpenAIResult => {
    // Prefer friendly, stable messages over raw provider payloads.
    try {
      const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string; code?: string } };
      const t = (parsed?.error?.type || "").toLowerCase();
      const msg = (parsed?.error?.message || "").toLowerCase();
      const code = (parsed?.error?.code || "").toLowerCase();
      if (t === "overloaded_error" || code === "overloaded" || msg.includes("overloaded")) {
        return { ok: false, error: "OpenAI is overloaded right now — wait ~30–60s and retry.", status };
      }
    } catch {
      // ignore
    }
    if (status === 401) return { ok: false, error: "Invalid OpenAI API key", status: 401 };
    if (status === 429) return { ok: false, error: "OpenAI rate limit exceeded", status: 429 };
    return { ok: false, error: raw?.slice(0, 400) || `HTTP ${status}`, status };
  };

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const raw = await res.text();
    if (!res.ok) {
      return normalizeApiError(res.status, raw);
    }

    let data: { choices?: Array<{ message?: { content?: string | null } }> };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, error: "Invalid JSON from OpenAI" };
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, error: "Empty response from OpenAI" };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI network error";
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "UND_ERR_HEADERS_TIMEOUT" || msg.toLowerCase().includes("headers timeout")) {
      return { ok: false, error: "OpenAI request timed out (provider slow/overloaded). Retry in ~30–60s.", status: 504 };
    }
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "OpenAI request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}

type OpenAIMultimodalUserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function openAIUserContentFromParts(parts: ChatUserContentPart[]): OpenAIMultimodalUserPart[] {
  const out: OpenAIMultimodalUserPart[] = [];
  for (const p of parts) {
    if (p.type === "text") {
      out.push({ type: "text", text: p.text });
    } else if (p.type === "image") {
      const url = `data:${p.source.media_type};base64,${p.source.data}`;
      out.push({ type: "image_url", image_url: { url } });
    }
  }
  return out;
}

function openAIUserMessageContent(content: string | ChatUserContentPart[]): string | OpenAIMultimodalUserPart[] {
  if (typeof content === "string") return content;
  return openAIUserContentFromParts(content);
}

/**
 * Multi-turn chat. `messages` must alternate user/assistant, start and end with user (same contract as committee-chat).
 * Prepends `systemPrompt` as a system message. User turns may include images (vision); PDF blocks are not supported here.
 */
export async function callOpenAIConversation(
  systemPrompt: string,
  messages: ChatConversationTurn[],
  options: { maxTokens?: number; model?: string } = {}
): Promise<OpenAIResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) {
    return { ok: false, error: "OPENAI_API_KEY is not set" };
  }

  const model = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const maxTokens = options.maxTokens ?? 4096;

  const normalizeApiError = (status: number, raw: string): OpenAIResult => {
    try {
      const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string; code?: string } };
      const t = (parsed?.error?.type || "").toLowerCase();
      const msg = (parsed?.error?.message || "").toLowerCase();
      const code = (parsed?.error?.code || "").toLowerCase();
      if (t === "overloaded_error" || code === "overloaded" || msg.includes("overloaded")) {
        return { ok: false, error: "OpenAI is overloaded right now — wait ~30–60s and retry.", status };
      }
    } catch {
      // ignore
    }
    if (status === 401) return { ok: false, error: "Invalid OpenAI API key", status: 401 };
    if (status === 429) return { ok: false, error: "OpenAI rate limit exceeded", status: 429 };
    return { ok: false, error: raw?.slice(0, 400) || `HTTP ${status}`, status };
  };

  const apiMessages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: string | OpenAIMultimodalUserPart[] }
    | { role: "assistant"; content: string }
  > = [{ role: "system", content: systemPrompt }];

  for (const m of messages) {
    if (m.role === "assistant") {
      apiMessages.push({ role: "assistant", content: m.content });
    } else {
      apiMessages.push({ role: "user", content: openAIUserMessageContent(m.content) });
    }
  }

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const raw = await res.text();
    if (!res.ok) {
      return normalizeApiError(res.status, raw);
    }

    let data: { choices?: Array<{ message?: { content?: string | null } }> };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, error: "Invalid JSON from OpenAI" };
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, error: "Empty response from OpenAI" };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI network error";
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "UND_ERR_HEADERS_TIMEOUT" || msg.toLowerCase().includes("headers timeout")) {
      return { ok: false, error: "OpenAI request timed out (provider slow/overloaded). Retry in ~30–60s.", status: 504 };
    }
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "OpenAI request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}
