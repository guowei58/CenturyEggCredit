/**
 * Server-only: fetch chat model ids from provider APIs, cache on disk, merge with static presets.
 */

import fs from "fs/promises";
import path from "path";

import type { AiProvider } from "@/lib/ai-provider";
import {
  presetsForProvider,
  sanitizeClientModelId,
  type ModelPreset,
} from "@/lib/ai-model-options";
import { humanizeModelId, mergeModelPresets } from "@/lib/merge-ai-model-presets";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { mergeLlmCallApiKeysWithProcessEnv } from "@/lib/user-llm-keys";

const ALL_PROVIDERS: AiProvider[] = ["claude", "openai", "gemini", "deepseek"];

export type CatalogProviderResult = {
  presets: ModelPreset[];
  fetchedAt: string | null;
  stale: boolean;
  source: "provider" | "cache" | "static";
  error?: string;
};

type CachedProviderFile = {
  fetchedAt: string;
  discovered: ModelPreset[];
  error?: string;
};

const inFlight = new Map<string, Promise<CachedProviderFile | null>>();

export function aiModelCatalogTtlMs(): number {
  const raw = process.env.AI_MODEL_CATALOG_TTL_MS?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 24 * 60 * 60 * 1000;
}

function cacheRoot(): string {
  return path.join(process.cwd(), "data", "ai-model-catalog");
}

function cachePath(provider: AiProvider): string {
  return path.join(cacheRoot(), `${provider}.json`);
}

async function readCacheFile(provider: AiProvider): Promise<CachedProviderFile | null> {
  try {
    const raw = await fs.readFile(cachePath(provider), "utf8");
    return JSON.parse(raw) as CachedProviderFile;
  } catch {
    return null;
  }
}

async function writeCacheFile(provider: AiProvider, data: CachedProviderFile): Promise<void> {
  const dir = cacheRoot();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath(provider), JSON.stringify(data, null, 2), "utf8");
}

function isStale(fetchedAt: string | null | undefined, ttlMs: number): boolean {
  if (!fetchedAt) return true;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= ttlMs;
}

function presetFromId(id: string, label?: string): ModelPreset | null {
  const ok = sanitizeClientModelId(id);
  if (!ok) return null;
  return { id: ok, label: label?.trim() || humanizeModelId(ok) };
}

async function fetchOpenAiModels(key: string): Promise<ModelPreset[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw.slice(0, 300) || `OpenAI models HTTP ${res.status}`);
  const data = JSON.parse(raw) as { data?: Array<{ id?: string }> };
  const skip =
    /(?:embed|embedding|whisper|tts|dall-e|moderation|davinci|babbage|ada|curie|ft:|audio|transcribe|realtime|computer-use|sora|omni-moderation)/i;
  return (data.data ?? [])
    .map((m) => m.id?.trim())
    .filter((id): id is string => Boolean(id && !skip.test(id)))
    .filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id))
    .map((id) => presetFromId(id))
    .filter((p): p is ModelPreset => Boolean(p));
}

async function fetchAnthropicModels(key: string): Promise<ModelPreset[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw.slice(0, 300) || `Anthropic models HTTP ${res.status}`);
  const data = JSON.parse(raw) as {
    data?: Array<{ id?: string; display_name?: string; name?: string }>;
  };
  return (data.data ?? [])
    .map((m) => {
      const id = (m.id ?? m.name ?? "").trim();
      if (!id.startsWith("claude")) return null;
      return presetFromId(id, m.display_name);
    })
    .filter((p): p is ModelPreset => Boolean(p));
}

async function fetchGeminiModels(key: string): Promise<ModelPreset[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw.slice(0, 300) || `Gemini models HTTP ${res.status}`);
  const data = JSON.parse(raw) as {
    models?: Array<{
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => {
      const full = (m.name ?? "").trim();
      const id = full.replace(/^models\//, "");
      if (!/^gemini/i.test(id)) return null;
      return presetFromId(id, m.displayName);
    })
    .filter((p): p is ModelPreset => Boolean(p));
}

async function fetchDeepSeekModels(key: string): Promise<ModelPreset[]> {
  const res = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    const res2 = await fetch("https://api.deepseek.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const raw2 = await res2.text();
    if (!res2.ok) throw new Error(raw2.slice(0, 300) || `DeepSeek models HTTP ${res2.status}`);
    const data2 = JSON.parse(raw2) as { data?: Array<{ id?: string }> };
    return (data2.data ?? [])
      .map((m) => presetFromId(m.id ?? ""))
      .filter((p): p is ModelPreset => Boolean(p));
  }
  const data = JSON.parse(raw) as { data?: Array<{ id?: string }> } | { models?: Array<{ id?: string }> };
  const rows = "data" in data && Array.isArray(data.data) ? data.data : "models" in data ? data.models : [];
  return (rows ?? [])
    .map((m) => presetFromId(m?.id ?? ""))
    .filter((p): p is ModelPreset => Boolean(p));
}

function resolveKey(provider: AiProvider, keys: LlmCallApiKeys): string | null {
  const k = mergeLlmCallApiKeysWithProcessEnv(keys);
  if (provider === "openai") return k.openaiApiKey?.trim() || null;
  if (provider === "gemini") return k.geminiApiKey?.trim() || null;
  if (provider === "deepseek") return k.deepseekApiKey?.trim() || null;
  return k.anthropicApiKey?.trim() || null;
}

async function fetchFromProvider(provider: AiProvider, key: string): Promise<ModelPreset[]> {
  if (provider === "openai") return fetchOpenAiModels(key);
  if (provider === "claude") return fetchAnthropicModels(key);
  if (provider === "gemini") return fetchGeminiModels(key);
  return fetchDeepSeekModels(key);
}

async function refreshProviderCache(provider: AiProvider, keys: LlmCallApiKeys): Promise<CachedProviderFile> {
  const key = resolveKey(provider, keys);
  const fetchedAt = new Date().toISOString();
  if (!key) {
    const file: CachedProviderFile = { fetchedAt, discovered: [], error: "No API key configured" };
    await writeCacheFile(provider, file);
    return file;
  }
  try {
    const discovered = await fetchFromProvider(provider, key);
    const file: CachedProviderFile = { fetchedAt, discovered };
    await writeCacheFile(provider, file);
    return file;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Provider model list failed";
    const prior = await readCacheFile(provider);
    if (prior?.discovered?.length) {
      return { ...prior, error: msg };
    }
    const file: CachedProviderFile = { fetchedAt, discovered: [], error: msg };
    await writeCacheFile(provider, file);
    return file;
  }
}

async function loadProviderCache(
  provider: AiProvider,
  keys: LlmCallApiKeys,
  forceRefresh: boolean
): Promise<CachedProviderFile | null> {
  const ttlMs = aiModelCatalogTtlMs();
  const cached = await readCacheFile(provider);
  const needsRefresh = forceRefresh || isStale(cached?.fetchedAt, ttlMs);
  if (!needsRefresh && cached) return cached;

  const flightKey = `${provider}:${forceRefresh ? "force" : "auto"}`;
  let pending = inFlight.get(flightKey);
  if (!pending) {
    pending = refreshProviderCache(provider, keys).finally(() => {
      inFlight.delete(flightKey);
    });
    inFlight.set(flightKey, pending);
  }
  return pending;
}

function buildResult(
  provider: AiProvider,
  cache: CachedProviderFile | null,
  ttlMs: number,
  source: CatalogProviderResult["source"]
): CatalogProviderResult {
  const staticPresets = presetsForProvider(provider);
  const discovered = cache?.discovered ?? [];
  const merged = mergeModelPresets(staticPresets, discovered);
  const fetchedAt = cache?.fetchedAt ?? null;
  return {
    presets: merged,
    fetchedAt,
    stale: isStale(fetchedAt, ttlMs),
    source,
    error: cache?.error,
  };
}

export async function getModelCatalogForProvider(
  provider: AiProvider,
  keys: LlmCallApiKeys,
  options: { forceRefresh?: boolean } = {}
): Promise<CatalogProviderResult> {
  const ttlMs = aiModelCatalogTtlMs();
  const cached = await readCacheFile(provider);
  const stale = isStale(cached?.fetchedAt, ttlMs);

  if (!options.forceRefresh && cached && !stale) {
    return buildResult(provider, cached, ttlMs, cached.discovered.length ? "cache" : "static");
  }

  const refreshed = await loadProviderCache(provider, keys, Boolean(options.forceRefresh));
  const source: CatalogProviderResult["source"] =
    refreshed?.discovered?.length && !refreshed.error
      ? "provider"
      : refreshed?.discovered?.length
        ? "cache"
        : "static";
  return buildResult(provider, refreshed, ttlMs, source);
}

export async function getModelCatalog(
  keys: LlmCallApiKeys,
  options: { forceRefresh?: boolean; provider?: AiProvider } = {}
): Promise<{ cacheTtlMs: number; providers: Record<AiProvider, CatalogProviderResult> }> {
  const ttlMs = aiModelCatalogTtlMs();
  const list = options.provider ? [options.provider] : ALL_PROVIDERS;
  const entries = await Promise.all(
    list.map(async (p) => [p, await getModelCatalogForProvider(p, keys, options)] as const)
  );
  const providers = Object.fromEntries(entries) as Record<AiProvider, CatalogProviderResult>;
  if (options.provider) {
    for (const p of ALL_PROVIDERS) {
      if (!providers[p]) {
        providers[p] = buildResult(p, await readCacheFile(p), ttlMs, "static");
      }
    }
  }
  return { cacheTtlMs: ttlMs, providers };
}
