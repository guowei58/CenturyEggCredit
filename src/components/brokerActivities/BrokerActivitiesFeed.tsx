"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import { formatActionLabel, formatRatingChange } from "@/lib/analystActivity/normalize";
import { formatPtChange } from "@/lib/analystActivity/priceTargetParse";
import type { AnalystActivityResponse } from "@/lib/analystActivity/types";

const CACHE_PREFIX = "century-egg-analyst-activity:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`;
}

function parseFeedCache(raw: string | null | undefined): AnalystActivityResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AnalystActivityResponse;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function BrokerActivitiesFeed({
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

  const [data, setData] = useState<AnalystActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"recent" | "confidence">("recent");

  const runRefresh = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyst-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk, companyName: name }),
      });
      const json = (await res.json()) as AnalystActivityResponse;
      if (!res.ok) {
        setData(null);
        setError(typeof json.error === "string" ? json.error : `Request failed (${res.status})`);
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
  }, [tk, name, updatePreferences]);

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

  const events = useMemo(() => {
    const list = data?.events ?? [];
    if (sortMode === "confidence") {
      return [...list].sort((a, b) => b.confidenceScore - a.confidenceScore);
    }
    return [...list].sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
  }, [data, sortMode]);

  if (!tk) return null;

  return (
    <CompanyFeedTabShell
      onRefresh={() => void runRefresh()}
      refreshBusy={loading}
      hasPayload={Boolean(data)}
      refreshLabel={data ? "Refresh" : "Load broker activity"}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as "recent" | "confidence")}
      sortOptions={[
        { value: "recent", label: "Date (most recent)" },
        { value: "confidence", label: "Confidence" },
      ]}
      error={error}
      showRefreshingBanner={Boolean(loading && data)}
      emptyState={
        !data && !loading && !error ? (
          <p
            className="rounded-md border border-dashed px-3 py-3 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
          >
            No saved broker activity for this ticker yet. Click{" "}
            <strong style={{ color: "var(--text)" }}>Load broker activity</strong> to fetch public sell-side metadata.
          </p>
        ) : undefined
      }
    >
      {!loading && data && events.length === 0 && !error ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No broker activity events matched from public sources. Try Refresh or check optional API keys in config.
        </p>
      ) : null}

      {events.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
                <th className="py-2 pr-2 font-medium">Date</th>
                <th className="py-2 pr-2 font-medium">Broker</th>
                <th className="py-2 pr-2 font-medium">Analyst</th>
                <th className="py-2 pr-2 font-medium">Action</th>
                <th className="py-2 pr-2 font-medium">Rating</th>
                <th className="py-2 pr-2 font-medium">PT</th>
                <th className="py-2 pr-2 font-medium">Headline</th>
                <th className="py-2 pr-2 font-medium">Source</th>
                <th className="py-2 font-medium">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b align-top" style={{ borderColor: "var(--border2)" }}>
                  <td className="py-2 pr-2 whitespace-nowrap" style={{ color: "var(--muted2)" }}>
                    {e.eventDate ?? "—"}
                  </td>
                  <td className="py-2 pr-2">{e.broker}</td>
                  <td className="py-2 pr-2" style={{ color: "var(--muted2)" }}>
                    {e.analystName ?? "—"}
                  </td>
                  <td className="py-2 pr-2">{formatActionLabel(e.actionType)}</td>
                  <td className="py-2 pr-2">{formatRatingChange(e.ratingPrior, e.ratingCurrent)}</td>
                  <td className="py-2 pr-2">{formatPtChange(e.priceTargetPrior, e.priceTargetCurrent, e.currency)}</td>
                  <td className="py-2 pr-2 max-w-[220px]">
                    <span title={e.snippet ?? undefined}>{e.headline}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <a
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {e.sourceName}
                    </a>
                  </td>
                  <td className="py-2">{e.confidenceScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </CompanyFeedTabShell>
  );
}
