import { PRODUCTION_NEWS_PROVIDER_IDS } from "./constants";
import type { ProviderConfig } from "./types";

const PROVIDER_IDS = PRODUCTION_NEWS_PROVIDER_IDS;
export type KnownNewsProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_RESULTS = 50;
export const DEFAULT_FINAL_LIMIT = 100;

function parseBool(v: string | undefined, defaultTrue: boolean): boolean {
  if (v == null || v === "") return defaultTrue;
  const x = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(x)) return true;
  if (["0", "false", "no", "off"].includes(x)) return false;
  return defaultTrue;
}

function parseIntEnv(v: string | undefined, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Number(n) : fallback;
}

function envKey(id: KnownNewsProviderId, suffix: string): string {
  const map: Record<KnownNewsProviderId, string> = {
    marketaux: "MARKETAUX",
    alpha_vantage: "ALPHA_VANTAGE",
    finnhub: "FINNHUB",
  };
  return `NEWS_PROVIDER_${map[id]}_${suffix}`;
}

/**
 * Load per-provider config from environment. Keys are stable provider ids.
 */
export function loadProviderConfigsFromEnv(): Map<string, ProviderConfig> {
  const defaults: Record<KnownNewsProviderId, { priority: number }> = {
    marketaux: { priority: 1 },
    alpha_vantage: { priority: 2 },
    finnhub: { priority: 3 },
  };

  const out = new Map<string, ProviderConfig>();
  for (const id of PROVIDER_IDS) {
    const enabled = parseBool(process.env[envKey(id, "ENABLED")], true);
    const priority = parseIntEnv(process.env[envKey(id, "PRIORITY")], defaults[id].priority);
    const timeoutMs = parseIntEnv(process.env[envKey(id, "TIMEOUT_MS")], DEFAULT_TIMEOUT_MS);
    const maxResults = parseIntEnv(process.env[envKey(id, "MAX_RESULTS")], DEFAULT_MAX_RESULTS);
    out.set(id, { id, enabled, priority, timeoutMs, maxResults });
  }
  return out;
}

export function getApiKeyEnv(id: KnownNewsProviderId): string | undefined {
  const keys: Record<KnownNewsProviderId, string> = {
    marketaux: "MARKETAUX_API_KEY",
    alpha_vantage: "ALPHA_VANTAGE_API_KEY",
    finnhub: "FINNHUB_API_KEY",
  };
  return process.env[keys[id]]?.trim() || undefined;
}

/**
 * Apply request-level allowlist: if `enabledProviders` is set, only those ids run (still must be globally enabled).
 */
export function resolveEffectiveConfigs(
  configs: Map<string, ProviderConfig>,
  requestEnabled?: string[]
): Map<string, ProviderConfig> {
  const allow =
    requestEnabled && requestEnabled.length > 0
      ? new Set(requestEnabled.map((s) => s.trim().toLowerCase()))
      : null;
  const next = new Map<string, ProviderConfig>();
  for (const [id, c] of Array.from(configs.entries())) {
    if (!c.enabled) continue;
    if (allow && !allow.has(id.toLowerCase())) continue;
    next.set(id, c);
  }
  return next;
}
