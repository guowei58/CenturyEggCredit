"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NewsAggregationResponse, NormalizedNewsArticle } from "@/lib/news/types";
import { PRODUCTION_NEWS_PROVIDER_IDS } from "@/lib/news/constants";
import { NewsCard } from "./NewsCard";
import { NewsFilters } from "./NewsFilters";
import { ProviderStatus } from "./ProviderStatus";

function filterArticles(
  articles: NormalizedNewsArticle[],
  providerFilter: string | "all",
  multiSourceOnly: boolean
): NormalizedNewsArticle[] {
  let out = articles;
  if (providerFilter !== "all") {
    out = out.filter((a) => a.providers.map((p) => p.toLowerCase()).includes(providerFilter.toLowerCase()));
  }
  if (multiSourceOnly) {
    out = out.filter((a) => a.providers.length >= 2);
  }
  return out;
}

export function NewsFeed({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const tk = ticker?.trim() ?? "";
  const name = companyName?.trim() || undefined;

  const [sortMode, setSortMode] = useState<"relevance" | "recent">("relevance");
  const [enabledFilter, setEnabledFilter] = useState<string | "all">("all");
  const [multiSourceOnly, setMultiSourceOnly] = useState(false);
  const [payload, setPayload] = useState<NewsAggregationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registeredIds = useMemo(() => [...PRODUCTION_NEWS_PROVIDER_IDS], []);

  const fetchNews = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: name,
          limit: 100,
          sortMode,
        }),
      });
      const data = (await res.json()) as NewsAggregationResponse & { error?: string };
      if (!res.ok) {
        setPayload(null);
        setError(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
        return;
      }
      setPayload(data as NewsAggregationResponse);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [tk, name, sortMode]);

  useEffect(() => {
    if (!tk) {
      setPayload(null);
      setError(null);
      return;
    }
    void fetchNews();
  }, [tk, name, sortMode, fetchNews]);

  const visible = useMemo(
    () => (payload ? filterArticles(payload.articles, enabledFilter, multiSourceOnly) : []),
    [payload, enabledFilter, multiSourceOnly]
  );

  if (!tk) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          Merged from configured feeds (Marketaux, Alpha Vantage, Finnhub). API keys are server-only.
        </p>
        <button
          type="button"
          onClick={() => void fetchNews()}
          disabled={loading}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <NewsFilters
        enabledFilter={enabledFilter}
        onEnabledFilterChange={setEnabledFilter}
        multiSourceOnly={multiSourceOnly}
        onMultiSourceOnlyChange={setMultiSourceOnly}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        registeredIds={registeredIds}
      />

      <ProviderStatus
        payload={
          payload
            ? {
                activeProviders: payload.activeProviders,
                disabledProviders: payload.disabledProviders,
                providerStats: payload.providerStats,
              }
            : null
        }
      />

      {error && (
        <p className="rounded border border-dashed p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {payload && !error && (
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          {payload.totalAfterDedupe} unique stor{payload.totalAfterDedupe === 1 ? "y" : "ies"} (from {payload.totalBeforeDedupe} raw) · showing {visible.length} after filters
        </p>
      )}

      {!loading && !error && payload && visible.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No articles match the current filters. Try widening the provider filter or clearing multi-source only.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {visible.map((article) => (
          <li key={article.id}>
            <NewsCard article={article} />
          </li>
        ))}
      </ul>
    </div>
  );
}
