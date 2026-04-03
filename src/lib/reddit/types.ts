/**
 * Reddit search feature — official OAuth API only.
 */

export type RedditTimeRange = "hour" | "day" | "week" | "month" | "year" | "all";

export type RedditSortMode = "relevance" | "hot" | "new" | "top" | "comments";

export type RedditConfidence = "high" | "medium" | "low";

export type RedditSearchProfile = {
  ticker: string;
  companyName: string;
  aliases: string[];
  selectedSubreddits: string[];
  timeRange: RedditTimeRange;
  sortMode: RedditSortMode;
  /** Query strings generated for this profile */
  queries: string[];
  ambiguousTicker: boolean;
};

export type RedditSearch = {
  id: string;
  ticker: string | null;
  company_name: string | null;
  aliases_json: string[];
  selected_subreddits_json: string[];
  sitewide_only: boolean;
  subreddit_only: boolean;
  time_range: RedditTimeRange;
  sort_mode: RedditSortMode;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  queries_used_json: string[];
  ambiguous_ticker: boolean;
  created_at: string;
  updated_at: string;
  cache_key: string;
};

export type RedditPostProvenance = {
  query: string;
  subredditScope: "sitewide" | string;
  sort: RedditSortMode;
  time: RedditTimeRange;
};

export type RedditPostResult = {
  id: string;
  search_id: string;
  reddit_post_id: string;
  permalink: string;
  title: string;
  selftext_excerpt: string | null;
  subreddit: string;
  author: string | null;
  created_utc: number;
  score: number | null;
  upvote_ratio: number | null;
  num_comments: number | null;
  domain: string | null;
  external_url: string | null;
  is_self: boolean;
  flair: string | null;
  over_18: boolean;
  stickied: boolean;
  locked: boolean;
  removed_or_deleted: boolean;
  match_score: number;
  confidence_bucket: RedditConfidence;
  matched_queries_json: string[];
  match_reasons_json: string[];
  provenance_json: RedditPostProvenance[];
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type RedditSearchRequest = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  selectedSubreddits?: string[];
  /** If true, skip per-subreddit searches */
  sitewideOnly?: boolean;
  /** If true, only search selected subreddits (no sitewide) */
  subredditOnly?: boolean;
  timeRange?: RedditTimeRange;
  sortMode?: RedditSortMode;
  /** Skip file-backed TTL cache and run a fresh search */
  forceRefresh?: boolean;
};

export type RedditSearchResponse = {
  profile: RedditSearchProfile;
  searchId: string;
  summary: {
    totalPosts: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    uniqueSubreddits: number;
    avgScore: number | null;
    avgComments: number | null;
  };
  results: RedditPostResult[];
  disclaimer: string;
  error?: string;
  /** Non-fatal API issues (e.g. one query/sub failed; other results may be present) */
  warnings?: string[];
};
