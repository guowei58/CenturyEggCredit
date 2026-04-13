export type ResearchFinderConfig = {
  maxQueriesPerProvider: number;
  maxCandidatesPerProvider: number;
  maxExtractedPagesPerProvider: number;
  timeoutMs: number;
  cacheTtlMs: number;
  /** Google News RSS layer (no API key), merged with web search hits */
  rssLayerEnabled: boolean;
  rssMaxItemsPerQuery: number;
  /** Passed to Google News as `when:` (e.g. 90d) */
  rssWhenWindow: string;
  rssResolveTimeoutMs: number;
};

function parseIntEnv(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolEnv(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

export function loadResearchFinderConfigFromEnv(): ResearchFinderConfig {
  return {
    maxQueriesPerProvider: Math.min(20, Math.max(3, parseIntEnv(process.env.RESEARCH_FINDER_MAX_QUERIES_PER_PROVIDER, 10))),
    maxCandidatesPerProvider: Math.min(100, Math.max(5, parseIntEnv(process.env.RESEARCH_FINDER_MAX_CANDIDATES_PER_PROVIDER, 40))),
    maxExtractedPagesPerProvider: Math.min(60, Math.max(5, parseIntEnv(process.env.RESEARCH_FINDER_MAX_EXTRACTED_PER_PROVIDER, 20))),
    timeoutMs: Math.min(30_000, Math.max(3_000, parseIntEnv(process.env.RESEARCH_FINDER_TIMEOUT_MS, 10_000))),
    cacheTtlMs: Math.min(7 * 86400_000, Math.max(60_000, parseIntEnv(process.env.RESEARCH_FINDER_CACHE_TTL_MS, 6 * 3600_000))),
    rssLayerEnabled: parseBoolEnv(process.env.RESEARCH_FINDER_RSS_ENABLED, true),
    rssMaxItemsPerQuery: Math.min(40, Math.max(5, parseIntEnv(process.env.RESEARCH_FINDER_RSS_MAX_ITEMS_PER_QUERY, 20))),
    rssWhenWindow: (process.env.RESEARCH_FINDER_RSS_WHEN ?? "90d").trim() || "90d",
    rssResolveTimeoutMs: Math.min(25_000, Math.max(2_000, parseIntEnv(process.env.RESEARCH_FINDER_RSS_RESOLVE_TIMEOUT_MS, 10_000))),
  };
}

