/**
 * IMPORTANT SEC ACCESS RULES (spec): User-Agent, conservative rate limit, local cache, gentle retry.
 */

import { SEC_REQUEST_GAP_MS } from "@/lib/debt-map/constants";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

import type { SecFilingIndexItem } from "@/lib/sec/filingIndex";

let lastSecAt = 0;

async function paceGap(): Promise<void> {
  const wait = Math.max(0, SEC_REQUEST_GAP_MS - (Date.now() - lastSecAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSecAt = Date.now();
}

const textCache = new Map<string, { exp: number; body: string }>();

function cacheGet(url: string): string | null {
  const row = textCache.get(url);
  if (!row || row.exp <= Date.now()) return null;
  return row.body;
}

function cacheSet(url: string, ttlMs: number, body: string): void {
  textCache.set(url, { exp: Date.now() + ttlMs, body });
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  let attempt = 0;
  while (attempt < 4) {
    await paceGap();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": getSecEdgarUserAgent() },
        cache: "no-store",
      });
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        attempt++;
        continue;
      }
      return res;
    } catch {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      attempt++;
    }
  }
  return null;
}

/** Cached SEC GET returning UTF-8 text (HTML/JSON). */
export async function secFetchText(url: string, ttlMs: number): Promise<string | null> {
  const hit = cacheGet(url);
  if (hit !== null) return hit;
  const res = await fetchWithRetry(url);
  if (!res?.ok) return null;
  const body = await res.text();
  cacheSet(url, ttlMs, body);
  return body;
}

function normalizeIndexJsonItems(data: unknown): SecFilingIndexItem[] {
  if (!data || typeof data !== "object") return [];
  const dir = (data as Record<string, unknown>).directory;
  if (!dir || typeof dir !== "object") return [];
  const item = (dir as Record<string, unknown>).item;
  const raw: unknown[] = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
  return raw
    .filter((x) => x && typeof x === "object")
    .map((x) => x as SecFilingIndexItem)
    .map((i) => ({ ...i, name: (i.name ?? "").trim() }))
    .filter((i) => i.name.length > 0);
}

/** Filing directory index.json (cached). */
export async function fetchFilingIndex(cikPadded: string, accessionNumberDashed: string): Promise<SecFilingIndexItem[]> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return [];
  const accNoDashes = accessionNumberDashed.replace(/-/g, "");
  if (accNoDashes.length < 10) return [];
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/index.json`;
  const raw = await secFetchText(url, 30 * 60 * 1000);
  if (!raw) return [];
  try {
    return normalizeIndexJsonItems(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}
