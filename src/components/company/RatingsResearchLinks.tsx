"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { rankResults } from "@/lib/ratings-link-search/ranker";
import type { DiscoverRatingsLinksOutput, NormalizedRatingsLink, RatingsAgency } from "@/lib/ratings-link-search/types";
import { Card } from "@/components/ui";
import { RatingsResearchLinkCard } from "./RatingsResearchLinkCard";

const CACHE_PREFIX = "century-egg-ratings-links:";

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker.trim().toUpperCase()}`;
}

function parseRatingsCache(raw: string | null | undefined): DiscoverRatingsLinksOutput | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as DiscoverRatingsLinksOutput;
    return o && typeof o === "object" && Array.isArray(o.results) ? o : null;
  } catch {
    return null;
  }
}

type AgencyFilter = "all" | RatingsAgency;
type TypeFilter = "all" | "issuer_rating" | "issue_rating" | "rating_action" | "research";

type SortMode = "relevance" | "recent" | "agency";

const AGENCY_CHIPS: Array<{ id: AgencyFilter; label: string }> = [
  { id: "all", label: "All agencies" },
  { id: "Fitch", label: "Fitch" },
  { id: "Moody's", label: "Moody's" },
  { id: "S&P", label: "S&P" },
];

const TYPE_CHIPS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All types" },
  { id: "issuer_rating", label: "Issuer" },
  { id: "issue_rating", label: "Notes / issues" },
  { id: "rating_action", label: "Rating actions" },
  { id: "research", label: "Research" },
];

function chipClass(active: boolean): string {
  return `rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors sm:text-xs ${
    active ? "border-[var(--accent)] text-[var(--accent)]" : "opacity-90"
  }`;
}

function applyTypeFilter(r: NormalizedRatingsLink, f: TypeFilter): boolean {
  if (f === "all") return true;
  if (f === "research") return r.resultType === "research" || r.resultType === "commentary";
  return r.resultType === f;
}

export function RatingsResearchLinks({
  ticker,
  companyName: initialCompanyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  const tkProp = ticker.trim().toUpperCase();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const feedCacheKey = tkProp ? cacheKey(tkProp) : "";
  const feedCacheBlob = feedCacheKey ? preferences.feedCaches?.[feedCacheKey] : undefined;

  const [inputTicker, setInputTicker] = useState(ticker.toUpperCase());
  const [companyName, setCompanyName] = useState((initialCompanyName ?? "").trim());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DiscoverRatingsLinksOutput | null>(null);
  const [agencyFilter, setAgencyFilter] = useState<AgencyFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("relevance");

  useEffect(() => {
    setInputTicker(ticker.toUpperCase());
  }, [ticker]);

  useEffect(() => {
    if (initialCompanyName?.trim()) setCompanyName(initialCompanyName.trim());
  }, [initialCompanyName]);

  useEffect(() => {
    if (!tkProp) {
      setPayload(null);
      setError(null);
      return;
    }
    if (!prefsReady) return;
    const cached = parseRatingsCache(feedCacheBlob);
    setPayload(cached);
    setError(null);
  }, [tkProp, prefsReady, feedCacheBlob]);

  const runSearch = useCallback(async () => {
    const tk = inputTicker.trim().toUpperCase();
    if (!tk) {
      setError("Enter a ticker.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ratings-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: tk,
          companyName: companyName.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as DiscoverRatingsLinksOutput & { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
        return;
      }
      if ("results" in data && Array.isArray(data.results)) {
        const next = data as DiscoverRatingsLinksOutput;
        setPayload(next);
        if (data.company?.companyName) setCompanyName(data.company.companyName);
        const k = cacheKey(tk);
        updatePreferences((p) => ({
          ...p,
          feedCaches: { ...(p.feedCaches ?? {}), [k]: JSON.stringify(next) },
        }));
      } else {
        setError("Unexpected response from server.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [inputTicker, companyName, updatePreferences]);

  const baseResults = useMemo(() => payload?.results ?? [], [payload]);

  const sorted = useMemo(
    () => rankResults([...baseResults], sortMode),
    [baseResults, sortMode]
  );

  const visible = useMemo(() => {
    return sorted.filter((r) => {
      if (agencyFilter !== "all" && r.agency !== agencyFilter) return false;
      return applyTypeFilter(r, typeFilter);
    });
  }, [sorted, agencyFilter, typeFilter]);

  return (
    <div className="space-y-6">
      <Card title="Ratings / Research Links">
        <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          Official links from Fitch, Moody&apos;s, and S&amp;P (issuer/issue pages, rating actions, research)
          discovered via web search. We only show agency domains — no paywalled body text is scraped or reproduced.
        </p>
        <p className="mb-4 text-[12px] leading-relaxed italic" style={{ color: "var(--warn)" }}>
          These are official agency links. Access may require a free account, subscription, or institutional entitlement.
          We do not claim you have access, and we do not infer ratings unless they appear explicitly in search metadata.
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--muted)" }}>
            Ticker
            <input
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
              className="rounded-md border bg-[var(--card)] px-3 py-2 font-mono text-sm outline-none"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              placeholder="LUMN"
            />
          </label>
          <label className="min-w-[12rem] flex flex-1 flex-col gap-1 text-[11px]" style={{ color: "var(--muted)" }}>
            Company name (optional, improves queries)
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              placeholder="Resolved from SEC when empty"
            />
          </label>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading}
            className="rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              background: "rgba(0, 212, 170, 0.1)",
            }}
          >
            {loading ? "Searching…" : payload ? "Refresh" : "Search agency links"}
          </button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--danger)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {loading && payload && (
        <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
          Refreshing… previous results stay visible until the new search finishes.
        </p>
      )}

      {payload && (
        <>
          {baseResults.length === 0 ? (
            <div className="rounded-lg border p-6 text-center text-sm leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>
              No official agency links were returned for this search. Try broader issuer names, financing entity legal names,
              or confirm your Serper (<code className="text-[10px]">SERPER_API_KEY</code>) configuration and quota.
            </div>
          ) : (
            <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Filter
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AGENCY_CHIPS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={chipClass(agencyFilter === c.id)}
                    style={{
                      background: agencyFilter === c.id ? "rgba(0,212,170,0.12)" : "var(--sb)",
                      borderColor: "var(--border2)",
                      color: agencyFilter === c.id ? undefined : "var(--muted2)",
                    }}
                    onClick={() => setAgencyFilter(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TYPE_CHIPS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={chipClass(typeFilter === c.id)}
                    style={{
                      background: typeFilter === c.id ? "rgba(0,212,170,0.12)" : "var(--sb)",
                      borderColor: "var(--border2)",
                      color: typeFilter === c.id ? undefined : "var(--muted2)",
                    }}
                    onClick={() => setTypeFilter(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Sort
              </div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                <option value="relevance">Relevance</option>
                <option value="recent">Most recent</option>
                <option value="agency">Agency</option>
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>
              No official agency links matched your filters. Try{" "}
              <strong className="text-[var(--text)]">All agencies</strong> /{" "}
              <strong className="text-[var(--text)]">All types</strong>, or run a new search with broader issuer or
              debt-entity names.
            </div>
          ) : (
            <ul className="space-y-4">
              {visible.map((item) => (
                <li key={item.id}>
                  <RatingsResearchLinkCard
                    item={item}
                    ticker={payload.company.ticker.trim().toUpperCase() || inputTicker.trim().toUpperCase()}
                  />
                </li>
              ))}
            </ul>
          )}
            </>
          )}

          <details className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
            <summary className="cursor-pointer font-medium" style={{ color: "var(--muted2)" }}>
              Queries run ({payload.queriesRun.length})
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {payload.queriesRun.map((q) => (
                <li key={q} className="break-words font-mono">
                  {q}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      {!payload && !loading && !error && (
        <div className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>
          No saved results for this ticker yet. Click <strong className="text-[var(--text)]">Search agency links</strong> to query
          Fitch, Moody&apos;s, and S&amp;P via Serper. Results are kept until you refresh. Set{" "}
          <code className="text-[var(--accent)]">SERPER_API_KEY</code> in <code>.env.local</code>.
        </div>
      )}
    </div>
  );
}
