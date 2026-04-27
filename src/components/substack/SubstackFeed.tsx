"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import type { SubstackSearchResponse } from "@/lib/substack/types";
import { rankResults, type SortMode } from "@/lib/substack/search/rank";
import { SubstackCoveragePanel } from "./SubstackCoveragePanel";
import { SubstackSearchResults } from "./SubstackSearchResults";

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
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
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
  const displayResults = useMemo(() => rankResults([...results], sortMode), [results, sortMode]);

  return (
    <CompanyFeedTabShell
      description="Coverage-first discovery of public Substack posts mentioning this ticker. Indexed registry plus optional live Serper discovery. Results are saved per ticker until you refresh."
      onRefresh={run}
      refreshBusy={loading}
      refreshDisabled={!tk}
      hasPayload={Boolean(data)}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as SortMode)}
      sortOptions={[
        { value: "relevance", label: "Relevance" },
        { value: "recent", label: "Date (most recent)" },
        { value: "publication", label: "Publication (A–Z)" },
      ]}
      error={error}
      showRefreshingBanner={Boolean(loading && data)}
      emptyState={
        !data && !loading && !error ? (
          <p
            className="rounded-md border border-dashed px-3 py-3 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
          >
            No saved Substack run for this ticker yet. Open <strong style={{ color: "var(--text)" }}>Search options & filters</strong> if
            needed, then click <strong style={{ color: "var(--text)" }}>Load</strong>.
          </p>
        ) : undefined
      }
      filterSection={
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Result filter
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
          </div>
          <details className="rounded-md border px-3 py-2" style={{ borderColor: "var(--border2)" }}>
            <summary className="cursor-pointer text-xs font-semibold" style={{ color: "var(--muted2)" }}>
              Coverage & index
            </summary>
            <div className="mt-3">
              <SubstackCoveragePanel data={data} />
            </div>
          </details>
        </div>
      }
      filterSectionTitle="Search options & filters"
    >
      <SubstackSearchResults items={displayResults} ticker={tk} />
    </CompanyFeedTabShell>
  );
}
