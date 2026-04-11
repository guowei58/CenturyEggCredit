/**
 * Server-only DeepSeek Chat Completions API (OpenAI-compatible). Uses DEEPSEEK_API_KEY or bundle.deepseekApiKey.
 */

import type { ChatConversationTurn } from "@/lib/chat-multimodal-types";
import { augmentLlmFullSystemPrompt } from "@/lib/llm-datetime-context";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";

export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL;
}

function resolveDeepSeekKey(apiKeys: LlmCallApiKeys | undefined): { key: string } | { error: string } {
  const legacy = apiKeys === undefined;
  const key = legacy ? process.env.DEEPSEEK_API_KEY?.trim() : apiKeys.deepseekApiKey?.trim();
  if (key) return { key };
  if (legacy) return { error: "DEEPSEEK_API_KEY is not set" };
  return { error: "DeepSeek API key not configured for this account." };
}

const DEEPSEEK_FETCH_MS_MIN = 30_000;
const DEEPSEEK_FETCH_MS_MAX = 900_000;

function deepSeekFetchTimeoutMs(override?: number): number {
  if (override != null && Number.isFinite(override)) {
    return Math.min(DEEPSEEK_FETCH_MS_MAX, Math.max(DEEPSEEK_FETCH_MS_MIN, Math.round(override)));
  }
  const raw = process.env.DEEPSEEK_FETCH_TIMEOUT_MS?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.min(DEEPSEEK_FETCH_MS_MAX, Math.max(DEEPSEEK_FETCH_MS_MIN, n));
  }
  return 600_000;
}

function clampMaxTokens(requested: number): number {
  const cap = 8192;
  if (!Number.isFinite(requested) || requested < 1) return Math.min(4096, cap);
  return Math.min(Math.round(requested), cap);
}

export type DeepSeekResult =
  | { ok: true; text: string; outputTruncated?: boolean }
  | { ok: false; error: string; status?: number };

type Parsed = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
};

function resultFromParsed(data: Parsed): DeepSeekResult {
  const choice0 = data.choices?.[0];
  const text = choice0?.message?.content?.trim() ?? "";
  if (!text) {
    return { ok: false, error: "Empty response from DeepSeek (no assistant message)." };
  }
  const finishReason = String(choice0?.finish_reason ?? "");
  const outputTruncated = finishReason === "length";
  return outputTruncated ? { ok: true, text, outputTruncated: true } : { ok: true, text };
}

function normalizeError(status: number, raw: string): DeepSeekResult {
  if (status === 401) return { ok: false, error: "Invalid DeepSeek API key", status: 401 };
  if (status === 429) return { ok: false, error: "DeepSeek rate limit exceeded — wait a moment and try again.", status: 429 };
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    const msg = parsed?.error?.message?.trim();
    if (msg) {
      if (msg.includes("maximum context length")) {
        return { ok: false, error: `DeepSeek context limit exceeded. Your saved data + conversation is too large for this model. Try Claude or Gemini (larger context), or uncheck "Include saved OREO data."`, status };
      }
      return { ok: false, error: msg.slice(0, 500), status };
    }
  } catch { /* fall through */ }
  return { ok: false, error: raw?.slice(0, 400) || `HTTP ${status}`, status };
}

export async function callDeepSeek(
  systemPrompt: string,
  userMessage: string,
  options: { maxTokens?: number; model?: string; apiKeys?: LlmCallApiKeys; fetchTimeoutMs?: number } = {}
): Promise<DeepSeekResult> {
  const resolved = resolveDeepSeekKey(options.apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const model = options.model?.trim() || getDeepSeekModel();
  const maxTokens = clampMaxTokens(options.maxTokens ?? 4096);
  const waitMs = deepSeekFetchTimeoutMs(options.fetchTimeoutMs);
  const systemAug = augmentLlmFullSystemPrompt(systemPrompt);

  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemAug },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(waitMs),
    });
    const raw = await res.text();
    if (!res.ok) return normalizeError(res.status, raw);
    let data: Parsed;
    try {
      data = JSON.parse(raw) as Parsed;
    } catch {
      return { ok: false, error: "Invalid JSON from DeepSeek" };
    }
    return resultFromParsed(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DeepSeek network error";
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: `DeepSeek request timed out after ${Math.round(waitMs / 1000)}s`, status: 504 };
    }
    return { ok: false, error: msg };
  }
}

/** Multi-turn chat; text-only user turns (same multimodal contract as local Ollama path). */
export async function callDeepSeekConversation(
  systemPrompt: string,
  messages: ChatConversationTurn[],
  options: { maxTokens?: number; model?: string; apiKeys?: LlmCallApiKeys; fetchTimeoutMs?: number } = {}
): Promise<DeepSeekResult> {
  const resolved = resolveDeepSeekKey(options.apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const model = options.model?.trim() || getDeepSeekModel();
  const maxTokens = clampMaxTokens(options.maxTokens ?? 4096);
  const waitMs = deepSeekFetchTimeoutMs(options.fetchTimeoutMs);
  const systemAug = augmentLlmFullSystemPrompt(systemPrompt);

  const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemAug },
  ];
  for (const m of messages) {
    if (m.role === "assistant") {
      apiMessages.push({ role: "assistant", content: m.content });
    } else {
      if (typeof m.content !== "string") {
        return {
          ok: false,
          error:
            "DeepSeek in OREO is text-only. Switch to Claude (PDF/images) or ChatGPT (images), or paste text instead.",
          status: 400,
        };
      }
      apiMessages.push({ role: "user", content: m.content });
    }
  }

  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({ model, messages: apiMessages, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(waitMs),
    });
    const raw = await res.text();
    if (!res.ok) return normalizeError(res.status, raw);
    let data: Parsed;
    try {
      data = JSON.parse(raw) as Parsed;
    } catch {
      return { ok: false, error: "Invalid JSON from DeepSeek" };
    }
    return resultFromParsed(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DeepSeek network error";
    if (msg.toLowerCase().includes("aborted")) {
      return { ok: false, error: `DeepSeek request timed out after ${Math.round(waitMs / 1000)}s`, status: 504 };
    }
    return { ok: false, error: msg };
  }
}
