"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import type { NormalizedXPost, XSearchResponse } from "@/lib/xSearch/types";
import { XSearchCard } from "./XSearchCard";
import { XSearchFilters } from "./XSearchFilters";
import { XSearchStats } from "./XSearchStats";

const CACHE_PREFIX = "century-egg-xsearch:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`;
}

function parseFeedCache(raw: string | null | undefined): XSearchResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as XSearchResponse;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function XSearchFeed({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const tk = ticker?.trim() ?? "";
  const name = companyName?.trim() || undefined;
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const feedCacheKey = tk ? cacheKey(tk) : "";
  const feedCacheBlob = feedCacheKey ? preferences.feedCaches?.[feedCacheKey] : undefined;

  const [includeRetweets, setIncludeRetweets] = useState(false);
  const [language, setLanguage] = useState("en");
  const [sortMode, setSortMode] = useState<"relevance" | "recent" | "engagement">("relevance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<XSearchResponse | null>(null);

  const run = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/x/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: name,
          includeRetweets,
          language,
          limit: 100,
          sortMode,
        }),
      });
      const json = (await res.json()) as XSearchResponse & { error?: string };
      if (!res.ok) {
        setData(null);
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setData(json);
      setError(json.error ?? null);
      const k = cacheKey(tk);
      updatePreferences((p) => ({
        ...p,
        feedCaches: { ...(p.feedCaches ?? {}), [k]: JSON.stringify(json) },
      }));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [tk, name, includeRetweets, language, sortMode, updatePreferences]);

  // Cache-first: load saved results on tab open; only hit API when user clicks Refresh.
  useEffect(() => {
    if (!tk) {
      setData(null);
      setError(null);
      return;
    }
    if (!prefsReady) return;
    const cached = parseFeedCache(feedCacheBlob);
    setData(cached);
    setError(cached?.error ?? null);
  }, [tk, prefsReady, feedCacheBlob]);

  const posts = useMemo(() => {
    const base = (data?.posts ?? []) as NormalizedXPost[];
    if (sortMode === "recent") {
      return [...base].sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      });
    }
    if (sortMode === "engagement") {
      return [...base].sort((a, b) => {
        const ea =
          (a.metrics?.likeCount ?? 0) +
          (a.metrics?.repostCount ?? 0) * 2 +
          (a.metrics?.replyCount ?? 0) * 1.5 +
          (a.metrics?.quoteCount ?? 0) * 2.5 +
          (a.metrics?.impressionCount ?? 0) * 0.0005;
        const eb =
          (b.metrics?.likeCount ?? 0) +
          (b.metrics?.repostCount ?? 0) * 2 +
          (b.metrics?.replyCount ?? 0) * 1.5 +
          (b.metrics?.quoteCount ?? 0) * 2.5 +
          (b.metrics?.impressionCount ?? 0) * 0.0005;
        if (ea !== eb) return eb - ea;
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      });
    }
    // relevance: keep provider order (already scored on refresh); stable for cached view
    return base;
  }, [data, sortMode]);

  if (!tk) return null;

  return (
    <CompanyFeedTabShell
      description="Uses the official X API (no scraping). Last refresh per ticker is remembered on your account for quick reload."
      onRefresh={() => void run()}
      refreshBusy={loading}
      hasPayload={Boolean(data)}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as typeof sortMode)}
      sortOptions={[
        { value: "relevance", label: "Relevance" },
        { value: "recent", label: "Date (most recent)" },
        { value: "engagement", label: "Engagement" },
      ]}
      error={error}
      filterSection={
        <XSearchFilters
          includeRetweets={includeRetweets}
          onIncludeRetweetsChange={setIncludeRetweets}
          language={language}
          onLanguageChange={setLanguage}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          omitSort
        />
      }
      filterSectionTitle="Post filters"
      statsSection={<XSearchStats data={data} />}
    >
      {!loading && !error && data && posts.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No posts returned. Try including retweets or changing language in filters.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {posts.map((p) => (
          <li key={p.id}>
            <XSearchCard post={p} ticker={tk} />
          </li>
        ))}
      </ul>
    </CompanyFeedTabShell>
  );
}

