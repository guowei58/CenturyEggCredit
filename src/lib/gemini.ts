/**
 * Server-only Gemini via Google Generative Language OpenAI-compatible API.
 * Uses GEMINI_API_KEY (never exposed to the client).
 *
 * @see https://ai.google.dev/gemini-api/docs/openai
 */

import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";

/** OpenAI-compatible Gemini API base (see Google Generative Language docs). */
const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_OPENAI_CHAT_URL = `${GEMINI_OPENAI_BASE}/chat/completions`;

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

function normalizeGeminiApiError(status: number, raw: string): GeminiResult {
  try {
    const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string; code?: string } };
    const msg = (parsed?.error?.message || "").trim();
    if (msg) return { ok: false, error: msg.slice(0, 400), status };
  } catch {
    // ignore
  }
  if (status === 401 || status === 403) {
    return { ok: false, error: "Invalid or missing Gemini API key (check GEMINI_API_KEY).", status };
  }
  if (status === 429) return { ok: false, error: "Gemini rate limit exceeded", status: 429 };
  return { ok: false, error: raw?.slice(0, 400) || `HTTP ${status}`, status };
}

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  options: { maxTokens?: number; model?: string } = {}
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) {
    return { ok: false, error: "GEMINI_API_KEY is not set" };
  }

  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const maxTokens = options.maxTokens ?? 4096;

  try {
    const res = await fetch(GEMINI_OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key.trim()}`,
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
      return normalizeGeminiApiError(res.status, raw);
    }

    let data: { choices?: Array<{ message?: { content?: string | null } }> };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, error: "Invalid JSON from Gemini" };
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, error: "Empty response from Gemini" };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gemini network error";
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "Gemini request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}

type GeminiMultimodalUserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function geminiUserContentFromParts(parts: ChatUserContentPart[]): GeminiMultimodalUserPart[] {
  const out: GeminiMultimodalUserPart[] = [];
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

function geminiUserMessageContent(content: string | ChatUserContentPart[]): string | GeminiMultimodalUserPart[] {
  if (typeof content === "string") return content;
  return geminiUserContentFromParts(content);
}

/**
 * Multi-turn chat (OpenAI-compatible). PDF blocks are rejected upstream in llm-router (same as OpenAI).
 */
export async function callGeminiConversation(
  systemPrompt: string,
  messages: ChatConversationTurn[],
  options: { maxTokens?: number; model?: string } = {}
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) {
    return { ok: false, error: "GEMINI_API_KEY is not set" };
  }

  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const maxTokens = options.maxTokens ?? 4096;

  const apiMessages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: string | GeminiMultimodalUserPart[] }
    | { role: "assistant"; content: string }
  > = [{ role: "system", content: systemPrompt }];

  for (const m of messages) {
    if (m.role === "assistant") {
      apiMessages.push({ role: "assistant", content: m.content });
    } else {
      apiMessages.push({ role: "user", content: geminiUserMessageContent(m.content) });
    }
  }

  try {
    const res = await fetch(GEMINI_OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key.trim()}`,
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
      return normalizeGeminiApiError(res.status, raw);
    }

    let data: { choices?: Array<{ message?: { content?: string | null } }> };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, error: "Invalid JSON from Gemini" };
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, error: "Empty response from Gemini" };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gemini network error";
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "Gemini request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}
