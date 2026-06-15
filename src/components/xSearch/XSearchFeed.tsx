"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import type { NormalizedXPost, XSearchResponse } from "@/lib/xSearch/types";
import { filterBySearchIntent } from "@/lib/xSearch/filter/intentFilter";
import { filterLowQualityPosts } from "@/lib/xSearch/filter/qualityFilter";
import { engagementScore } from "@/lib/xSearch/ranking/rank";
import { xComSearchUrl } from "@/lib/xSearch/utils";
import { XSearchCard } from "./XSearchCard";
import { XSearchFilters } from "./XSearchFilters";

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
  const { ready: prefsReady, preferences } = useUserPreferences();
  const feedCacheKey = tk ? cacheKey(tk) : "";
  const feedCacheBlob = feedCacheKey ? preferences.feedCaches?.[feedCacheKey] : undefined;

  const [includeRetweets, setIncludeRetweets] = useState(false);
  const [language, setLanguage] = useState("en");
  const [sortMode, setSortMode] = useState<"relevance" | "recent" | "engagement">("engagement");
  const [data, setData] = useState<XSearchResponse | null>(null);

  const openXSearch = useCallback(() => {
    if (!tk) return;
    window.open(xComSearchUrl(tk, name), "_blank", "noopener,noreferrer");
  }, [tk, name]);

  // Cache-first: show saved API results if any; API ingest paused — use Find Twits for X.com search.
  useEffect(() => {
    if (!tk) {
      setData(null);
      return;
    }
    if (!prefsReady) return;
    const cached = parseFeedCache(feedCacheBlob);
    if (cached?.posts?.length) {
      setData(cached);
    } else {
      setData(null);
    }
  }, [tk, prefsReady, feedCacheBlob]);

  const posts = useMemo(() => {
    const base = (data?.posts ?? []) as NormalizedXPost[];
    const { kept: intentMatched } = filterBySearchIntent(base, {
      ticker: tk,
      companyName: name,
    });
    const { kept } = filterLowQualityPosts(intentMatched);
    if (sortMode === "recent") {
      return [...kept].sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      });
    }
    if (sortMode === "engagement") {
      return [...kept].sort((a, b) => {
        const ea = engagementScore(a);
        const eb = engagementScore(b);
        if (ea !== eb) return eb - ea;
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      });
    }
    return kept;
  }, [data, sortMode, tk, name]);

  if (!tk) return null;

  return (
    <CompanyFeedTabShell
      onRefresh={openXSearch}
      refreshLabel="Find Twits"
      hasPayload={Boolean(data)}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as typeof sortMode)}
      sortOptions={[
        { value: "relevance", label: "Relevance" },
        { value: "recent", label: "Date (most recent)" },
        { value: "engagement", label: "Engagement" },
      ]}
      emptyState={
        !data ? (
          <p
            className="rounded-md border border-dashed px-3 py-3 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
          >
            In-app X API search is paused. Click <strong style={{ color: "var(--text)" }}>Find Twits</strong> to
            open X.com search for <strong style={{ color: "var(--text)" }}>${tk.toUpperCase()}</strong> in a new tab.
          </p>
        ) : undefined
      }
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
      statsSection={
        data ? (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            {data.finalCount} saved post{data.finalCount === 1 ? "" : "s"} from earlier API run
            {(data.filteredCount ?? 0) > 0 ? ` (${data.filteredCount} hidden as low quality)` : ""}
          </p>
        ) : null
      }
    >
      {data && posts.length === 0 ? (
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

