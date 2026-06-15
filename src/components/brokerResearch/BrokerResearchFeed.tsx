"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { CompanyFeedTabShell } from "@/components/company/CompanyFeedTabShell";
import { PRODUCTION_BROKER_IDS } from "@/lib/brokerResearch/constants";
import type {
  BrokerAccessLevel,
  BrokerReportType,
  BrokerResearchResponse,
  BrokerResearchResult,
} from "@/lib/brokerResearch/types";
import { BrokerResearchCard } from "./BrokerResearchCard";
import { BrokerResearchFilters } from "./BrokerResearchFilters";

const CACHE_PREFIX = "century-egg-broker-research:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`;
}

function parseFeedCache(raw: string | null | undefined): BrokerResearchResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BrokerResearchResponse;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function filterItems(
  items: BrokerResearchResult[],
  broker: string | "all",
  type: BrokerReportType | "all",
  access: BrokerAccessLevel | "all"
): BrokerResearchResult[] {
  return items.filter((r) => {
    if (broker !== "all" && r.brokerId !== broker) return false;
    if (type !== "all" && r.reportType !== type) return false;
    if (access !== "all" && r.accessLevel !== access) return false;
    return true;
  });
}

function dateKey(iso: string | null): string {
  if (!iso) return "Undated";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Undated";
  return d.toISOString().slice(0, 10);
}

export function BrokerResearchFeed({
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

  const [data, setData] = useState<BrokerResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"relevance" | "recent">("relevance");
  const [brokerFilter, setBrokerFilter] = useState<string | "all">("all");
  const [typeFilter, setTypeFilter] = useState<BrokerReportType | "all">("all");
  const [accessFilter, setAccessFilter] = useState<BrokerAccessLevel | "all">("all");
  const [timelineMode, setTimelineMode] = useState(false);

  const brokerIds = useMemo(() => [...PRODUCTION_BROKER_IDS], []);

  const runSearch = useCallback(async () => {
    if (!tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/broker-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: name,
          maxResults: 200,
          sortMode,
        }),
      });
      const json = (await res.json()) as BrokerResearchResponse & { error?: string };
      if (!res.ok) {
        setData(null);
        setError(typeof json.error === "string" ? json.error : `Request failed (${res.status})`);
        return;
      }
      if (json.error && json.reports.length === 0) {
        setError(json.error);
        setData(json);
        const k = cacheKey(tk);
        updatePreferences((p) => ({
          ...p,
          feedCaches: { ...(p.feedCaches ?? {}), [k]: JSON.stringify(json) },
        }));
        return;
      }
      setData(json);
      if (json.error) setError(json.error);
      else setError(null);
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
  }, [tk, name, sortMode, updatePreferences]);

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

  const visible = useMemo(() => {
    if (!data) return [];
    const filtered = filterItems(data.reports, brokerFilter, typeFilter, accessFilter);
    if (sortMode === "recent") {
      return [...filtered].sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      });
    }
    return filtered;
  }, [data, brokerFilter, typeFilter, accessFilter, sortMode]);

  const groupedByDate = useMemo(() => {
    const m = new Map<string, BrokerResearchResult[]>();
    for (const r of visible) {
      const k = dateKey(r.publishedAt);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    const keys = Array.from(m.keys()).sort((a, b) => {
      if (a === "Undated") return 1;
      if (b === "Undated") return -1;
      return b.localeCompare(a);
    });
    return keys.map((k) => ({ date: k, items: m.get(k)! }));
  }, [visible]);

  if (!tk) return null;

  return (
    <CompanyFeedTabShell
      onRefresh={() => void runSearch()}
      refreshBusy={loading}
      hasPayload={Boolean(data)}
      refreshLabel={data ? "Refresh" : "Load broker research"}
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
            No saved broker research for this ticker yet. Open{" "}
            <strong style={{ color: "var(--text)" }}>Search options & filters</strong> if needed, then click{" "}
            <strong style={{ color: "var(--text)" }}>Load broker research</strong>.
          </p>
        ) : undefined
      }
      filterSection={
        <BrokerResearchFilters
          brokerFilter={brokerFilter}
          onBrokerFilterChange={setBrokerFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          accessFilter={accessFilter}
          onAccessFilterChange={setAccessFilter}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          timelineMode={timelineMode}
          onTimelineModeChange={setTimelineMode}
          brokerIds={brokerIds}
          omitSort
        />
      }
      statsSection={
        data && !error ? (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            {data.reports.length} report{data.reports.length === 1 ? "" : "s"} (from {data.resultsBeforeDedupe} raw,{" "}
            {data.resultsAfterDedupe} deduped)
          </p>
        ) : null
      }
    >
      {!loading && data && visible.length === 0 && !error ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No results match the current filters.
        </p>
      ) : null}

      {timelineMode ? (
        <div className="flex flex-col gap-6">
          {groupedByDate.map(({ date, items }) => (
            <section key={date}>
              <h4 className="mb-2 border-b pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {date}
              </h4>
              <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border2)" }}>
                {items.map((item) => (
                  <li key={item.id}>
                    <BrokerResearchCard item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border2)" }}>
          {visible.map((item) => (
            <li key={item.id}>
              <BrokerResearchCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </CompanyFeedTabShell>
  );
}
