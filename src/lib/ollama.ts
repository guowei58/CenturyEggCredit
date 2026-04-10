/**
 * Server-only Ollama client (local LLM). Uses OLLAMA_BASE_URL and OLLAMA_MODEL.
 */

import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";
import { augmentLlmSystemPromptWithCurrentTime } from "@/lib/llm-datetime-context";

export type OllamaResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

export type OllamaHealthStatus = "connected" | "disconnected" | "model_missing" | "error";

const DEFAULT_BASE = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.1:8b";
const CHAT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 4_000;

export function getOllamaBaseUrl(): string {
  const u = process.env.OLLAMA_BASE_URL?.trim();
  return u && u.length > 0 ? u.replace(/\/$/, "") : DEFAULT_BASE;
}

export function getOllamaModel(): string {
  const m = process.env.OLLAMA_MODEL?.trim();
  return m && m.length > 0 ? m : DEFAULT_MODEL;
}

function parseOllamaTemperature(): number | undefined {
  const raw = process.env.OLLAMA_TEMPERATURE?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

function userTurnToPlainString(content: string | ChatUserContentPart[]): string | null {
  if (typeof content === "string") return content;
  const texts: string[] = [];
  for (const p of content) {
    if (p.type === "text") texts.push(p.text);
    else return null;
  }
  return texts.join("\n\n");
}

function logOllamaServer(message: string, detail?: unknown): void {
  if (process.env.NODE_ENV === "development") {
    console.warn(`[ollama] ${message}`, detail ?? "");
  } else {
    console.warn(`[ollama] ${message}`);
  }
}

/** True if installed models include the configured model (exact or tag-compatible). */
function modelListIncludesModel(names: Iterable<string>, wantRaw: string): boolean {
  const want = wantRaw.trim();
  if (!want) return false;
  const namesArr = Array.from(names);
  if (namesArr.includes(want)) return true;
  const wantBase = want.split(":")[0]?.toLowerCase() ?? "";
  for (const n of namesArr) {
    if (n === want) return true;
    if (n.startsWith(`${want}:`)) return true;
    if (want.startsWith(`${n}:`)) return true;
    const nb = n.split(":")[0]?.toLowerCase() ?? "";
    if (wantBase && nb === wantBase) return true;
  }
  return false;
}

export async function checkOllamaHealth(): Promise<{
  status: OllamaHealthStatus;
  model: string;
  baseUrl: string;
  detail?: string;
}> {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();
  const tagsUrl = `${baseUrl}/api/tags`;

  try {
    const res = await fetch(tagsUrl, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      logOllamaServer("health: non-OK response", { status: res.status, body: t.slice(0, 500) });
      return {
        status: "error",
        model,
        baseUrl,
        detail: `Ollama returned HTTP ${res.status}`,
      };
    }
    let data: { models?: Array<{ name?: string }> };
    try {
      data = (await res.json()) as typeof data;
    } catch (e) {
      logOllamaServer("health: invalid JSON from /api/tags", e);
      return { status: "error", model, baseUrl, detail: "Invalid JSON from Ollama /api/tags" };
    }
    const nameSet = new Set<string>();
    for (const m of data.models ?? []) {
      const n = m.name?.trim();
      if (n) nameSet.add(n);
    }
    if (modelListIncludesModel(nameSet, model)) {
      return { status: "connected", model, baseUrl };
    }
    return {
      status: "model_missing",
      model,
      baseUrl,
      detail: `Model not found locally. Run: ollama pull ${model}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const low = msg.toLowerCase();
    if (
      low.includes("aborted") ||
      low.includes("econnrefused") ||
      low.includes("fetch failed") ||
      low.includes("network") ||
      low.includes("timeout")
    ) {
      logOllamaServer("health: disconnected", msg);
      return {
        status: "disconnected",
        model,
        baseUrl,
        detail: "Cannot reach Ollama. Is `ollama serve` running?",
      };
    }
    logOllamaServer("health: error", e);
    return { status: "error", model, baseUrl, detail: msg };
  }
}

function friendlyChatError(status: number, raw: string, model: string): OllamaResult {
  let errMsg = raw?.trim() || `HTTP ${status}`;
  try {
    const j = JSON.parse(raw) as { error?: string };
    if (typeof j.error === "string" && j.error.trim()) errMsg = j.error.trim();
  } catch {
    // use raw
  }
  const low = errMsg.toLowerCase();
  if (status === 404 || low.includes("not found") || (low.includes("model") && low.includes("pull"))) {
    return {
      ok: false,
      error: `Ollama model missing or wrong name. Run: ollama pull ${model}`,
      status: 404,
    };
  }
  if (status >= 500) {
    return { ok: false, error: "Ollama server error. Check logs and restart `ollama serve`.", status };
  }
  return { ok: false, error: errMsg.length > 400 ? `${errMsg.slice(0, 400)}…` : errMsg, status };
}

export async function callOllama(
  systemPrompt: string,
  userMessage: string,
  options: { maxTokens?: number; model?: string; temperature?: number } = {}
): Promise<OllamaResult> {
  const baseUrl = getOllamaBaseUrl();
  const model = options.model?.trim() || getOllamaModel();
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature ?? parseOllamaTemperature();
  const systemAug = augmentLlmSystemPromptWithCurrentTime(systemPrompt);

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [
      { role: "system", content: systemAug },
      { role: "user", content: userMessage },
    ],
    options: {
      num_predict: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
    },
  };

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const raw = await res.text();
    if (!res.ok) {
      logOllamaServer("chat: HTTP error", { status: res.status, body: raw.slice(0, 800) });
      return friendlyChatError(res.status, raw, model);
    }
    let data: { message?: { content?: string }; error?: string };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch (e) {
      logOllamaServer("chat: invalid JSON", e);
      return { ok: false, error: "Invalid JSON from Ollama", status: 502 };
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return friendlyChatError(res.status || 500, JSON.stringify({ error: data.error }), model);
    }
    const text = data.message?.content?.trim() ?? "";
    if (!text) {
      logOllamaServer("chat: empty assistant content", raw.slice(0, 500));
      return { ok: false, error: "Empty response from Ollama", status: 502 };
    }
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const low = msg.toLowerCase();
    logOllamaServer("chat: exception", e);
    if (low.includes("aborted") || low.includes("timeout")) {
      return { ok: false, error: "Ollama request timed out. Try a smaller prompt or increase timeout.", status: 504 };
    }
    if (low.includes("econnrefused") || low.includes("fetch failed")) {
      return {
        ok: false,
        error: "Cannot connect to Ollama. Start the server: ollama serve (default http://localhost:11434).",
        status: 503,
      };
    }
    return { ok: false, error: msg, status: 502 };
  }
}

export async function callOllamaConversation(
  systemPrompt: string,
  messages: ChatConversationTurn[],
  options: { maxTokens?: number; model?: string; temperature?: number } = {}
): Promise<OllamaResult> {
  const baseUrl = getOllamaBaseUrl();
  const model = options.model?.trim() || getOllamaModel();
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature ?? parseOllamaTemperature();
  const systemAug = augmentLlmSystemPromptWithCurrentTime(systemPrompt);

  const apiMessages: Array<{ role: string; content: string }> = [{ role: "system", content: systemAug }];

  for (const m of messages) {
    if (m.role === "assistant") {
      apiMessages.push({ role: "assistant", content: m.content });
    } else {
      const plain = userTurnToPlainString(m.content);
      if (plain === null) {
        return { ok: false, error: "Invalid user message shape for Ollama.", status: 400 };
      }
      apiMessages.push({ role: "user", content: plain });
    }
  }

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: apiMessages,
    options: {
      num_predict: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
    },
  };

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const raw = await res.text();
    if (!res.ok) {
      logOllamaServer("chat(conv): HTTP error", { status: res.status, body: raw.slice(0, 800) });
      return friendlyChatError(res.status, raw, model);
    }
    let data: { message?: { content?: string }; error?: string };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch (e) {
      logOllamaServer("chat(conv): invalid JSON", e);
      return { ok: false, error: "Invalid JSON from Ollama", status: 502 };
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return friendlyChatError(res.status || 500, JSON.stringify({ error: data.error }), model);
    }
    const text = data.message?.content?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "Empty response from Ollama", status: 502 };
    }
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const low = msg.toLowerCase();
    logOllamaServer("chat(conv): exception", e);
    if (low.includes("aborted") || low.includes("timeout")) {
      return { ok: false, error: "Ollama request timed out.", status: 504 };
    }
    if (low.includes("econnrefused") || low.includes("fetch failed")) {
      return {
        ok: false,
        error: "Cannot connect to Ollama. Run: ollama serve",
        status: 503,
      };
    }
    return { ok: false, error: msg, status: 502 };
  }
}
