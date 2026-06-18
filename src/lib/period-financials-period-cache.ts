/**
 * In-memory cache for Period Financials tab payloads, keyed by ticker + accession.
 * Survives period switches and leaving/re-entering the page within the same browser session.
 * Not written to saved documents or localStorage (payloads can be large HTML).
 */

import type {
  FacePresentedStatementForSave,
  SecIxbrlFacePresentedApiResponse,
} from "@/lib/sec-ixbrl-face-save-client";
import type { FaceStatementExtractionQa } from "@/lib/sec-ixbrl-face-extract";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

export type PeriodFinancialsMgmtDiscoveryCache = {
  data: {
    ok: boolean;
    best: { title: string; url: string; file_type: string } | null;
    savedDocument: { filename: string; openUrl: string; bytes: number } | null;
    error: string | null;
  } | null;
  notFound: boolean;
};

export type PeriodFinancialsFaceCache = {
  ok: boolean;
  statements: FacePresentedStatementForSave[];
  validation?: XbrlExportValidationIssue[];
  extractionQa?: FaceStatementExtractionQa[];
  calculationLinkbaseLoaded?: boolean;
  selected?: SecIxbrlFacePresentedApiResponse["selected"];
  error?: string;
};

export type PeriodFinancialsPeriodSnapshot = {
  face?: PeriodFinancialsFaceCache;
  ixbrl?: unknown;
  ixErr?: string | null;
  debtFootnote?: unknown;
  debtErr?: string | null;
  mgmtDiscovery?: PeriodFinancialsMgmtDiscoveryCache;
  touchedAt: number;
};

const MAX_PER_TICKER = 64;
const store = new Map<string, PeriodFinancialsPeriodSnapshot>();

export function periodFinancialsCacheKey(ticker: string, accessionNumber: string): string {
  const tk = ticker.trim().toUpperCase();
  const acc = accessionNumber.replace(/-/g, "").trim();
  return `${tk}:${acc}`;
}

export function getPeriodFinancialsPeriodCache(key: string): PeriodFinancialsPeriodSnapshot | undefined {
  const snap = store.get(key);
  if (!snap) return undefined;
  snap.touchedAt = Date.now();
  return snap;
}

export function patchPeriodFinancialsPeriodCache(
  ticker: string,
  accessionNumber: string,
  patch: Partial<Omit<PeriodFinancialsPeriodSnapshot, "touchedAt">>
): void {
  const key = periodFinancialsCacheKey(ticker, accessionNumber);
  const prev = store.get(key);
  store.set(key, {
    ...prev,
    ...patch,
    touchedAt: Date.now(),
  });
  evictOldestForTicker(ticker);
}

function evictOldestForTicker(ticker: string): void {
  const prefix = `${ticker.trim().toUpperCase()}:`;
  const forTicker = [...store.entries()].filter(([k]) => k.startsWith(prefix));
  if (forTicker.length <= MAX_PER_TICKER) return;
  forTicker.sort((a, b) => a[1].touchedAt - b[1].touchedAt);
  const drop = forTicker.length - MAX_PER_TICKER;
  for (let i = 0; i < drop; i += 1) {
    store.delete(forTicker[i]![0]);
  }
}

/** Test helper — clear all cached periods for one ticker. */
export function clearPeriodFinancialsTickerCache(ticker: string): void {
  const prefix = `${ticker.trim().toUpperCase()}:`;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Test helper — wipe entire cache. */
export function clearPeriodFinancialsPeriodCacheAll(): void {
  store.clear();
}
