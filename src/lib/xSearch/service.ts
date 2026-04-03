import { loadXSearchConfigFromEnv } from "./config";
import { dedupePosts } from "./dedupe/dedupe";
import { appendPostsToLocalDb } from "./persistence";
import { getRecentCountEstimate } from "./providers/counts";
import { createFilteredStreamProvider } from "./providers/filteredStream";
import { createFullArchiveSearchProvider } from "./providers/fullArchiveSearch";
import { createRecentSearchProvider } from "./providers/recentSearch";
import { rankPosts, type XSortMode, scorePost } from "./ranking/rank";
import type { NormalizedXPost, XSearchParams, XSearchResponse, XSourceProviderId } from "./types";
import { isAmbiguousTicker } from "./utils";

function chooseProvider(params: XSearchParams, cfg: ReturnType<typeof loadXSearchConfigFromEnv>): XSourceProviderId | null {
  const hasRange = Boolean(params.from || params.to);
  if (!hasRange) return cfg.enabled.recent_search ? "recent_search" : null;

  // If caller asks for older range, we'd route to full_archive when enabled; otherwise fallback to recent with warning.
  if (cfg.enabled.full_archive) return "full_archive";
  return cfg.enabled.recent_search ? "recent_search" : null;
}

export async function runXSearch(
  params: XSearchParams & { sortMode?: XSortMode; userId?: string | null }
): Promise<XSearchResponse> {
  const cfg = loadXSearchConfigFromEnv();
  const ticker = params.ticker?.trim().toUpperCase();
  if (!ticker) {
    return {
      ticker: "",
      aliases: [],
      providerUsed: null,
      query: null,
      queryExplanation: null,
      countEstimate: null,
      warnings: [],
      rawCount: 0,
      finalCount: 0,
      posts: [],
      error: "ticker is required",
    };
  }

  const warnings: string[] = [];
  const ambiguous = isAmbiguousTicker(ticker);
  if (ambiguous) warnings.push("Ticker looks ambiguous; results may include noise without cashtag/finance context.");

  const providerId = chooseProvider(params, cfg);
  if (!providerId) {
    return {
      ticker,
      companyName: params.companyName?.trim() || undefined,
      aliases: params.aliases ?? [],
      providerUsed: null,
      query: null,
      queryExplanation: null,
      countEstimate: null,
      warnings,
      rawCount: 0,
      finalCount: 0,
      posts: [],
      error: "No X search providers enabled (check env flags).",
    };
  }

  if ((params.from || params.to) && providerId === "recent_search" && !cfg.enabled.full_archive) {
    warnings.push("Full-archive search is disabled; date ranges outside the recent window may not be covered.");
  }

  const providers = {
    recent_search: createRecentSearchProvider(),
    full_archive: createFullArchiveSearchProvider(cfg.enabled.full_archive),
    filtered_stream: createFilteredStreamProvider(cfg.enabled.filtered_stream),
  } as const;

  let countEstimate: number | null = null;
  let query: string | null = null;
  let queryExplanation: string | null = null;

  // Counts is best-effort.
  if (cfg.enableCounts && providerId !== "filtered_stream") {
    const c = await getRecentCountEstimate(params);
    if (c.ok) {
      countEstimate = c.count;
      if (c.query) {
        query = c.query;
        queryExplanation = c.explanation;
      }
    } else {
      warnings.push(`Counts unavailable: ${c.error}`);
    }
  }

  const provider = providers[providerId];
  let result;
  try {
    result = await provider.search(params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "X search failed";
    return {
      ticker,
      companyName: params.companyName?.trim() || undefined,
      aliases: params.aliases ?? [],
      providerUsed: providerId,
      query,
      queryExplanation,
      countEstimate,
      warnings,
      rawCount: 0,
      finalCount: 0,
      posts: [],
      error: msg,
    };
  }

  if (result.query) query = result.query;
  if (result.queryExplanation) queryExplanation = result.queryExplanation;
  if (result.countEstimate != null) countEstimate = result.countEstimate;

  if (!result.success) {
    return {
      ticker,
      companyName: params.companyName?.trim() || undefined,
      aliases: params.aliases ?? [],
      providerUsed: providerId,
      query,
      queryExplanation,
      countEstimate,
      warnings,
      rawCount: 0,
      finalCount: 0,
      posts: [],
      error: result.error ?? "X search failed",
    };
  }

  const raw = result.posts;
  const scored = raw.map((p) => ({
    ...p,
    relevanceScore: Number(scorePost(p, { ticker, companyName: params.companyName }).toFixed(2)),
  }));
  const deduped = dedupePosts(scored);
  const ranked = rankPosts(deduped, { ticker, companyName: params.companyName }, params.sortMode ?? "relevance");

  try {
    const uid = params.userId;
    if (uid && query) {
      await appendPostsToLocalDb({
        userId: uid,
        ticker,
        companyName: params.companyName,
        provider: providerId,
        query,
        posts: ranked,
      });
    }
  } catch {
    /* ignore persistence failures */
  }

  return {
    ticker,
    companyName: params.companyName?.trim() || undefined,
    aliases: params.aliases ?? [],
    providerUsed: providerId,
    query,
    queryExplanation,
    countEstimate,
    warnings,
    rawCount: raw.length,
    finalCount: ranked.length,
    posts: ranked,
  };
}

