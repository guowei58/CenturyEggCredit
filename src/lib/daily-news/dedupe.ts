import { createHash } from "crypto";
import type { DailyNewsItem } from "./types";

function normalizeHeadline(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeHashFor(headline: string, url: string): string {
  const h = createHash("sha256");
  h.update(normalizeHeadline(headline));
  h.update("|");
  h.update(url.trim());
  return h.digest("hex").slice(0, 32);
}

/** Prefer higher-quality `sourceRank` (lower = better). */
const SOURCE_RANK: Record<string, number> = {
  SEC: 0,
  WSJ: 1,
  Bloomberg: 2,
  FT: 3,
  trade: 4,
  other: 9,
};

function rank(item: DailyNewsItem): number {
  return SOURCE_RANK[item.sourceType] ?? 6;
}

export function dedupeNewsItems(items: DailyNewsItem[]): DailyNewsItem[] {
  const byNorm = new Map<string, DailyNewsItem>();
  for (const it of items) {
    const key = normalizeHeadline(it.headline);
    if (!key) continue;
    const prev = byNorm.get(key);
    if (!prev || rank(it) < rank(prev) || (rank(it) === rank(prev) && it.publishedAt > prev.publishedAt)) {
      byNorm.set(key, it);
    }
  }
  return Array.from(byNorm.values()).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}
