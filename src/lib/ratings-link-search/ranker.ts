import type { NormalizedRatingsLink, RatingsLinkSearchContext, RatingsResultType } from "./types";

function tokenMatch(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (n.length < 2) return false;
  return h.includes(n);
}

/** 0–100 style score: higher = better match to context and relevance. */
export function scoreCompanyMatch(
  ctx: RatingsLinkSearchContext,
  title: string,
  snippet: string,
  url: string
): number {
  let score = 25;
  const blob = `${title} ${snippet} ${url}`;
  const upperTicker = ctx.ticker.toUpperCase();

  if (blob.toUpperCase().includes(upperTicker)) score += 28;

  const name = ctx.companyName.trim();
  if (name.length >= 3 && tokenMatch(blob, name)) score += 25;
  else if (name.length >= 3) {
    const first = name.split(/\s+/)[0] ?? "";
    if (first.length >= 3 && tokenMatch(blob, first)) score += 12;
  }

  for (const a of ctx.aliases) {
    if (a.length >= 3 && a !== ctx.ticker && a !== name && tokenMatch(blob, a)) {
      score += 8;
      break;
    }
  }

  const typeBonus: Partial<Record<RatingsResultType, number>> = {
    rating_action: 6,
    issue_rating: 5,
    issuer_rating: 5,
    research: 3,
    commentary: 2,
    unknown: 0,
  };

  return Math.min(100, Math.round(score));
}

export function urlQualityBonus(url: string): number {
  let b = 0;
  try {
    const u = new URL(url);
    const pathLen = u.pathname.length;
    if (pathLen > 10 && pathLen < 90) b += 4;
    if (pathLen >= 120) b -= 3;
    if (u.search.length > 40) b -= 2;
  } catch {
    /* ignore */
  }
  return b;
}

export function parsePublishedDateTs(date: string | null): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : null;
}

/** Freshness bonus: up to +12 for recent. */
export function freshnessBonus(publishedDate: string | null, now = Date.now()): number {
  const ts = parsePublishedDateTs(publishedDate);
  if (ts == null) return 0;
  const days = (now - ts) / (86400 * 1000);
  if (days < 365) return 12;
  if (days < 365 * 3) return 6;
  if (days < 365 * 7) return 2;
  return 0;
}

export type RankableResult = NormalizedRatingsLink & { _rankScore?: number };

export function rankResults(
  results: NormalizedRatingsLink[],
  mode: "relevance" | "recent" | "agency"
): NormalizedRatingsLink[] {
  const agencyOrder: Record<string, number> = { Fitch: 0, "Moody's": 1, "S&P": 2 };

  const scored: RankableResult[] = results.map((r) => ({
    ...r,
    _rankScore:
      r.companyMatchScore +
      urlQualityBonus(r.url) +
      freshnessBonus(r.publishedDate) +
      (r.resultType !== "unknown" ? 4 : 0),
  }));

  return scored
    .sort((a, b) => {
      if (mode === "agency") {
        const ao = agencyOrder[a.agency] ?? 99;
        const bo = agencyOrder[b.agency] ?? 99;
        if (ao !== bo) return ao - bo;
      }
      if (mode === "recent") {
        const at = parsePublishedDateTs(a.publishedDate) ?? 0;
        const bt = parsePublishedDateTs(b.publishedDate) ?? 0;
        if (at !== bt) return bt - at;
      }
      const as = a._rankScore ?? 0;
      const bs = b._rankScore ?? 0;
      if (as !== bs) return bs - as;
      return a.title.localeCompare(b.title);
    })
    .map(({ _rankScore: _, ...r }) => r);
}
