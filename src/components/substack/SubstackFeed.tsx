"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import type { SubstackSearchResponse } from "@/lib/substack/types";
import { SubstackCoveragePanel } from "./SubstackCoveragePanel";
import { SubstackSearchResults } from "./SubstackSearchResults";
import { PublicationRegistryPanel } from "./PublicationRegistryPanel";

const CACHE_PREFIX = "century-egg-substack:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.toUpperCase()}`;
}

function parseFeedCache(raw: string | null | undefined): SubstackSearchResponse | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubstackSearchResponse;
  } catch {
    return null;
  }
}

export function SubstackFeed({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const name = companyName?.trim() || "";
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const feedCacheKey = tk ? cacheKey(tk) : "";
  const feedCacheBlob = feedCacheKey ? preferences.feedCaches?.[feedCacheKey] : undefined;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SubstackSearchResponse | null>(null);
  const [sortMode, setSortMode] = useState<"relevance" | "recent" | "publication">("relevance");
  const [filterMode, setFilterMode] = useState<"all" | "indexed_only" | "live_only" | "high_confidence">("all");
  const [liveDiscovery, setLiveDiscovery] = useState(true);

  useEffect(() => {
    if (!tk) return;
    if (!prefsReady) return;
    const cached = parseFeedCache(feedCacheBlob);
    setData(cached);
    setError(cached?.error ?? null);
  }, [tk, prefsReady, feedCacheBlob]);

  const run = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/substack/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: name || undefined,
          aliases: [],
          liveDiscovery,
          sortMode,
          filterMode,
          maxResults: 80,
        }),
      });
      const json = (await res.json()) as SubstackSearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Substack search failed");
      setData(json);
      setError(json.error ?? null);
      const k = cacheKey(tk);
      updatePreferences((p) => ({
        ...p,
        feedCaches: { ...(p.feedCaches ?? {}), [k]: JSON.stringify(json) },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Substack search failed");
    } finally {
      setLoading(false);
    }
  }, [tk, name, liveDiscovery, sortMode, filterMode, updatePreferences]);

  const results = useMemo(() => data?.results ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Sort
          </div>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            <option value="relevance">Relevance</option>
            <option value="recent">Most recent</option>
            <option value="publication">Publication</option>
          </select>
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Filter
          </div>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
            className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            <option value="all">All results</option>
            <option value="indexed_only">Indexed only</option>
            <option value="live_only">Live discovery only</option>
            <option value="high_confidence">High confidence only</option>
          </select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
          <input type="checkbox" checked={liveDiscovery} onChange={(e) => setLiveDiscovery(e.target.checked)} />
          Live discovery (Serper)
        </label>

        <button
          type="button"
          onClick={run}
          disabled={loading || !tk}
          className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded border border-dashed p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SubstackSearchResults items={results} ticker={tk} />
        </div>
        <div className="space-y-3">
          <SubstackCoveragePanel data={data} />
          <PublicationRegistryPanel />
        </div>
      </div>
    </div>
  );
}

