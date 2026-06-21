import type { LmeDocumentPackedRow, LmeRunPackingStats } from "@/lib/lme-sources";
import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";

const SESSION_PREFIX = "cec:wp-context-build:";

export type WorkProductContextBuildCache = {
  fingerprint: string;
  builtAt: string;
  retrievalUsed: boolean;
  documentRows: LmeDocumentPackedRow[];
  packingStats?: Pick<
    LmeRunPackingStats,
    "packedPartsCharSum" | "bundleCharCap" | "retrievalUsed" | "retrievalPack"
  >;
};

function sessionKey(kind: WorkProductPromptKind, ticker: string): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${SESSION_PREFIX}${kind}:${sym}`;
}

export function readWorkProductContextBuildCache(
  kind: WorkProductPromptKind,
  ticker: string
): WorkProductContextBuildCache | null {
  if (typeof window === "undefined") return null;
  const tk = ticker?.trim();
  if (!tk) return null;
  try {
    const raw = sessionStorage.getItem(sessionKey(kind, tk));
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as WorkProductContextBuildCache;
    if (typeof parsed.fingerprint !== "string" || !Array.isArray(parsed.documentRows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeWorkProductContextBuildCache(
  kind: WorkProductPromptKind,
  ticker: string,
  cache: WorkProductContextBuildCache
): void {
  if (typeof window === "undefined") return;
  const tk = ticker?.trim();
  if (!tk) return;
  try {
    sessionStorage.setItem(sessionKey(kind, tk), JSON.stringify(cache));
  } catch {
    /* quota */
  }
}

export function clearWorkProductContextBuildCache(kind: WorkProductPromptKind, ticker: string): void {
  if (typeof window === "undefined") return;
  const tk = ticker?.trim();
  if (!tk) return;
  try {
    sessionStorage.removeItem(sessionKey(kind, tk));
  } catch {
    /* ignore */
  }
}

export function formatWorkProductContextBuildSummary(
  cache: WorkProductContextBuildCache | null,
  packedTotal: number
): string | null {
  if (!cache) return null;
  const cap = cache.packingStats?.bundleCharCap;
  const mode = cache.retrievalUsed ? "retrieval-ranked" : "sequential";
  const chunks = cache.packingStats?.retrievalPack?.chunksInWindow;
  const parts = [`${packedTotal.toLocaleString()} chars in context`, mode];
  if (typeof cap === "number") parts.push(`${cap.toLocaleString()} cap`);
  if (typeof chunks === "number" && cache.retrievalUsed) parts.push(`${chunks} chunks selected`);
  return parts.join(" · ");
}
