export type ResearchFinderConfig = {
  maxQueriesPerProvider: number;
  maxCandidatesPerProvider: number;
  maxExtractedPagesPerProvider: number;
  timeoutMs: number;
  cacheTtlMs: number;
};

function parseIntEnv(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadResearchFinderConfigFromEnv(): ResearchFinderConfig {
  return {
    maxQueriesPerProvider: Math.min(20, Math.max(3, parseIntEnv(process.env.RESEARCH_FINDER_MAX_QUERIES_PER_PROVIDER, 10))),
    maxCandidatesPerProvider: Math.min(100, Math.max(5, parseIntEnv(process.env.RESEARCH_FINDER_MAX_CANDIDATES_PER_PROVIDER, 40))),
    maxExtractedPagesPerProvider: Math.min(60, Math.max(5, parseIntEnv(process.env.RESEARCH_FINDER_MAX_EXTRACTED_PER_PROVIDER, 20))),
    timeoutMs: Math.min(30_000, Math.max(3_000, parseIntEnv(process.env.RESEARCH_FINDER_TIMEOUT_MS, 10_000))),
    cacheTtlMs: Math.min(7 * 86400_000, Math.max(60_000, parseIntEnv(process.env.RESEARCH_FINDER_CACHE_TTL_MS, 6 * 3600_000))),
  };
}

