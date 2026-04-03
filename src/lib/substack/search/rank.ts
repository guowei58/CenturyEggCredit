import type { SubstackSearchResult } from "../types";

export type SortMode = "relevance" | "recent" | "publication";

export function scoreResult(r: SubstackSearchResult): number {
  let s = 0;
  s += Math.round(r.post.confidenceScore * 100);
  if (r.discoverySource === "merged") s += 18;
  if (r.post.source === "rss") s += 10;
  if (r.publication?.isLikelySubstack) s += 6;
  s += Math.round((r.publication?.confidenceScore ?? 0) * 25);

  if (r.post.publishedAt) {
    const ageDays = (Date.now() - Date.parse(r.post.publishedAt)) / (86400 * 1000);
    if (ageDays < 14) s += 10;
    else if (ageDays < 60) s += 6;
    else if (ageDays < 365) s += 2;
  }
  return s + r.relevanceScore;
}

export function rankResults(results: SubstackSearchResult[], mode: SortMode): SubstackSearchResult[] {
  const scored = results.map((r) => ({
    r,
    s: mode === "relevance" ? scoreResult(r) : 0,
    t: r.post.publishedAt ? Date.parse(r.post.publishedAt) : 0,
    p: (r.publication?.name ?? r.post.publicationName ?? "").toLowerCase(),
  }));

  return scored
    .sort((a, b) => {
      if (mode === "recent") {
        if (a.t !== b.t) return b.t - a.t;
      } else if (mode === "publication") {
        if (a.p !== b.p) return a.p.localeCompare(b.p);
      } else {
        if (a.s !== b.s) return b.s - a.s;
      }
      return b.t - a.t;
    })
    .map((x) => x.r);
}

