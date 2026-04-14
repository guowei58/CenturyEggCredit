/**
 * Server-only OpenAI Chat Completions API. Uses OPENAI_API_KEY.
 */

import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";
import { augmentLlmFullSystemPrompt } from "@/lib/llm-datetime-context";
import { XBRL_CONSOLIDATE_LLM_FETCH_TIMEOUT_MS } from "@/lib/llm-xbrl-consolidate-timeouts";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function resolveOpenAiKey(apiKeys: LlmCallApiKeys | undefined): { key: string } | { error: string } {
  const legacy = apiKeys === undefined;
  const key = legacy ? process.env.OPENAI_API_KEY?.trim() : apiKeys.openaiApiKey?.trim();
  if (key) return { key };
  if (legacy) return { error: "OPENAI_API_KEY is not set" };
  return { error: "OpenAI API key not configured for this account." };
}

const OPENAI_FETCH_MS_MIN = 30_000;
const OPENAI_FETCH_MS_MAX = 900_000;

function parseOpenAiFetchTimeoutMs(raw: string | undefined, fallback: number): number {
  if (raw?.trim()) {
    const n = parseInt(raw.trim(), 10);
    if (Number.isFinite(n)) return Math.min(OPENAI_FETCH_MS_MAX, Math.max(OPENAI_FETCH_MS_MIN, n));
  }
  return fallback;
}

/**
 * Default HTTP wait for OpenAI (AI Chat, tab prompts, credit memo, etc.). Override OPENAI_FETCH_TIMEOUT_MS (30s–15m).
 */
function openAiFetchTimeoutMs(): number {
  return parseOpenAiFetchTimeoutMs(process.env.OPENAI_FETCH_TIMEOUT_MS, 600_000);
}

/**
 * Longer wait for SEC XBRL AI consolidation (huge prompts + GPT-5 reasoning). Default 10m.
 * Override OPENAI_XBRL_CONSOLIDATE_FETCH_TIMEOUT_MS (30s–15m). Align with route `maxDuration` on your host.
 */
export function openAiXbrlConsolidateFetchTimeoutMs(): number {
  return parseOpenAiFetchTimeoutMs(
    process.env.OPENAI_XBRL_CONSOLIDATE_FETCH_TIMEOUT_MS,
    XBRL_CONSOLIDATE_LLM_FETCH_TIMEOUT_MS
  );
}

/** Default when no OPENAI_MODEL and no per-request override (cheap, reliable for long tab prompts). */
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

/** Set OREO_OPENAI_WEB_SEARCH=0 (or false/off) to skip Chat Completions web search on tab prompts and AI Chat. */
export function isOpenAiWebSearchEnabled(): boolean {
  const v = process.env.OREO_OPENAI_WEB_SEARCH?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * Chat Completions web search requires search-specific models (see OpenAI "Web search" guide).
 * Maps the user's chosen model to the closest search variant.
 */
export function openAiChatCompletionsSearchModel(requestedModel: string): string {
  const m = requestedModel.toLowerCase().trim();
  if (m.includes("gpt-5")) return "gpt-5-search-api";
  if (m.includes("mini")) return "gpt-4o-mini-search-preview";
  if (m.includes("gpt-4o")) return "gpt-4o-search-preview";
  return "gpt-4o-mini-search-preview";
}

/** Legacy GPT-4 class models: `max_tokens` ceiling (completion tokens). */
const OPENAI_LEGACY_MAX_COMPLETION_TOKENS = 16_384;

/** GPT-5 family: use `max_completion_tokens`; docs cite large output budget (cap conservatively). */
const OPENAI_GPT5_MAX_COMPLETION_TOKENS = 128_000;

const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

function usesGpt5ChatCompletionShape(model: string): boolean {
  return model.toLowerCase().startsWith("gpt-5");
}

/**
 * `reasoning_effort` is only valid for certain Chat Completions models. In particular, OpenAI’s
 * **search** endpoints (e.g. `gpt-5-search-api`, `*-search-preview`) reject this parameter with
 * "Unrecognized request argument supplied: reasoning_effort".
 */
function openAiModelAcceptsReasoningEffort(model: string): boolean {
  const m = model.toLowerCase();
  if (!m.startsWith("gpt-5")) return false;
  if (m.includes("search")) return false;
  return true;
}

function openAiCompletionTokenCap(model: string): number {
  return usesGpt5ChatCompletionShape(model) ? OPENAI_GPT5_MAX_COMPLETION_TOKENS : OPENAI_LEGACY_MAX_COMPLETION_TOKENS;
}

function clampOpenAIMaxTokens(requested: number, model: string): number {
  const cap = openAiCompletionTokenCap(model);
  if (!Number.isFinite(requested) || requested < 1) return Math.min(4096, cap);
  return Math.min(Math.round(requested), cap);
}

function reasoningEffortForGpt5(): string {
  const raw = process.env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (raw && REASONING_EFFORTS.has(raw)) return raw;
  return "high";
}

function openAiChatRequestBody(
  model: string,
  messages: unknown[],
  maxTokens: number,
  webSearch?: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages };
  if (usesGpt5ChatCompletionShape(model)) {
    body.max_completion_tokens = maxTokens;
    if (openAiModelAcceptsReasoningEffort(model)) {
      body.reasoning_effort = reasoningEffortForGpt5();
    }
  } else {
    body.max_tokens = maxTokens;
  }
  if (webSearch) {
    body.web_search_options = {};
  }
  return body;
}

function normalizeOpenAiApiError(status: number, raw: string): OpenAIResult {
  try {
    const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string; code?: string } };
    const t = (parsed?.error?.type || "").toLowerCase();
    const msg = (parsed?.error?.message || "").toLowerCase();
    const code = (parsed?.error?.code || "").toLowerCase();
    if (t === "overloaded_error" || code === "overloaded" || msg.includes("overloaded")) {
      return { ok: false, error: "OpenAI is overloaded right now — wait ~30–60s and retry.", status };
    }
    if (
      (msg.includes("max_tokens") || msg.includes("max_completion_tokens")) &&
      (msg.includes("too large") || msg.includes("at most"))
    ) {
      return {
        ok: false,
        error: `OpenAI rejected the output token limit for this model. Try a lower max or a model with a higher completion cap (GPT-5.4 supports up to ${OPENAI_GPT5_MAX_COMPLETION_TOKENS.toLocaleString()}).`,
        status,
      };
    }
  } catch {
    // ignore
  }
  if (status === 401) return { ok: false, error: "Invalid OpenAI API key", status: 401 };
  if (status === 429) return { ok: false, error: "OpenAI rate limit exceeded", status: 429 };
  return { ok: false, error: raw?.slice(0, 400) || `HTTP ${status}`, status };
}

export type OpenAIResult =
  | { ok: true; text: string; outputTruncated?: boolean }
  | { ok: false; error: string; status?: number };

type OpenAiChatParsed = {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }>;
  usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
};

function openAiResultFromParsedChat(data: OpenAiChatParsed): OpenAIResult {
  const choice0 = data.choices?.[0];
  const text = choice0?.message?.content?.trim() ?? "";
  if (!text) {
    const refusal = (choice0?.message?.refusal ?? "").trim();
    if (refusal) return { ok: false, error: `OpenAI refused: ${refusal}` };
    const fr = String(choice0?.finish_reason ?? "");
    const rTok = data.usage?.completion_tokens_details?.reasoning_tokens;
    if (fr === "length" || (typeof rTok === "number" && rTok > 0)) {
      return {
        ok: false,
        error:
          "OpenAI returned no visible text: the completion budget was used up (GPT-5 models often spend tokens on internal reasoning first). Fix: pick a higher max output in the tab/API request, set OPENAI_REASONING_EFFORT to low or medium, or use a non-reasoning model (app default is gpt-4o-mini; gpt-4o also works) under User Settings → API model.",
      };
    }
    return {
      ok: false,
      error:
        "Empty response from OpenAI (no assistant message). Try another model, increase output tokens, or lower OPENAI_REASONING_EFFORT if using GPT-5.",
    };
  }
  const finishReason = String(choice0?.finish_reason ?? "");
  const outputTruncated = finishReason === "length";
  return outputTruncated ? { ok: true, text, outputTruncated: true } : { ok: true, text };
}

export type OpenAIMessage = { role: "user" | "assistant" | "system"; content: string };

export async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  options: {
    maxTokens?: number;
    model?: string;
    fetchTimeoutMs?: number;
    apiKeys?: LlmCallApiKeys;
    /** Use OpenAI Chat Completions web search (switches to a search-capable model). */
    webSearch?: boolean;
  } = {}
): Promise<OpenAIResult> {
  const resolved = resolveOpenAiKey(options.apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const key = resolved.key;
  const systemAug = augmentLlmFullSystemPrompt(systemPrompt);

  const baseModel = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const webSearch = options.webSearch === true && isOpenAiWebSearchEnabled();
  const model = webSearch ? openAiChatCompletionsSearchModel(baseModel) : baseModel;
  const maxTokens = clampOpenAIMaxTokens(options.maxTokens ?? 4096, model);
  const waitMs =
    options.fetchTimeoutMs != null && Number.isFinite(options.fetchTimeoutMs)
      ? Math.min(OPENAI_FETCH_MS_MAX, Math.max(OPENAI_FETCH_MS_MIN, Math.round(options.fetchTimeoutMs)))
      : openAiFetchTimeoutMs();

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(
        openAiChatRequestBody(
          model,
          [
            { role: "system", content: systemAug },
            { role: "user", content: userMessage },
          ],
          maxTokens,
          webSearch
        )
      ),
      signal: AbortSignal.timeout(waitMs),
    });

    const raw = await res.text();
    if (!res.ok) {
      return normalizeOpenAiApiError(res.status, raw);
    }

    let data: OpenAiChatParsed;
    try {
      data = JSON.parse(raw) as OpenAiChatParsed;
    } catch {
      return { ok: false, error: "Invalid JSON from OpenAI" };
    }
    return openAiResultFromParsedChat(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI network error";
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "UND_ERR_HEADERS_TIMEOUT" || msg.toLowerCase().includes("headers timeout")) {
      return { ok: false, error: "OpenAI request timed out (provider slow/overloaded). Retry in ~30–60s.", status: 504 };
    }
    if (msg.toLowerCase().includes("aborted")) {
      const sec = Math.round(waitMs / 1000);
      return {
        ok: false,
        error: `OpenAI request timed out after ${sec}s (client wait limit). For XBRL consolidation, raise OPENAI_XBRL_CONSOLIDATE_FETCH_TIMEOUT_MS (up to 900) and ensure your host route allows a matching maxDuration — or retry; the model may still have been working.`,
        status: 504,
      };
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
  options: {
    maxTokens?: number;
    model?: string;
    fetchTimeoutMs?: number;
    apiKeys?: LlmCallApiKeys;
    webSearch?: boolean;
  } = {}
): Promise<OpenAIResult> {
  const resolved = resolveOpenAiKey(options.apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const key = resolved.key;
  const systemAug = augmentLlmFullSystemPrompt(systemPrompt);

  const baseModel = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const webSearch = options.webSearch === true && isOpenAiWebSearchEnabled();
  const model = webSearch ? openAiChatCompletionsSearchModel(baseModel) : baseModel;
  const maxTokens = clampOpenAIMaxTokens(options.maxTokens ?? 4096, model);
  const waitMs =
    options.fetchTimeoutMs != null && Number.isFinite(options.fetchTimeoutMs)
      ? Math.min(OPENAI_FETCH_MS_MAX, Math.max(OPENAI_FETCH_MS_MIN, Math.round(options.fetchTimeoutMs)))
      : openAiFetchTimeoutMs();

  const apiMessages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: string | OpenAIMultimodalUserPart[] }
    | { role: "assistant"; content: string }
  > = [{ role: "system", content: systemAug }];

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
      body: JSON.stringify(openAiChatRequestBody(model, apiMessages, maxTokens, webSearch)),
      signal: AbortSignal.timeout(waitMs),
    });

    const raw = await res.text();
    if (!res.ok) {
      return normalizeOpenAiApiError(res.status, raw);
    }

    let data: OpenAiChatParsed;
    try {
      data = JSON.parse(raw) as OpenAiChatParsed;
    } catch {
      return { ok: false, error: "Invalid JSON from OpenAI" };
    }
    return openAiResultFromParsedChat(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI network error";
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "UND_ERR_HEADERS_TIMEOUT" || msg.toLowerCase().includes("headers timeout")) {
      return { ok: false, error: "OpenAI request timed out (provider slow/overloaded). Retry in ~30–60s.", status: 504 };
    }
    if (msg.toLowerCase().includes("aborted")) {
      const sec = Math.round(waitMs / 1000);
      return {
        ok: false,
        error: `OpenAI request timed out after ${sec}s (client wait limit). Raise OPENAI_FETCH_TIMEOUT_MS (max 900) or retry.`,
        status: 504,
      };
    }
    return { ok: false, error: msg };
  }
}
