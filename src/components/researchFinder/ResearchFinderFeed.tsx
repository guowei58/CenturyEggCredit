"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import type { ResearchFinderSearchResponse, ResearchProviderId, ResearchResult } from "@/lib/researchFinder/types";

const DISCLAIMER =
  "Best-effort public research discovery only. Results may be incomplete and do not represent the full research library of any provider. Some sources, including WSJ Pro Bankruptcy, may be partially or largely subscription-gated.";

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

function badge(text: string) {
  return (
    <span className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
      {text}
    </span>
  );
}

export function ResearchFinderFeed({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const [name, setName] = useState((companyName ?? "").trim());
  const [aliases, setAliases] = useState("");
  const [selected, setSelected] = useState<Set<ResearchProviderId>>(new Set(PROVIDERS.map((p) => p.id)));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResearchFinderSearchResponse | null>(null);
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

  const summary = data?.summary ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded border border-dashed p-3 text-xs" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
        {DISCLAIMER}
      </div>

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
            placeholder="Optional — former names, brands, subsidiaries (comma-separated)"
          />
        </div>

        <button
          type="button"
          onClick={run}
          disabled={loading || providers.length === 0}
          className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          Search
        </button>
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

      {error ? (
        <div className="rounded border border-dashed p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {badge(`Candidates: ${summary.candidateUrls}`)}
          {typeof summary.rssCandidatesTotal === "number" ? badge(`RSS hits (pre-merge): ${summary.rssCandidatesTotal}`) : null}
          {badge(`Kept: ${summary.keptResults}`)}
          {badge(`High: ${summary.confidence.high}`)}
          {badge(`Medium: ${summary.confidence.medium}`)}
          {badge(`Low: ${summary.confidence.low}`)}
        </div>
      ) : null}

      {!error && summary && summary.candidateUrls > 0 && results.length === 0 ? (
        <div
          className="rounded-md border border-dashed px-3 py-2 text-xs leading-relaxed"
          style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
        >
          We found candidate links from the selected providers, but none scored high enough after title/snippet analysis (paywalled or generic
          pages score lower). Try adding{" "}
          <strong className="font-semibold" style={{ color: "var(--text)" }}>
            aliases
          </strong>
          , tightening the company name, or running search again later.
        </div>
      ) : null}

      <ul className="space-y-3">
        {results.map((r) => (
          <li key={r.id}>
            <ResultCard item={r} ticker={tk} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultCard({ item, ticker }: { item: ResearchResult; ticker: string }) {
  const when = item.publication_date ? new Date(item.publication_date).toLocaleDateString() : "—";
  const title = item.title ?? item.url;

  return (
    <article className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--muted2)" }}>
        {badge(item.provider)}
        {badge(item.page_type)}
        {badge(item.access_level)}
        {badge(item.confidence_bucket)}
        {badge(`score ${item.match_score}`)}
        {badge(when)}
      </div>
      <div className="mt-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </div>
      {item.snippet ? (
        <div className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          {item.snippet}
        </div>
      ) : null}
      {item.match_reasons.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.match_reasons.slice(0, 10).map((t) => (
            <span key={t} className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
              {t}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md border px-3 py-2 text-xs font-semibold"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
        >
          Open link
        </a>
        <SaveFilingLinkButton ticker={ticker} url={item.url} mode="saved-documents" />
      </div>
      <details className="mt-3 text-xs" style={{ color: "var(--muted2)" }}>
        <summary className="cursor-pointer select-none">Details</summary>
        <div className="mt-2 space-y-1">
          <div>Domain: {item.provider_domain}</div>
          <div>Query: {item.query_used}</div>
          <div>Discovery: {item.search_provider_used}</div>
          {item.canonical_url ? <div>Canonical: {item.canonical_url}</div> : null}
        </div>
      </details>
    </article>
  );
}

