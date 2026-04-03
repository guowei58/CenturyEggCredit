import type { XSourceProviderId } from "./types";

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

export type XSearchConfig = {
  bearerToken?: string;
  enabled: Record<XSourceProviderId, boolean>;
  defaultLimit: number;
  includeRetweets: boolean;
  defaultLanguage: string;
  timeoutMs: number;
  enableCounts: boolean;
};

export function loadXSearchConfigFromEnv(): XSearchConfig {
  return {
    bearerToken: process.env.X_BEARER_TOKEN?.trim() || undefined,
    enabled: {
      recent_search: parseBool(process.env.X_RECENT_SEARCH_ENABLED, true),
      full_archive: parseBool(process.env.X_FULL_ARCHIVE_ENABLED, false),
      filtered_stream: parseBool(process.env.X_FILTERED_STREAM_ENABLED, false),
    },
    defaultLimit: Math.min(100, Math.max(10, parseIntEnv(process.env.X_DEFAULT_RESULT_LIMIT, 100))),
    includeRetweets: parseBool(process.env.X_INCLUDE_RETWEETS, false),
    defaultLanguage: (process.env.X_DEFAULT_LANGUAGE?.trim() || "en").toLowerCase(),
    timeoutMs: Math.min(60_000, Math.max(2_000, parseIntEnv(process.env.X_REQUEST_TIMEOUT_MS, 10_000))),
    enableCounts: parseBool(process.env.X_COUNTS_ENABLED, true),
  };
}

