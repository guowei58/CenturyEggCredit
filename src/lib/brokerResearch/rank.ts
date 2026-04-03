import type { BrokerResearchResult } from "./types";
import { isLikelyGenericLandingPath, normalizeTitleForMatch } from "./utils";

export type SortMode = "relevance" | "recent";

function pathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Higher = better for relevance sort.
 */
export function scoreForRanking(
  r: BrokerResearchResult,
  ctx: { ticker: string; companyName?: string }
): number {
  let s = 0;
  const blob = `${r.title} ${r.snippet ?? ""}`.toLowerCase();
  const tk = ctx.ticker.trim().toUpperCase();
  if (r.matchedTickers.map((x) => x.toUpperCase()).includes(tk)) s += 40;
  if (blob.includes(tk.toLowerCase())) s += 22;

  const name = ctx.companyName?.trim() ?? "";
  if (name.length >= 3 && blob.includes(name.toLowerCase())) s += 28;

  for (const sig of r.supportingSignals) {
    if (sig === "broker_domain_match") s += 12;
    if (sig.startsWith("url_hint:")) s += 4;
    if (sig === "company_name_in_text") s += 10;
    if (sig === "ticker_in_text") s += 6;
  }

  if (r.reportType !== "unknown" && r.reportType !== "research_landing_page") s += 14;
  if (r.reportType === "research_landing_page") s -= 25;
  if (r.reportType === "research_portal") s += 4;

  const p = pathOnly(r.url);
  if (isLikelyGenericLandingPath(p)) s -= 35;

  if (r.publishedAt) {
    const age = (Date.now() - Date.parse(r.publishedAt)) / (86400 * 1000);
    if (age < 30) s += 18;
    else if (age < 90) s += 12;
    else if (age < 365) s += 6;
  }

  if ((r.snippet?.length ?? 0) > 80) s += 8;
  if (r.confidenceScore > 0.5) s += 10;

  if (normalizeTitleForMatch(r.title).length < 14) s -= 6;

  return s + r.relevanceScore * 0.01;
}

export function rankBrokerResults(
  results: BrokerResearchResult[],
  ctx: { ticker: string; companyName?: string },
  mode: SortMode
): BrokerResearchResult[] {
  const scored = results.map((r) => ({ r, x: mode === "recent" ? 0 : scoreForRanking(r, ctx) }));

  return scored
    .sort((a, b) => {
      if (mode === "recent") {
        const ta = a.r.publishedAt ? Date.parse(a.r.publishedAt) : 0;
        const tb = b.r.publishedAt ? Date.parse(b.r.publishedAt) : 0;
        if (ta !== tb) return tb - ta;
      } else if (a.x !== b.x) {
        return b.x - a.x;
      }
      const ta = a.r.publishedAt ? Date.parse(a.r.publishedAt) : 0;
      const tb = b.r.publishedAt ? Date.parse(b.r.publishedAt) : 0;
      return tb - ta;
    })
    .map(({ r }) => r);
}
