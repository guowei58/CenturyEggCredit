import type { SecFilingsResult } from "@/lib/sec-edgar";
import { getAllFilingsByTicker } from "@/lib/sec-edgar";

const TTL_MS = 10 * 60 * 1000;

type CacheEntry = { at: number; value: SecFilingsResult };

const byTicker = new Map<string, CacheEntry>();

function cacheKey(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function peekCachedFilingsByTicker(ticker: string): SecFilingsResult | null {
  const key = cacheKey(ticker);
  const hit = byTicker.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    byTicker.delete(key);
    return null;
  }
  return hit.value;
}

export function storeCachedFilingsByTicker(ticker: string, value: SecFilingsResult): void {
  byTicker.set(cacheKey(ticker), { at: Date.now(), value });
}

/** Submissions feed with a short-lived per-ticker cache (TEST tab accession switches). */
export async function getAllFilingsByTickerCached(ticker: string): Promise<SecFilingsResult | null> {
  const cached = peekCachedFilingsByTicker(ticker);
  if (cached) return cached;
  const fresh = await getAllFilingsByTicker(ticker);
  if (fresh) storeCachedFilingsByTicker(ticker, fresh);
  return fresh;
}
