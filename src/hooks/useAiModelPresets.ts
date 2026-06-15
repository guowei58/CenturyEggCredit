"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import type { AiProvider } from "@/lib/ai-provider";
import { presetsForProvider, type ModelPreset } from "@/lib/ai-model-options";
import { mergeModelPresets } from "@/lib/merge-ai-model-presets";

const ALL_PROVIDERS: AiProvider[] = ["claude", "openai", "gemini", "deepseek"];
const SESSION_KEY = "oreo-ai-model-catalog-v1";

type CatalogResponse = {
  ok: boolean;
  cacheTtlMs?: number;
  providers?: Partial<
    Record<
      AiProvider,
      {
        presets: ModelPreset[];
        fetchedAt: string | null;
        stale: boolean;
        source: string;
        error?: string;
      }
    >
  >;
};

type SessionCache = {
  fetchedAt: number;
  ttlMs: number;
  providers: Partial<Record<AiProvider, ModelPreset[]>>;
};

function staticFallback(): Record<AiProvider, ModelPreset[]> {
  return Object.fromEntries(ALL_PROVIDERS.map((p) => [p, presetsForProvider(p)])) as Record<
    AiProvider,
    ModelPreset[]
  >;
}

function readSessionCache(): SessionCache | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionCache;
  } catch {
    return null;
  }
}

function writeSessionCache(data: SessionCache): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

function mergeWithStatic(providers: Partial<Record<AiProvider, ModelPreset[]>>): Record<AiProvider, ModelPreset[]> {
  const out = staticFallback();
  for (const p of ALL_PROVIDERS) {
    const remote = providers[p];
    if (remote?.length) out[p] = mergeModelPresets(out[p], remote);
  }
  return out;
}

async function fetchCatalog(forceRefresh: boolean): Promise<{ ttlMs: number; providers: Partial<Record<AiProvider, ModelPreset[]>> }> {
  const url = forceRefresh ? "/api/ai-model-catalog?refresh=1" : "/api/ai-model-catalog";
  const res = await fetch(url, { cache: "no-store" });
  const j = (await res.json()) as CatalogResponse;
  if (!res.ok || !j.ok || !j.providers) {
    throw new Error("Failed to load model catalog");
  }
  const providers: Partial<Record<AiProvider, ModelPreset[]>> = {};
  for (const p of ALL_PROVIDERS) {
    providers[p] = j.providers[p]?.presets;
  }
  return { ttlMs: j.cacheTtlMs ?? 24 * 60 * 60 * 1000, providers };
}

let sharedLoad: Promise<void> | null = null;
let sharedPresets: Record<AiProvider, ModelPreset[]> = staticFallback();
let sharedFetchedAt = 0;
let sharedTtlMs = 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

function isSharedStale(): boolean {
  if (!sharedFetchedAt) return true;
  return Date.now() - sharedFetchedAt >= sharedTtlMs;
}

async function ensureCatalogLoaded(forceRefresh = false): Promise<void> {
  if (!forceRefresh && !isSharedStale()) return;
  if (sharedLoad) return sharedLoad;

  sharedLoad = (async () => {
    const cached = !forceRefresh ? readSessionCache() : null;
    if (cached && Date.now() - cached.fetchedAt < cached.ttlMs) {
      sharedPresets = mergeWithStatic(cached.providers);
      sharedFetchedAt = cached.fetchedAt;
      sharedTtlMs = cached.ttlMs;
      notifyListeners();
      return;
    }

    try {
      const { ttlMs, providers } = await fetchCatalog(forceRefresh);
      sharedPresets = mergeWithStatic(providers);
      sharedFetchedAt = Date.now();
      sharedTtlMs = ttlMs;
      writeSessionCache({ fetchedAt: sharedFetchedAt, ttlMs, providers });
    } catch {
      if (cached) {
        sharedPresets = mergeWithStatic(cached.providers);
        sharedFetchedAt = cached.fetchedAt;
        sharedTtlMs = cached.ttlMs;
      }
    } finally {
      notifyListeners();
      sharedLoad = null;
    }
  })();

  return sharedLoad;
}

/** Merged presets for one provider (static immediately, then provider catalog when available). */
export function useAiModelPresets(provider: AiProvider): { presets: ModelPreset[]; loading: boolean } {
  const { status } = useSession();
  const [, tick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener = () => {
      if (mounted.current) tick((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      mounted.current = false;
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void ensureCatalogLoaded(false);
  }, [status]);

  const presets = useMemo(
    () => sharedPresets[provider] ?? presetsForProvider(provider),
    [provider, sharedFetchedAt]
  );

  return {
    presets,
    loading: status === "authenticated" && isSharedStale() && sharedLoad != null,
  };
}

/** All providers — used where multiple model dropdowns render on one screen. */
export function useAllAiModelPresets(): {
  presetsByProvider: Record<AiProvider, ModelPreset[]>;
  loading: boolean;
  refreshIfStale: () => void;
} {
  const { status } = useSession();
  const [, tick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener = () => {
      if (mounted.current) tick((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      mounted.current = false;
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void ensureCatalogLoaded(false);
  }, [status]);

  const refreshIfStale = useCallback(() => {
    if (status !== "authenticated") return;
    void ensureCatalogLoaded(isSharedStale());
  }, [status]);

  return {
    presetsByProvider: sharedPresets,
    loading: status === "authenticated" && isSharedStale() && sharedLoad != null,
    refreshIfStale,
  };
}
