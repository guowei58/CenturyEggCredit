export type SubstackConfig = {
  serperApiKey?: string;
  discoveryEnabled: boolean;
  rssIngestEnabled: boolean;
  maxDiscoveryResults: number;
  maxPublicationsPerRun: number;
  maxPostsPerFeed: number;
  requestTimeoutMs: number;
};

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  const x = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(x)) return true;
  if (["0", "false", "no", "off"].includes(x)) return false;
  return fallback;
}

function parseIntEnv(v: string | undefined, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadSubstackConfigFromEnv(): SubstackConfig {
  return {
    serperApiKey: process.env.SERPER_API_KEY?.trim() || undefined,
    discoveryEnabled: parseBool(process.env.SUBSTACK_DISCOVERY_ENABLED, true),
    rssIngestEnabled: parseBool(process.env.SUBSTACK_RSS_INGEST_ENABLED, true),
    maxDiscoveryResults: Math.min(100, Math.max(5, parseIntEnv(process.env.SUBSTACK_MAX_DISCOVERY_RESULTS, 50))),
    maxPublicationsPerRun: Math.min(80, Math.max(1, parseIntEnv(process.env.SUBSTACK_MAX_PUBLICATIONS_PER_RUN, 20))),
    maxPostsPerFeed: Math.min(400, Math.max(10, parseIntEnv(process.env.SUBSTACK_MAX_POSTS_PER_FEED, 100))),
    requestTimeoutMs: Math.min(60_000, Math.max(3_000, parseIntEnv(process.env.SUBSTACK_REQUEST_TIMEOUT_MS, 12_000))),
  };
}

