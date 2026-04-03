export type IrIndexerConfig = {
  maxPages: number;
  maxDepth: number;
  timeoutMs: number;
  usePlaywright: boolean;
  enrichWithSec: boolean;
  sameDomainOnly: boolean;
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

export function loadIrIndexerConfigFromEnv(): IrIndexerConfig {
  return {
    maxPages: Math.min(50, Math.max(1, parseIntEnv(process.env.IR_INDEXER_MAX_PAGES, 12))),
    maxDepth: Math.min(5, Math.max(0, parseIntEnv(process.env.IR_INDEXER_MAX_DEPTH, 2))),
    timeoutMs: Math.min(120_000, Math.max(5_000, parseIntEnv(process.env.IR_INDEXER_TIMEOUT_MS, 25_000))),
    usePlaywright: parseBool(process.env.IR_INDEXER_USE_PLAYWRIGHT, true),
    enrichWithSec: parseBool(process.env.IR_INDEXER_SEC_ENRICH, true),
    sameDomainOnly: parseBool(process.env.IR_INDEXER_SAME_DOMAIN_ONLY, true),
  };
}

