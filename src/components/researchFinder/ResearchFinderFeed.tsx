"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import { ResearchFinderResultCard } from "@/components/researchFinder/ResearchFinderResultCard";
import type { ResearchFinderSearchResponse, ResearchProviderId } from "@/lib/researchFinder/types";

const PROVIDERS: Array<{ id: ResearchProviderId; label: string }> = [
  { id: "octus", label: "Octus" },
  { id: "creditsights", label: "CreditSights" },
  { id: "9fin", label: "9fin" },
  { id: "debtwire", label: "Debtwire" },
  { id: "wsj_bankruptcy", label: "WSJ Pro Bankruptcy" },
];

const CACHE_PREFIX = "century-egg-research-finder:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.toUpperCase()}`;
}

function parseFeedCache(raw: string | null | undefined): ResearchFinderSearchResponse | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResearchFinderSearchResponse;
  } catch {
    return null;
  }
}

export function ResearchFinderFeed({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const [name, setName] = useState((companyName ?? "").trim());
  const [aliases, setAliases] = useState("");
  const [selected, setSelected] = useState<Set<ResearchProviderId>>(new Set(PROVIDERS.map((p) => p.id)));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResearchFinderSearchResponse | null>(null);
  const [sortMode, setSortMode] = useState<"relevance" | "recent">("relevance");
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const feedCacheKey = tk ? cacheKey(tk) : "";
  const feedCacheBlob = feedCacheKey ? preferences.feedCaches?.[feedCacheKey] : undefined;

  useEffect(() => {
    if (!tk) return;
    if (!prefsReady) return;
    const cached = parseFeedCache(feedCacheBlob);
    setData(cached);
    setError(cached?.error ?? null);
  }, [tk, prefsReady, feedCacheBlob]);

  useEffect(() => {
    if (companyName?.trim()) setName(companyName.trim());
  }, [companyName]);

  const providers = useMemo(() => Array.from(selected.values()), [selected]);

  const run = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/research-finder/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: name || undefined,
          aliases: aliases
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          providers,
          maxResults: 120,
        }),
      });
      const json = (await res.json()) as ResearchFinderSearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Search failed");
      setData(json);
      setError(null);
      const k = cacheKey(tk);
      updatePreferences((p) => ({
        ...p,
        feedCaches: { ...(p.feedCaches ?? {}), [k]: JSON.stringify(json) },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [tk, name, aliases, providers, updatePreferences]);

  const results = data?.results ?? [];

  const sortedResults = useMemo(() => {
    const copy = [...results];
    if (sortMode === "recent") {
      return copy.sort((a, b) => {
        const ta = a.publication_date ? Date.parse(a.publication_date) : 0;
        const tb = b.publication_date ? Date.parse(b.publication_date) : 0;
        return tb - ta;
      });
    }
    return copy.sort((a, b) => b.match_score - a.match_score);
  }, [results, sortMode]);

  const summary = data?.summary ?? null;

  return (
    <CompanyFeedTabShell
      onRefresh={run}
      refreshBusy={loading}
      refreshDisabled={providers.length === 0}
      hasPayload={Boolean(data)}
      refreshLabel={data ? "Refresh" : "Load research"}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as "relevance" | "recent")}
      sortOptions={[
        { value: "relevance", label: "Relevance" },
        { value: "recent", label: "Date (most recent)" },
      ]}
      error={error}
      showRefreshingBanner={Boolean(loading && data)}
      emptyState={
        !data && !loading && !error ? (
          <p
            className="rounded-md border border-dashed px-3 py-3 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
          >
            No saved run for this ticker yet. Open <strong style={{ color: "var(--text)" }}>Search options & filters</strong> if needed,
            then click <strong style={{ color: "var(--text)" }}>Load research</strong>.
          </p>
        ) : undefined
      }
      filterSection={
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Company name (optional)
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                placeholder="Optional — override if different from overview"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Aliases (comma-separated)
              </div>
              <input
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                placeholder="Optional — former names, brands, subsidiaries"
              />
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Providers
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {PROVIDERS.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                    className="rounded border px-3 py-2 text-xs font-semibold"
                    style={{
                      borderColor: on ? "var(--accent)" : "var(--border2)",
                      color: on ? "var(--accent)" : "var(--text)",
                      background: on ? "rgba(0,212,170,0.08)" : "transparent",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      }
      statsSection={
        summary && !error ? (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            {summary.keptResults} result{summary.keptResults === 1 ? "" : "s"} kept (from {summary.candidateUrls} candidates — high{" "}
            {summary.confidence.high}, medium {summary.confidence.medium}, low {summary.confidence.low})
          </p>
        ) : null
      }
    >
      {!error && summary && summary.candidateUrls > 0 && results.length === 0 ? (
        <div
          className="mb-3 rounded-md border border-dashed px-3 py-2 text-xs leading-relaxed"
          style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
        >
          We found candidate links from the selected providers, but none scored high enough after title/snippet analysis. Try adding{" "}
          <strong className="font-semibold" style={{ color: "var(--text)" }}>aliases</strong>
          , tightening the company name, or running search again later.
        </div>
      ) : null}
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border2)" }}>
        {sortedResults.map((r) => (
          <li key={r.id}>
            <ResearchFinderResultCard item={r} ticker={tk} />
          </li>
        ))}
      </ul>
    </CompanyFeedTabShell>
  );
}
