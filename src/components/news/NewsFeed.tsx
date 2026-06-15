"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import { rankArticles } from "@/lib/news/rank";
import { isLikelyTickerInstrumentPage } from "@/lib/news/stockPageFilter";
import type { NewsAggregationResponse, NewsQueryParams } from "@/lib/news/types";
import { NewsCard } from "./NewsCard";

const CACHE_PREFIX = "century-egg-news:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`;
}

function parseNewsCache(raw: string | null | undefined): NewsAggregationResponse | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as NewsAggregationResponse;
    return o && typeof o === "object" && Array.isArray(o.articles) ? o : null;
  } catch {
    return null;
  }
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
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const feedCacheKey = tk ? cacheKey(tk) : "";
  const feedCacheBlob = feedCacheKey ? preferences.feedCaches?.[feedCacheKey] : undefined;

  const [aliasesText, setAliasesText] = useState("");
  const aliasesRef = useRef(aliasesText);
  aliasesRef.current = aliasesText;
  const [sortMode, setSortMode] = useState<"relevance" | "recent">("relevance");
  const [payload, setPayload] = useState<NewsAggregationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hadRealCompanyNameRef = useRef(false);

  useEffect(() => {
    if (!tk) {
      setPayload(null);
      setError(null);
      return;
    }
    if (!prefsReady) return;
    const cached = parseNewsCache(feedCacheBlob);
    setPayload(cached);
    setError(null);
  }, [tk, prefsReady, feedCacheBlob]);

  useEffect(() => {
    hadRealCompanyNameRef.current = false;
  }, [tk]);

  const aliasList = useMemo(
    () => aliasesText.split(",").map((s) => s.trim()).filter((s) => s.length >= 2),
    [aliasesText]
  );

  const rankQuery = useMemo(
    (): NewsQueryParams => ({
      ticker: tk,
      companyName: name,
      aliases: aliasList.length ? aliasList : undefined,
    }),
    [tk, name, aliasList]
  );

  const fetchNews = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const aliases = aliasesRef.current
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: name,
          aliases: aliases.length ? aliases : undefined,
          limit: 100,
          sortMode: "relevance",
        }),
      });
      const data = (await res.json()) as NewsAggregationResponse & { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
        return;
      }
      const next = data as NewsAggregationResponse;
      setPayload(next);
      const k = cacheKey(tk);
      updatePreferences((p) => ({
        ...p,
        feedCaches: { ...(p.feedCaches ?? {}), [k]: JSON.stringify(next) },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [tk, name, updatePreferences]);

  /** When SEC/company name finishes loading, refetch once so Google News gets full entity terms. */
  useEffect(() => {
    const realName = Boolean(name && name.toUpperCase() !== tk.toUpperCase());
    if (!realName) return;
    if (hadRealCompanyNameRef.current) return;
    hadRealCompanyNameRef.current = true;
    if (!payload || loading) return;
    void fetchNews();
  }, [name, tk, payload, loading, fetchNews]);

  const visible = useMemo(() => {
    if (!payload) return [];
    return rankArticles(payload.articles, rankQuery, sortMode).filter(
      (article) =>
        !isLikelyTickerInstrumentPage({
          title: article.title,
          url: article.url,
          sourceDomain: article.sourceDomain,
        })
    );
  }, [payload, rankQuery, sortMode]);

  if (!tk) {
    return null;
  }

  return (
    <CompanyFeedTabShell
      onRefresh={() => void fetchNews()}
      refreshBusy={loading}
      hasPayload={Boolean(payload)}
      refreshLabel={payload ? "Refresh" : "Load news"}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as "relevance" | "recent")}
      sortOptions={[
        { value: "relevance", label: "Relevance" },
        { value: "recent", label: "Date (most recent)" },
      ]}
      error={error}
      showRefreshingBanner={Boolean(loading && payload)}
      emptyState={
        !payload && !loading && !error ? (
          <p
            className="rounded-md border border-dashed px-3 py-3 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
          >
            No saved news for this ticker yet. Click <strong style={{ color: "var(--text)" }}>Load news</strong> to fetch; results stay
            here until you refresh.
          </p>
        ) : undefined
      }
      filterSection={
        <label className="text-[11px]" style={{ color: "var(--muted2)" }}>
          <span className="mb-1 block font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Search aliases (optional)
          </span>
          <input
            type="text"
            value={aliasesText}
            onChange={(e) => setAliasesText(e.target.value)}
            placeholder='e.g. "Lumen Technologies", CenturyLink — comma-separated'
            className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          />
          <span className="mt-1 block text-[10px]" style={{ color: "var(--muted)" }}>
            Applied when you click Refresh (Google News query) and for ranking on this page.
          </span>
        </label>
      }
      statsSection={
        payload && !error ? (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            {payload.totalAfterDedupe} unique stor{payload.totalAfterDedupe === 1 ? "y" : "ies"} (from {payload.totalBeforeDedupe} raw)
          </p>
        ) : null
      }
    >
      {!loading && !error && payload && visible.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No articles returned for this ticker.
        </p>
      ) : null}
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border2)" }}>
        {visible.map((article) => (
          <li key={article.id}>
            <NewsCard article={article} ticker={tk} />
          </li>
        ))}
      </ul>
    </CompanyFeedTabShell>
  );
}
