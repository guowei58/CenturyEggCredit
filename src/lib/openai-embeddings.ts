/**
 * OpenAI Embeddings API (text-embedding-3-small) for local retrieval / ranking.
 * Server-only; uses the same API key resolution as Chat Completions.
 */

import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

export const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/** Default reduced dimensionality (storage + speed); supported by text-embedding-3-* models. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 256;

function resolveOpenAiKey(apiKeys: LlmCallApiKeys | undefined): { key: string } | { error: string } {
  const key = apiKeys?.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (key) return { key };
  return { error: "OpenAI API key not configured (required for embeddings)." };
}

export type EmbeddingsResult = { ok: true; vectors: number[][] } | { ok: false; error: string };

/**
 * One API call per batch (max ~2048 inputs; we use smaller batches for payload safety).
 */
export async function embedTextsOpenAI(
  texts: string[],
  apiKeys: LlmCallApiKeys | undefined,
  options?: {
    model?: string;
    dimensions?: number;
    batchSize?: number;
    timeoutMs?: number;
  }
): Promise<EmbeddingsResult> {
  const resolved = resolveOpenAiKey(apiKeys);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const key = resolved.key;

  const model = options?.model?.trim() || DEFAULT_EMBEDDING_MODEL;
  const dimensions = options?.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const batchSize = Math.min(128, Math.max(1, options?.batchSize ?? 64));
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const body: Record<string, unknown> = {
      model,
      input: batch,
      encoding_format: "float",
    };
    if (Number.isFinite(dimensions) && dimensions > 0) {
      body.dimensions = dimensions;
    }

    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: raw.slice(0, 500) || `Embeddings HTTP ${res.status}` };
    }

    let data: { data?: Array<{ embedding?: number[]; index?: number }> };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, error: "Invalid JSON from OpenAI embeddings" };
    }

    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== batch.length) {
      return { ok: false, error: `Embedding batch: expected ${batch.length} rows, got ${rows.length}` };
    }
    for (const row of rows) {
      if (!row.embedding?.length) {
        return { ok: false, error: "Missing embedding vector in OpenAI response" };
      }
      out.push(row.embedding);
    }
  }

  if (out.length !== texts.length) {
    return { ok: false, error: `Expected ${texts.length} vectors, got ${out.length}` };
  }
  return { ok: true, vectors: out };
}

export function resolveOpenAiKeyForEmbeddings(apiKeys: LlmCallApiKeys | undefined): string | null {
  const r = resolveOpenAiKey(apiKeys);
  return "key" in r ? r.key : null;
}
