export type RedditEnvConfig = {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  userAgent: string;
  maxQueryVariants: number;
  maxSubredditsSearched: number;
  maxPagesPerQuery: number;
  limitPerRequest: number;
  maxTotalPostsReturned: number;
  timeoutMs: number;
  concurrency: number;
  cacheTtlMs: number;
  defaultSubreddits: string[];
  maxRequestsPerSearch: number;
};

function parseIntEnv(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseListEnv(v: string | undefined, fallback: string[]): string[] {
  if (!v?.trim()) return fallback;
  return v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const DEFAULT_SUBS = [
  "stocks",
  "investing",
  "wallstreetbets",
  "securityanalysis",
  "valueinvesting",
  "stockmarket",
  "options",
  "pennystocks",
  "dividends",
  "finance",
  "economics",
  "spacs",
];

export function loadRedditConfigFromEnv(): RedditEnvConfig {
  const ua =
    process.env.REDDIT_USER_AGENT?.trim() ||
    "CenturyEggCredit/1.0 (credit research app; contact via app owner)";
  return {
    clientId: process.env.REDDIT_CLIENT_ID?.trim() || undefined,
    clientSecret: process.env.REDDIT_CLIENT_SECRET?.trim() || undefined,
    username: process.env.REDDIT_USERNAME?.trim() || undefined,
    password: process.env.REDDIT_PASSWORD?.trim() || undefined,
    userAgent: ua,
    maxQueryVariants: Math.min(30, Math.max(3, parseIntEnv(process.env.REDDIT_MAX_QUERY_VARIANTS, 12))),
    maxSubredditsSearched: Math.min(25, Math.max(1, parseIntEnv(process.env.REDDIT_MAX_SUBREDDITS_SEARCHED, 12))),
    maxPagesPerQuery: Math.min(5, Math.max(1, parseIntEnv(process.env.REDDIT_MAX_PAGES_PER_QUERY, 2))),
    limitPerRequest: Math.min(100, Math.max(10, parseIntEnv(process.env.REDDIT_LIMIT_PER_REQUEST, 25))),
    maxTotalPostsReturned: Math.min(500, Math.max(20, parseIntEnv(process.env.REDDIT_MAX_POSTS_RETURNED, 150))),
    timeoutMs: Math.min(30_000, Math.max(5_000, parseIntEnv(process.env.REDDIT_TIMEOUT_MS, 15_000))),
    concurrency: Math.min(4, Math.max(1, parseIntEnv(process.env.REDDIT_CONCURRENCY, 2))),
    cacheTtlMs: Math.min(24 * 3600_000, Math.max(60_000, parseIntEnv(process.env.REDDIT_CACHE_TTL_MS, 30 * 60_000))),
    defaultSubreddits: parseListEnv(process.env.REDDIT_DEFAULT_SUBREDDITS, DEFAULT_SUBS),
    maxRequestsPerSearch: Math.min(200, Math.max(10, parseIntEnv(process.env.REDDIT_MAX_REQUESTS_PER_SEARCH, 80))),
  };
}

export function redditCredentialsOk(cfg: RedditEnvConfig): boolean {
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.username && cfg.password);
}
