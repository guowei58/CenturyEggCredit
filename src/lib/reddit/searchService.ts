import type { RedditEnvConfig } from "./config";
import { loadRedditConfigFromEnv, redditCredentialsOk } from "./config";
import type { RedditPostData } from "./apiClient";
import { searchRedditPosts } from "./apiClient";
import { createRawMap, mergeRedditHit, rawMapToResults } from "./dedupe";
import { buildSearchProfile } from "./queryGenerator";
import { scoreRedditPost } from "./scoring";
import { getSearchByCacheKey, saveSearchAndResults } from "./store/fileDb";
import type {
  RedditPostProvenance,
  RedditPostResult,
  RedditSearch,
  RedditSearchProfile,
  RedditSearchRequest,
  RedditSearchResponse,
} from "./types";
import type { RedditSortMode, RedditTimeRange } from "./types";
import { cacheFingerprint, nowIso, stableId } from "./utils";

const DISCLAIMER =
  "Best-effort Reddit search via the official API. Results are incomplete; Reddit rate limits and indexing apply. Some content may be removed or NSFW (filtered).";

function permalinkUrl(permalink: string): string {
  if (!permalink) return "";
  if (permalink.startsWith("http")) return permalink;
  return `https://www.reddit.com${permalink}`;
}

function profileFromStoredSearch(s: RedditSearch, queriesFallback: string[]): RedditSearchProfile {
  return {
    ticker: s.ticker ?? "",
    companyName: s.company_name ?? "",
    aliases: Array.isArray(s.aliases_json) ? s.aliases_json : [],
    selectedSubreddits: Array.isArray(s.selected_subreddits_json) ? s.selected_subreddits_json : [],
    timeRange: s.time_range,
    sortMode: s.sort_mode,
    queries: Array.isArray(s.queries_used_json) && s.queries_used_json.length > 0 ? s.queries_used_json : queriesFallback,
    ambiguousTicker: Boolean(s.ambiguous_ticker),
  };
}

export function cachedRedditResponse(
  search: RedditSearch,
  results: RedditPostResult[],
  queriesFallback: string[]
): RedditSearchResponse {
  const profile = profileFromStoredSearch(search, queriesFallback);
  return {
    profile,
    searchId: search.id,
    summary: summarize(results),
    results: results.slice().sort((a, b) => b.match_score - a.match_score),
    disclaimer: DISCLAIMER,
  };
}

function postDataToBase(d: RedditPostData): Omit<
  RedditPostResult,
  | "id"
  | "search_id"
  | "match_score"
  | "confidence_bucket"
  | "matched_queries_json"
  | "match_reasons_json"
  | "provenance_json"
  | "created_at"
  | "updated_at"
> {
  const id = (d.id ?? d.name?.replace(/^t3_/, "") ?? "").trim();
  const permalink = d.permalink ?? "";
  const title = (d.title ?? "").trim() || "(no title)";
  const selftext = (d.selftext ?? "").trim();
  const author = d.author ?? null;
  const removed =
    author === "[deleted]" ||
    title === "[deleted by user]" ||
    title === "[removed]" ||
    Boolean(d.removed_by_category);

  return {
    reddit_post_id: id,
    permalink: permalinkUrl(permalink),
    title,
    selftext_excerpt: selftext ? selftext.slice(0, 450) : null,
    subreddit: (d.subreddit ?? "").trim(),
    author,
    created_utc: typeof d.created_utc === "number" ? d.created_utc : 0,
    score: typeof d.score === "number" ? d.score : null,
    upvote_ratio: typeof d.upvote_ratio === "number" ? d.upvote_ratio : null,
    num_comments: typeof d.num_comments === "number" ? d.num_comments : null,
    domain: d.domain ?? null,
    external_url: d.is_self ? null : d.url ?? null,
    is_self: Boolean(d.is_self),
    flair: d.link_flair_text ?? null,
    over_18: Boolean(d.over_18),
    stickied: Boolean(d.stickied),
    locked: Boolean(d.locked),
    removed_or_deleted: removed,
    metadata_json: { raw_name: d.name ?? null },
  };
}

async function runSearchQueryWithPagination(params: {
  cfg: RedditEnvConfig;
  q: string;
  subreddit: string | null;
  sort: RedditSortMode;
  t: RedditTimeRange;
  maxPages: number;
  limit: number;
  requestBudget: { left: number };
}): Promise<{ children: RedditPostData[]; error?: string }> {
  const out: RedditPostData[] = [];
  let after: string | null = null;
  for (let page = 0; page < params.maxPages; page++) {
    if (params.requestBudget.left <= 0) break;
    params.requestBudget.left -= 1;
    const r = await searchRedditPosts({
      cfg: params.cfg,
      q: params.q,
      subreddit: params.subreddit,
      sort: params.sort,
      t: params.t,
      limit: params.limit,
      after,
    });
    if (!r.ok) return { children: out, error: r.error };
    for (const ch of r.children) {
      if (ch.kind === "t3" && ch.data) out.push(ch.data);
    }
    after = r.after;
    if (!after) break;
  }
  return { children: out };
}

const MIN_ACCEPT_SCORE = 18;

export async function runRedditSearch(req: RedditSearchRequest, userId: string): Promise<RedditSearchResponse> {
  const cfg = loadRedditConfigFromEnv();
  if (!redditCredentialsOk(cfg)) {
    return {
      profile: {
        ticker: "",
        companyName: "",
        aliases: [],
        selectedSubreddits: [],
        timeRange: (req.timeRange ?? "month") as RedditTimeRange,
        sortMode: (req.sortMode ?? "relevance") as RedditSortMode,
        queries: [],
        ambiguousTicker: false,
      },
      searchId: "",
      summary: emptySummary(),
      results: [],
      disclaimer: DISCLAIMER,
      error:
        "Reddit API credentials not configured. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT.",
    };
  }

  const timeRange = (req.timeRange ?? "year") as RedditTimeRange;
  const sortMode = (req.sortMode ?? "relevance") as RedditSortMode;
  const sitewideOnly = Boolean(req.sitewideOnly);
  const subredditOnly = Boolean(req.subredditOnly);

  const built = buildSearchProfile({
    ticker: req.ticker,
    companyName: req.companyName,
    aliases: req.aliases,
    selectedSubreddits: req.selectedSubreddits,
    defaultSubreddits: cfg.defaultSubreddits,
    timeRange,
    sortMode,
    sitewideOnly,
    subredditOnly,
    maxSubs: cfg.maxSubredditsSearched,
    maxQueryVariants: cfg.maxQueryVariants,
  });

  if (built.error) {
    return {
      profile: built.profile,
      searchId: "",
      summary: emptySummary(),
      results: [],
      disclaimer: DISCLAIMER,
      error: built.error,
    };
  }

  const profile = built.profile;
  const fp = cacheFingerprint({
    ticker: profile.ticker,
    companyName: profile.companyName,
    aliases: profile.aliases,
    subs: profile.selectedSubreddits,
    time: timeRange,
    sort: sortMode,
    sitewideOnly,
    subredditOnly,
  });

  if (!req.forceRefresh) {
    const cached = await getSearchByCacheKey(userId, fp, cfg.cacheTtlMs);
    if (cached) {
      return cachedRedditResponse(cached.search, cached.results, profile.queries);
    }
  }

  const searchId = stableId(["reddit_search", fp, nowIso()]);
  const startedAt = nowIso();
  const searchRow: RedditSearch = {
    id: searchId,
    ticker: profile.ticker || null,
    company_name: profile.companyName || null,
    aliases_json: profile.aliases,
    selected_subreddits_json: profile.selectedSubreddits,
    sitewide_only: sitewideOnly,
    subreddit_only: subredditOnly,
    time_range: timeRange,
    sort_mode: sortMode,
    status: "running",
    started_at: startedAt,
    completed_at: null,
    error_message: null,
    queries_used_json: profile.queries,
    ambiguous_ticker: profile.ambiguousTicker,
    created_at: startedAt,
    updated_at: startedAt,
    cache_key: fp,
  };

  const requestBudget = { left: cfg.maxRequestsPerSearch };
  const merged = createRawMap();
  const subs = profile.selectedSubreddits.slice(0, cfg.maxSubredditsSearched);
  const warnings: string[] = [];
  let anyApiSuccess = false;

  const tasks: Array<{ q: string; sub: string | null }> = [];
  for (const q of profile.queries) {
    if (!subredditOnly) tasks.push({ q, sub: null });
    if (!sitewideOnly) {
      for (const s of subs) tasks.push({ q, sub: s });
    }
  }

  for (const task of tasks) {
    if (requestBudget.left <= 0 || merged.size >= cfg.maxTotalPostsReturned) break;
    const r = await runSearchQueryWithPagination({
      cfg,
      q: task.q,
      subreddit: task.sub,
      sort: sortMode,
      t: timeRange,
      maxPages: cfg.maxPagesPerQuery,
      limit: cfg.limitPerRequest,
      requestBudget,
    });
    if (r.error) {
      warnings.push(`${task.q} @ ${task.sub ?? "sitewide"}: ${r.error}`);
      continue;
    }
    anyApiSuccess = true;

    const namePrefix = profile.companyName.length >= 3 ? profile.companyName.slice(0, 8).toLowerCase() : "";

    for (const d of r.children) {
      const id = (d.id ?? d.name?.replace(/^t3_/, "") ?? "").trim();
      if (!id) continue;
      const base = postDataToBase(d);
      if (base.removed_or_deleted) {
        const blob = `${base.title} ${base.selftext_excerpt ?? ""}`.toLowerCase();
        const hasTicker = profile.ticker ? blob.includes(profile.ticker.toLowerCase()) : false;
        const hasCo = namePrefix ? blob.includes(namePrefix) : false;
        if (!hasTicker && !hasCo) continue;
      }

      const scored = scoreRedditPost({
        profile,
        title: base.title,
        selftext: base.selftext_excerpt ?? "",
        subreddit: base.subreddit,
        score: base.score,
        numComments: base.num_comments,
        matchedQueries: [task.q],
        queryCount: 1,
      });

      if (scored.matchScore < MIN_ACCEPT_SCORE) continue;

      const prov: RedditPostProvenance = {
        query: task.q,
        subredditScope: task.sub ?? "sitewide",
        sort: sortMode,
        time: timeRange,
      };

      mergeRedditHit(merged, id, base, task.q, prov, scored.matchScore, scored.confidence, scored.reasons);
    }
  }

  const now = nowIso();
  let results = rawMapToResults(merged, searchId, stableId, now).sort((a, b) => b.match_score - a.match_score);
  results = results.slice(0, cfg.maxTotalPostsReturned);

  for (const row of results) {
    const qc = row.matched_queries_json.length;
    const scored = scoreRedditPost({
      profile,
      title: row.title,
      selftext: row.selftext_excerpt ?? "",
      subreddit: row.subreddit,
      score: row.score,
      numComments: row.num_comments,
      matchedQueries: row.matched_queries_json,
      queryCount: qc,
    });
    row.match_score = scored.matchScore;
    row.confidence_bucket = scored.confidence;
    row.match_reasons_json = scored.reasons;
  }

  results.sort((a, b) => b.match_score - a.match_score);

  const failed = !anyApiSuccess && warnings.length > 0;

  if (failed) {
    const msg = warnings[0] ?? "All Reddit search requests failed";
    await saveSearchAndResults(
      userId,
      { ...searchRow, status: "failed", completed_at: now, error_message: msg, updated_at: now },
      []
    );
    return {
      profile,
      searchId,
      summary: emptySummary(),
      results: [],
      disclaimer: DISCLAIMER,
      error: msg,
      warnings,
    };
  }

  await saveSearchAndResults(
    userId,
    { ...searchRow, status: "completed", completed_at: now, updated_at: now, error_message: null },
    results
  );

  return {
    profile,
    searchId,
    summary: summarize(results),
    results,
    disclaimer: DISCLAIMER,
    warnings: warnings.length ? warnings : undefined,
  };
}

function emptySummary(): RedditSearchResponse["summary"] {
  return {
    totalPosts: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    uniqueSubreddits: 0,
    avgScore: null,
    avgComments: null,
  };
}

function summarize(results: RedditPostResult[]): RedditSearchResponse["summary"] {
  const high = results.filter((r) => r.confidence_bucket === "high").length;
  const medium = results.filter((r) => r.confidence_bucket === "medium").length;
  const low = results.filter((r) => r.confidence_bucket === "low").length;
  const subs = new Set(results.map((r) => r.subreddit));
  const scores = results.map((r) => r.score).filter((s): s is number => typeof s === "number");
  const comments = results.map((r) => r.num_comments).filter((n): n is number => typeof n === "number");
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const avgComments = comments.length ? comments.reduce((a, b) => a + b, 0) / comments.length : null;
  return {
    totalPosts: results.length,
    highConfidence: high,
    mediumConfidence: medium,
    lowConfidence: low,
    uniqueSubreddits: subs.size,
    avgScore,
    avgComments,
  };
}
