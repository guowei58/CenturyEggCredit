/**
 * KPI chunk/query embeddings: prefer OpenAI, then Gemini. Anthropic (Claude) has no first-party
 * text-embeddings API for this use case — skipped. DeepSeek is attempted via OpenAI-compatible
 * /v1/embeddings when configured (see DEEPSEEK_EMBEDDING_MODEL).
 */

import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  embedTextsOpenAI,
  type EmbeddingsResult,
} from "@/lib/openai-embeddings";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

export type KpiEmbeddingProviderId = "openai" | "gemini" | "deepseek";

export type KpiEmbeddingsOutcome =
  | {
      ok: true;
      vectors: number[][];
      provider: KpiEmbeddingProviderId;
      model: string;
      dimensions: number;
    }
  | { ok: false; error: string };

export const GEMINI_KPI_EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_EMBED_PATH = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_KPI_EMBEDDING_MODEL}:embedContent`;

const DEEPSEEK_EMBEDDINGS_URL = "https://api.deepseek.com/v1/embeddings";

function deepSeekKpiEmbeddingModel(): string {
  return process.env.DEEPSEEK_EMBEDDING_MODEL?.trim() || "deepseek-embedding";
}

function resolveOpenAiKey(apiKeys: LlmCallApiKeys | undefined): string | null {
  return apiKeys?.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

function resolveGeminiKey(apiKeys: LlmCallApiKeys | undefined): string | null {
  return apiKeys?.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

function resolveDeepSeekKey(apiKeys: LlmCallApiKeys | undefined): string | null {
  return apiKeys?.deepseekApiKey?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || null;
}

/** Provider order: OpenAI → (Anthropic skipped) → Gemini → DeepSeek. */
export function hasAnyKpiEmbeddingKey(apiKeys: LlmCallApiKeys | undefined): boolean {
  return resolveKpiEmbeddingBackendMetadata(apiKeys) != null;
}

/**
 * Which backend would run for KPI embeddings (no network). Use with stored cache rows to avoid
 * mixing vector spaces across providers.
 */
export function resolveKpiEmbeddingBackendMetadata(
  apiKeys: LlmCallApiKeys | undefined
): { provider: KpiEmbeddingProviderId; model: string; dimensions: number } | null {
  const dimensions = DEFAULT_EMBEDDING_DIMENSIONS;
  if (resolveOpenAiKey(apiKeys)) {
    return { provider: "openai", model: DEFAULT_EMBEDDING_MODEL, dimensions };
  }
  if (resolveGeminiKey(apiKeys)) {
    return { provider: "gemini", model: GEMINI_KPI_EMBEDDING_MODEL, dimensions };
  }
  if (resolveDeepSeekKey(apiKeys)) {
    return { provider: "deepseek", model: deepSeekKpiEmbeddingModel(), dimensions };
  }
  return null;
}

function toEmbeddingsResult(
  r: EmbeddingsResult,
  provider: KpiEmbeddingProviderId,
  model: string,
  dimensions: number
): KpiEmbeddingsOutcome {
  if (!r.ok) return r;
  return { ok: true, vectors: r.vectors, provider, model, dimensions };
}

async function embedTextsGemini(
  texts: string[],
  apiKey: string,
  dimensions: number,
  timeoutMs: number,
  concurrency: number
): Promise<EmbeddingsResult> {
  const out: number[][] = new Array(texts.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= texts.length) return;
      const text = texts[i]!.slice(0, 30_000);
      const url = `${GEMINI_EMBED_PATH}?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: dimensions,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(raw.slice(0, 500) || `Gemini embedContent HTTP ${res.status}`);
      }
      let data: { embedding?: { values?: number[] } };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error("Invalid JSON from Gemini embedContent");
      }
      const rawValues = data.embedding?.values;
      if (!rawValues?.length) {
        throw new Error("Missing embedding.values from Gemini embedContent");
      }
      const values =
        rawValues.length === dimensions
          ? rawValues
          : rawValues.length > dimensions
            ? rawValues.slice(0, dimensions)
            : null;
      if (!values) {
        throw new Error(`Gemini embedding length ${rawValues.length} < ${dimensions}`);
      }
      out[i] = values;
    }
  }

  const n = Math.min(concurrency, Math.max(1, texts.length));
  try {
    await Promise.all(Array.from({ length: n }, () => worker()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  if (out.some((v) => !v?.length)) {
    return { ok: false, error: "Incomplete Gemini embedding batch" };
  }
  return { ok: true, vectors: out as number[][] };
}

async function embedTextsDeepSeekOpenAICompat(
  texts: string[],
  apiKey: string,
  options: { dimensions: number; batchSize: number; timeoutMs: number }
): Promise<EmbeddingsResult> {
  const model = deepSeekKpiEmbeddingModel();
  const batchSize = Math.min(128, Math.max(1, options.batchSize));
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 30_000));
    const res = await fetch(DEEPSEEK_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: batch,
        encoding_format: "float",
        dimensions: options.dimensions,
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: raw.slice(0, 500) || `DeepSeek embeddings HTTP ${res.status}` };
    }
    let data: { data?: Array<{ embedding?: number[]; index?: number }> };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, error: "Invalid JSON from DeepSeek embeddings" };
    }
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== batch.length) {
      return { ok: false, error: `DeepSeek embedding batch: expected ${batch.length} rows, got ${rows.length}` };
    }
    for (const row of rows) {
      if (!row.embedding?.length) {
        return { ok: false, error: "Missing embedding vector in DeepSeek response" };
      }
      out.push(row.embedding);
    }
  }

  if (out.length !== texts.length) {
    return { ok: false, error: `Expected ${texts.length} vectors, got ${out.length}` };
  }
  return { ok: true, vectors: out };
}

/**
 * Embed texts for KPI retrieval using the first available backend (OpenAI → Gemini → DeepSeek).
 */
export async function embedTextsForKpiRetrieval(
  texts: string[],
  apiKeys: LlmCallApiKeys | undefined,
  options?: {
    model?: string;
    dimensions?: number;
    batchSize?: number;
    timeoutMs?: number;
    geminiConcurrency?: number;
  }
): Promise<KpiEmbeddingsOutcome> {
  const dimensions = options?.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const batchSize = options?.batchSize ?? 64;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const geminiConcurrency = Math.min(16, Math.max(1, options?.geminiConcurrency ?? 8));

  const openaiKey = resolveOpenAiKey(apiKeys);
  if (openaiKey) {
    const model = options?.model?.trim() || DEFAULT_EMBEDDING_MODEL;
    const r = await embedTextsOpenAI(texts, apiKeys, {
      model,
      dimensions,
      batchSize,
      timeoutMs,
    });
    return toEmbeddingsResult(r, "openai", model, dimensions);
  }

  /** Anthropic: no public text-embeddings API compatible with this flow — continue to Gemini. */

  const geminiKey = resolveGeminiKey(apiKeys);
  if (geminiKey) {
    const r = await embedTextsGemini(texts, geminiKey, dimensions, timeoutMs, geminiConcurrency);
    return toEmbeddingsResult(r, "gemini", GEMINI_KPI_EMBEDDING_MODEL, dimensions);
  }

  const deepseekKey = resolveDeepSeekKey(apiKeys);
  if (deepseekKey) {
    const r = await embedTextsDeepSeekOpenAICompat(texts, deepseekKey, {
      dimensions,
      batchSize,
      timeoutMs,
    });
    return toEmbeddingsResult(r, "deepseek", deepSeekKpiEmbeddingModel(), dimensions);
  }

  return {
    ok: false,
    error:
      "No embedding-capable API key: configure OpenAI, Gemini, or DeepSeek (embeddings) in Settings or env.",
  };
}
