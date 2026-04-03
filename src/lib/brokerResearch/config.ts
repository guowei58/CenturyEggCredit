import { PRODUCTION_BROKER_IDS } from "./constants";
import type { BrokerDefinition } from "./types";

/** Env key suffix after BROKER_RESEARCH_ — aligns with user examples (JPM, GOLDMAN, …). */
export const BROKER_ID_TO_ENV_SUFFIX: Record<(typeof PRODUCTION_BROKER_IDS)[number], string> = {
  jpmorgan: "JPM",
  goldman: "GOLDMAN",
  morgan_stanley: "MORGAN_STANLEY",
  ubs: "UBS",
  bofa: "BOFA",
  jefferies: "JEFFERIES",
  barclays: "BARCLAYS",
  citi: "CITI",
  deutsche_bank: "DEUTSCHE_BANK",
  wells_fargo: "WELLS_FARGO",
  evercore: "EVERCORE",
  bmo: "BMO",
  rbc: "RBC",
  btig: "BTIG",
  guggenheim: "GUGGENHEIM",
  morningstar: "MORNINGSTAR",
  oppenheimer: "OPPENHEIMER",
  bernstein: "BERNSTEIN",
  stifel: "STIFEL",
  scotiabank: "SCOTIABANK",
  td_cowen: "TD_COWEN",
  truist: "TRUIST",
  canaccord: "CANACCORD",
  needham: "NEEDHAM",
  benchmark: "BENCHMARK",
};

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
  return Number.isFinite(n) ? n : fallback;
}

export type BrokerRuntimeFlags = {
  maxQueriesPerBroker: number;
  globalMaxResults: number;
  hitsPerQuery: number;
};

export function loadBrokerRuntimeFlags(): BrokerRuntimeFlags {
  return {
    maxQueriesPerBroker: parseIntEnv(process.env.BROKER_RESEARCH_MAX_QUERIES_PER_BROKER, 10),
    globalMaxResults: parseIntEnv(process.env.BROKER_RESEARCH_GLOBAL_MAX_RESULTS, 200),
    hitsPerQuery: Math.min(10, Math.max(1, parseIntEnv(process.env.BROKER_RESEARCH_HITS_PER_QUERY, 8))),
  };
}

/**
 * Whether a broker is globally enabled (env overrides definition.default).
 */
export function isBrokerGloballyEnabled(broker: BrokerDefinition): boolean {
  const suffix = BROKER_ID_TO_ENV_SUFFIX[broker.id as keyof typeof BROKER_ID_TO_ENV_SUFFIX];
  if (!suffix) return broker.enabledByDefault;
  const key = `BROKER_RESEARCH_${suffix}_ENABLED`;
  return parseBool(process.env[key], broker.enabledByDefault);
}

/**
 * Request allowlist: if `enabledBrokers` set, only those ids (still must be globally enabled).
 */
export function resolveActiveBrokers(
  all: BrokerDefinition[],
  requestEnabled?: string[]
): { active: BrokerDefinition[]; skipped: string[] } {
  const allow =
    requestEnabled && requestEnabled.length > 0
      ? new Set(requestEnabled.map((s) => s.trim().toLowerCase()))
      : null;

  const active: BrokerDefinition[] = [];
  const skipped: string[] = [];

  for (const b of all) {
    if (!isBrokerGloballyEnabled(b)) {
      skipped.push(b.id);
      continue;
    }
    if (allow && !allow.has(b.id.toLowerCase())) {
      skipped.push(b.id);
      continue;
    }
    active.push(b);
  }

  return { active, skipped };
}
