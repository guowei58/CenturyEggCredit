import type { NewsQueryParams, NormalizedNewsArticle } from "./types";
import { normalizeTitleForMatch } from "./utils";

function tokenHit(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.trim().toLowerCase();
  return n.length > 1 && h.includes(n);
}

/**
 * Higher score = better for default "relevance" sort.
 */
export function scoreArticleForRanking(article: NormalizedNewsArticle, query: NewsQueryParams): number {
  let score = 0;
  const blob = `${article.title} ${article.summary ?? ""}`.toLowerCase();
  const tk = query.ticker.trim().toUpperCase();
  if (article.tickers.map((t) => t.toUpperCase()).includes(tk)) score += 35;
  if (blob.includes(tk.toLowerCase())) score += 18;

  const name = query.companyName?.trim() ?? "";
  if (name.length >= 3) {
    if (tokenHit(blob, name)) score += 28;
    const first = name.split(/\s+/)[0] ?? "";
    if (first.length >= 3 && tokenHit(blob, first)) score += 10;
  }

  for (const alias of query.aliases ?? []) {
    const a = typeof alias === "string" ? alias.trim() : "";
    if (a.length >= 3 && tokenHit(blob, a)) score += 12;
  }

  const pub = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
  if (Number.isFinite(pub)) {
    const ageDays = (Date.now() - pub) / (86400 * 1000);
    if (ageDays < 2) score += 22;
    else if (ageDays < 7) score += 16;
    else if (ageDays < 30) score += 10;
    else if (ageDays < 180) score += 4;
  }

  const sourceCount = article.providers.length;
  score += Math.min(15, sourceCount * 7);

  if (article.summary && article.summary.length > 80) score += 6;
  if (article.imageUrl) score += 4;
  if (article.sentimentScore != null) score += 2;

  const prio = article._bestProviderPriority ?? 5;
  score += Math.max(0, 6 - Math.min(6, prio));

  if (normalizeTitleForMatch(article.title).length < 12) score -= 4;

  return score;
}

export function rankArticles(
  articles: NormalizedNewsArticle[],
  query: NewsQueryParams,
  mode: "relevance" | "recent"
): NormalizedNewsArticle[] {
  const scored = articles.map((a) => ({
    a,
    s: mode === "recent" ? 0 : scoreArticleForRanking(a, query),
  }));

  return scored
    .sort((x, y) => {
      if (mode === "recent") {
        const tx = x.a.publishedAt ? Date.parse(x.a.publishedAt) : 0;
        const ty = y.a.publishedAt ? Date.parse(y.a.publishedAt) : 0;
        if (tx !== ty) return ty - tx;
      } else if (x.s !== y.s) {
        return y.s - x.s;
      }
      const tx = x.a.publishedAt ? Date.parse(x.a.publishedAt) : 0;
      const ty = y.a.publishedAt ? Date.parse(y.a.publishedAt) : 0;
      return ty - tx;
    })
    .map(({ a }) => a);
}
