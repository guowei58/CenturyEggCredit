/**
 * Server-only Gemini via Google Generative Language OpenAI-compatible API.
 * Uses GEMINI_API_KEY (never exposed to the client).
 *
 * @see https://ai.google.dev/gemini-api/docs/openai
 */

import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";
import { augmentLlmFullSystemPrompt } from "@/lib/llm-datetime-context";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

function resolveGeminiKey(apiKeys: LlmCallApiKeys | undefined): { key: string } | { error: string } {
  const legacy = apiKeys === undefined;
  const key = legacy ? process.env.GEMINI_API_KEY?.trim() : apiKeys.geminiApiKey?.trim();
  if (key) return { key };
  if (legacy) return { error: "GEMINI_API_KEY is not set" };
  return { error: "Gemini API key not configured for this account." };
}

/** OpenAI-compatible Gemini API base (see Google Generative Language docs). */
const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_OPENAI_CHAT_URL = `${GEMINI_OPENAI_BASE}/chat/completions`;

/** Native generateContent (grounding, tools). @see https://ai.google.dev/gemini-api/docs/google-search */
const GEMINI_GENERATE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_GROUNDING_TIMEOUT_MS = 180_000;
const GEMINI_OPENAI_COMPAT_TIMEOUT_DEFAULT_MS = 120_000;

function geminiOpenAiCompatTimeoutMs(override?: number): number {
  if (override != null && Number.isFinite(override)) {
    return Math.min(600_000, Math.max(30_000, Math.round(override)));
  }
  return GEMINI_OPENAI_COMPAT_TIMEOUT_DEFAULT_MS;
}

/** Set OREO_GEMINI_GOOGLE_SEARCH=0 (or false/off) to skip Google Search grounding on tab prompts and AI Chat. */
export function isGeminiGoogleSearchEnabled(): boolean {
  const v = process.env.OREO_GEMINI_GOOGLE_SEARCH?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function normalizeGeminiModelId(model: string): string {
  return model.replace(/^models\//, "").trim();
}

function extractGeminiGenerateText(data: unknown): string | null {
  const d = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (d.error?.message) return null;
  const parts = d.candidates?.[0]?.content?.parts;
  if (!parts?.length) return null;
  const texts = parts.map((p) => (typeof p.text === "string" ? p.text : "")).filter(Boolean);
  return texts.length ? texts.join("") : null;
}

function geminiNativeUserParts(content: string | ChatUserContentPart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  const out: Array<Record<string, unknown>> = [];
  for (const p of content) {
    if (p.type === "text") {
      out.push({ text: p.text });
    } else if (p.type === "image") {
      out.push({
        inlineData: { mimeType: p.source.media_type, data: p.source.data },
      });
    }
  }
  return out.length ? out : [{ text: "" }];
}

function geminiNativeContentsFromMessages(messages: ChatConversationTurn[]): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  const out: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      out.push({ role: "model", parts: [{ text: m.content }] });
    } else {
      out.push({ role: "user", parts: geminiNativeUserParts(m.content) });
    }
  }
  return out;
}

/** PDF user parts cannot use native grounding path (no inline part built). */
function conversationCompatibleWithGeminiGoogleSearch(messages: ChatConversationTurn[]): boolean {
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "document") return false;
    }
  }
  return true;
}

async function callGeminiGenerateContentWithGoogleSearch(
  systemAug: string,
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>,
  modelId: string,
  maxTokens: number,
  apiKey: string
): Promise<GeminiResult> {
  const mid = normalizeGeminiModelId(modelId);
  const url = `${GEMINI_GENERATE_BASE}/${encodeURIComponent(mid)}:generateContent`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemAug }] },
        contents,
        tools: [{ google_search: {} }],
        generationConfig: {
          maxOutputTokens: maxTokens,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_GROUNDING_TIMEOUT_MS),
    });
    const raw = await res.text();
    if (!res.ok) {
      return normalizeGeminiApiError(res.status, raw);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Invalid JSON from Gemini generateContent" };
    }
    const text = extractGeminiGenerateText(data)?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "Empty response from Gemini (grounded generateContent)" };
    }
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gemini network error";
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: "Gemini request timed out. Retry in ~30–60s.", status: 504 };
    }
    return { ok: false, error: msg };
  }
}

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
  options: {
    maxTokens?: number;
    model?: string;
    apiKeys?: LlmCallApiKeys;
    /** Native generateContent + Google Search grounding (not OpenAI-compatible chat). */
    googleSearch?: boolean;
    /** Override OpenAI-compat chat HTTP wait (ms). */
    fetchTimeoutMs?: number;
  } = {}
): Promise<GeminiResult> {
  const resolved = resolveGeminiKey(options.apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const key = resolved.key;
  const systemAug = augmentLlmFullSystemPrompt(systemPrompt);

  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const maxTokens = options.maxTokens ?? LLM_MAX_OUTPUT_TOKENS;
  const googleSearch = options.googleSearch === true && isGeminiGoogleSearchEnabled();

  if (googleSearch) {
    return callGeminiGenerateContentWithGoogleSearch(
      systemAug,
      [{ role: "user", parts: [{ text: userMessage }] }],
      model,
      maxTokens,
      key
    );
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
        messages: [
          { role: "system", content: systemAug },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(geminiOpenAiCompatTimeoutMs(options.fetchTimeoutMs)),
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
  options: {
    maxTokens?: number;
    model?: string;
    apiKeys?: LlmCallApiKeys;
    googleSearch?: boolean;
    fetchTimeoutMs?: number;
  } = {}
): Promise<GeminiResult> {
  const resolved = resolveGeminiKey(options.apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const key = resolved.key;
  const systemAug = augmentLlmFullSystemPrompt(systemPrompt);

  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const maxTokens = options.maxTokens ?? LLM_MAX_OUTPUT_TOKENS;

  const googleSearch =
    options.googleSearch === true &&
    isGeminiGoogleSearchEnabled() &&
    conversationCompatibleWithGeminiGoogleSearch(messages);

  if (googleSearch) {
    return callGeminiGenerateContentWithGoogleSearch(
      systemAug,
      geminiNativeContentsFromMessages(messages),
      model,
      maxTokens,
      key
    );
  }

  const apiMessages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: string | GeminiMultimodalUserPart[] }
    | { role: "assistant"; content: string }
  > = [{ role: "system", content: systemAug }];

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
      signal: AbortSignal.timeout(geminiOpenAiCompatTimeoutMs(options.fetchTimeoutMs)),
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
