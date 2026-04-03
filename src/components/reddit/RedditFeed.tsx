"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RedditPostResult, RedditSearchResponse, RedditConfidence, RedditTimeRange, RedditSortMode } from "@/lib/reddit/types";

type UiFilter =
  | "all"
  | "high"
  | "medium"
  | "low"
  | "external"
  | "self"
  | "most_commented"
  | "highest_score";

type UiSort = "relevance" | "newest" | "oldest" | "comments" | "score" | "subreddit";

function fmtUtc(sec: number): string {
  if (!sec) return "";
  try {
    return new Date(sec * 1000).toLocaleString();
  } catch {
    return String(sec);
  }
}

function confidenceBadge(c: RedditConfidence): string {
  switch (c) {
    case "high":
      return "bg-emerald-900/40 text-emerald-200 border-emerald-700";
    case "medium":
      return "bg-amber-900/30 text-amber-100 border-amber-700";
    default:
      return "bg-zinc-800 text-zinc-300 border-zinc-600";
  }
}

export function RedditFeed({
  initialTicker,
  initialCompanyName,
}: {
  initialTicker?: string;
  initialCompanyName?: string;
}) {
  const [ticker, setTicker] = useState((initialTicker ?? "").trim().toUpperCase());
  const [companyName, setCompanyName] = useState((initialCompanyName ?? "").trim());
  const [aliasesRaw, setAliasesRaw] = useState("");
  const [customSubsRaw, setCustomSubsRaw] = useState("");
  const [useDefaultSubs, setUseDefaultSubs] = useState(true);
  const [defaultSubs, setDefaultSubs] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<RedditTimeRange>("year");
  const [apiSort, setApiSort] = useState<RedditSortMode>("relevance");
  const [sitewideOnly, setSitewideOnly] = useState(false);
  const [subredditOnly, setSubredditOnly] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RedditSearchResponse | null>(null);

  const [uiFilter, setUiFilter] = useState<UiFilter>("all");
  const [uiSort, setUiSort] = useState<UiSort>("relevance");
  const [subredditPick, setSubredditPick] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setTicker((initialTicker ?? "").trim().toUpperCase());
    setCompanyName((initialCompanyName ?? "").trim());
  }, [initialTicker, initialCompanyName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reddit/subreddits");
        const json = (await res.json()) as { subreddits?: string[] };
        if (!cancelled && Array.isArray(json.subreddits)) setDefaultSubs(json.subreddits);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const aliases = useMemo(
    () =>
      aliasesRaw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2),
    [aliasesRaw]
  );

  const selectedSubreddits = useMemo(() => {
    if (!useDefaultSubs && customSubsRaw.trim()) {
      return customSubsRaw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
    return undefined;
  }, [useDefaultSubs, customSubsRaw]);

  const run = useCallback(
    async (forceRefresh: boolean) => {
      if (!ticker.trim() && !companyName.trim()) {
        setError("Enter a ticker and/or company name.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/reddit/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: ticker.trim() || undefined,
            companyName: companyName.trim() || undefined,
            aliases: aliases.length ? aliases : undefined,
            selectedSubreddits,
            timeRange,
            sortMode: apiSort,
            sitewideOnly,
            subredditOnly,
            forceRefresh,
          }),
        });
        const json = (await res.json()) as RedditSearchResponse & { error?: string };
        if (!res.ok) throw new Error((json as { error?: string }).error || "Reddit search failed");
        setData(json);
        setError(json.error ?? null);
        if (json.warnings?.length) {
          console.warn("[reddit]", json.warnings);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reddit search failed");
      } finally {
        setLoading(false);
      }
    },
    [ticker, companyName, aliases, selectedSubreddits, timeRange, apiSort, sitewideOnly, subredditOnly]
  );

  const summary = data?.summary;
  const profile = data?.profile;

  const subredditOptions = useMemo(() => {
    const fromResults = (data?.results ?? []).map((r) => r.subreddit).filter(Boolean);
    const merged = Array.from(new Set([...defaultSubs, ...fromResults])).sort((a, b) => a.localeCompare(b));
    return merged;
  }, [data?.results, defaultSubs]);

  const filteredSorted = useMemo(() => {
    let rows = data?.results ? [...data.results] : [];
    if (subredditPick) rows = rows.filter((r) => r.subreddit === subredditPick);
    switch (uiFilter) {
      case "high":
        rows = rows.filter((r) => r.confidence_bucket === "high");
        break;
      case "medium":
        rows = rows.filter((r) => r.confidence_bucket === "medium");
        break;
      case "low":
        rows = rows.filter((r) => r.confidence_bucket === "low");
        break;
      case "external":
        rows = rows.filter((r) => !r.is_self && r.external_url);
        break;
      case "self":
        rows = rows.filter((r) => r.is_self);
        break;
      case "most_commented":
        rows = rows.filter((r) => (r.num_comments ?? 0) >= 10);
        break;
      case "highest_score":
        rows = rows.filter((r) => (r.score ?? 0) >= 20);
        break;
      default:
        break;
    }
    switch (uiSort) {
      case "newest":
        rows.sort((a, b) => b.created_utc - a.created_utc);
        break;
      case "oldest":
        rows.sort((a, b) => a.created_utc - b.created_utc);
        break;
      case "comments":
        rows.sort((a, b) => (b.num_comments ?? 0) - (a.num_comments ?? 0));
        break;
      case "score":
        rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        break;
      case "subreddit":
        rows.sort((a, b) => a.subreddit.localeCompare(b.subreddit) || b.match_score - a.match_score);
        break;
      default:
        rows.sort((a, b) => b.match_score - a.match_score);
    }
    return rows;
  }, [data?.results, uiFilter, uiSort, subredditPick]);

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
        Official Reddit OAuth search (server-side). Results are ranked for precision; low-confidence threads are still shown for manual review.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Ticker
          </div>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. HTZ"
            className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm font-mono"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          />
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Company name
          </div>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Hertz Global Holdings"
            className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          />
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Aliases (comma-separated)
          </div>
          <input
            value={aliasesRaw}
            onChange={(e) => setAliasesRaw(e.target.value)}
            placeholder="Hertz, Hertz Global"
            className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Time range
          </div>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as RedditTimeRange)}
            className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            API sort
          </div>
          <select
            value={apiSort}
            onChange={(e) => setApiSort(e.target.value as RedditSortMode)}
            className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            <option value="relevance">Relevance</option>
            <option value="new">New</option>
            <option value="top">Top</option>
            <option value="hot">Hot</option>
            <option value="comments">Comments</option>
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
          <input type="checkbox" checked={useDefaultSubs} onChange={(e) => setUseDefaultSubs(e.target.checked)} />
          Use default finance subreddit set
        </label>
        {!useDefaultSubs ? (
          <div className="min-w-[200px] flex-1">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Custom subreddits
            </div>
            <input
              value={customSubsRaw}
              onChange={(e) => setCustomSubsRaw(e.target.value)}
              placeholder="stocks, investing, securityanalysis"
              className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            />
          </div>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
          <input type="checkbox" checked={sitewideOnly} onChange={(e) => setSitewideOnly(e.target.checked)} />
          Sitewide only
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
          <input type="checkbox" checked={subredditOnly} onChange={(e) => setSubredditOnly(e.target.checked)} />
          Subreddits only
        </label>
        <button
          type="button"
          onClick={() => void run(false)}
          disabled={loading}
          className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={loading}
          className="rounded border px-3 py-2 text-sm disabled:opacity-60"
          style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
          title="Bypass cache"
        >
          Force refresh
        </button>
      </div>

      {data?.warnings?.length ? (
        <div className="rounded border border-dashed p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          Partial API issues (some queries may be missing): {data.warnings.slice(0, 3).join(" · ")}
          {data.warnings.length > 3 ? "…" : ""}
        </div>
      ) : null}

      {error ? (
        <div className="rounded border border-dashed p-2 text-sm" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Searching Reddit… this can take a little while (many query variants × subreddits).
        </p>
      ) : null}

      {profile?.queries?.length ? (
        <details className="rounded border p-2 text-xs" style={{ borderColor: "var(--border2)" }}>
          <summary className="cursor-pointer font-medium" style={{ color: "var(--muted)" }}>
            Query variants ({profile.queries.length})
            {profile.ambiguousTicker ? " · ambiguous ticker — company-name queries weighted" : ""}
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-0.5" style={{ color: "var(--muted2)" }}>
            {profile.queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {summary ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Posts", value: summary.totalPosts },
            { label: "High confidence", value: summary.highConfidence },
            { label: "Medium", value: summary.mediumConfidence },
            { label: "Low", value: summary.lowConfidence },
            { label: "Subreddits", value: summary.uniqueSubreddits },
            { label: "Avg score", value: summary.avgScore != null ? summary.avgScore.toFixed(1) : "—" },
            { label: "Avg comments", value: summary.avgComments != null ? summary.avgComments.toFixed(1) : "—" },
            { label: "Search id", value: data?.searchId ? `${data.searchId.slice(0, 10)}…` : "—" },
          ].map((c) => (
            <div key={c.label} className="rounded border p-2 text-center" style={{ borderColor: "var(--border2)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {c.label}
              </div>
              <div className="text-lg font-mono" style={{ color: "var(--text)" }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {data?.disclaimer ? (
        <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {data.disclaimer}
        </p>
      ) : null}

      {data?.results?.length ? (
        <div className="flex flex-col gap-2 border-t pt-3 lg:flex-row lg:flex-wrap lg:items-end" style={{ borderColor: "var(--border2)" }}>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Filter
            </div>
            <select
              value={uiFilter}
              onChange={(e) => setUiFilter(e.target.value as UiFilter)}
              className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              <option value="all">All</option>
              <option value="high">High confidence</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="external">Has external link</option>
              <option value="self">Self posts</option>
              <option value="most_commented">≥10 comments</option>
              <option value="highest_score">Score ≥20</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              UI sort
            </div>
            <select
              value={uiSort}
              onChange={(e) => setUiSort(e.target.value as UiSort)}
              className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              <option value="relevance">Relevance (score)</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="comments">Most comments</option>
              <option value="score">Highest score</option>
              <option value="subreddit">Subreddit A–Z</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Subreddit
            </div>
            <select
              value={subredditPick}
              onChange={(e) => setSubredditPick(e.target.value)}
              className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              <option value="">All</option>
              {subredditOptions.map((s) => (
                <option key={s} value={s}>
                  r/{s}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs" style={{ color: "var(--muted2)" }}>
            Showing {filteredSorted.length} of {data.results.length}
          </p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {filteredSorted.map((r) => (
          <RedditResultRow key={r.id} row={r} expanded={expandedId === r.id} onToggle={() => setExpandedId((x) => (x === r.id ? null : r.id))} />
        ))}
      </ul>

      {data && !loading && data.results.length === 0 && !error ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No posts passed the relevance threshold. Try widening time range, adding aliases, or using Force refresh.
        </p>
      ) : null}
    </div>
  );
}

function RedditResultRow({
  row,
  expanded,
  onToggle,
}: {
  row: RedditPostResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const topQueries = row.matched_queries_json.slice(0, 3).join(", ");
  const reasons = row.match_reasons_json.slice(0, 6).join(", ");
  return (
    <li className="rounded border p-3" style={{ borderColor: "var(--border2)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug" style={{ color: "var(--text)" }}>
            {row.title}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]" style={{ color: "var(--muted2)" }}>
            <span>r/{row.subreddit}</span>
            <span>{row.author ?? "?"}</span>
            <span>{fmtUtc(row.created_utc)}</span>
            <span>↑{row.score ?? 0}</span>
            <span>{row.num_comments ?? 0} comments</span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${confidenceBadge(row.confidence_bucket)}`}>
              {row.confidence_bucket}
            </span>
          </div>
          {row.selftext_excerpt ? (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
              {row.selftext_excerpt}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            <span className="font-semibold">Why:</span> {reasons || "—"} · <span className="font-semibold">Queries:</span> {topQueries || "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <a
            href={row.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border px-2 py-1 text-center text-xs font-medium"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            Open thread
          </a>
          {row.external_url ? (
            <a
              href={row.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border px-2 py-1 text-center text-xs"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              Link
            </a>
          ) : null}
          <button type="button" onClick={onToggle} className="text-[11px] underline" style={{ color: "var(--muted)" }}>
            {expanded ? "Less" : "Details"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 border-t pt-3 text-xs" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          <div className="grid gap-1 font-mono sm:grid-cols-2">
            <div>id: {row.reddit_post_id}</div>
            <div>domain: {row.domain ?? "—"}</div>
            <div>flair: {row.flair ?? "—"}</div>
            <div>self: {String(row.is_self)}</div>
            <div>stickied: {String(row.stickied)}</div>
            <div>locked: {String(row.locked)}</div>
            <div>over_18: {String(row.over_18)}</div>
            <div>upvote_ratio: {row.upvote_ratio ?? "—"}</div>
            <div>match_score: {row.match_score}</div>
            <div>removed: {String(row.removed_or_deleted)}</div>
          </div>
          <div className="mt-2">
            <span className="font-semibold text-[var(--text)]">Matched queries:</span> {row.matched_queries_json.join(" | ")}
          </div>
          <div className="mt-1">
            <span className="font-semibold text-[var(--text)]">Reasons:</span> {row.match_reasons_json.join(" · ")}
          </div>
          <div className="mt-2 max-h-40 overflow-auto rounded bg-black/20 p-2 text-[10px]">
            <span className="font-semibold">Provenance (JSON):</span> {JSON.stringify(row.provenance_json)}
          </div>
          {row.metadata_json ? (
            <div className="mt-2 max-h-32 overflow-auto rounded bg-black/20 p-2 text-[10px]">
              <span className="font-semibold">metadata:</span> {JSON.stringify(row.metadata_json)}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
