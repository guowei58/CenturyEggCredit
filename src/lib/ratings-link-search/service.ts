import {
  classifyResultType,
  extractInstrumentHints,
  inferAccessLevel,
  inferAgencyFromUrl,
  isAllowedAgencyDomain,
} from "./classifier";
import { buildRatingsSearchContext } from "./companyContext";
import { canonicalizeUrl, dedupeNormalizedResults, stableLinkId } from "./dedupe";
import { buildRatingsSearchQueries } from "./queryBuilder";
import { rankResults, scoreCompanyMatch } from "./ranker";
import type {
  DiscoverRatingsLinksInput,
  DiscoverRatingsLinksOutput,
  NormalizedRatingsLink,
  RatingsLinkSearchContext,
  RatingsSearchProvider,
  RawSearchHit,
} from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeHit(hit: RawSearchHit, ctx: RatingsLinkSearchContext): NormalizedRatingsLink | null {
  let host = "";
  try {
    host = new URL(hit.url).hostname;
  } catch {
    return null;
  }
  if (!isAllowedAgencyDomain(host)) return null;
  const agency = inferAgencyFromUrl(hit.url);
  if (!agency) return null;
  const canon = canonicalizeUrl(hit.url) ?? hit.url;
  const resultType = classifyResultType(hit.title, hit.snippet, canon);
  const accessLevel = inferAccessLevel(canon, agency);
  const instrumentHints = extractInstrumentHints(hit.title, hit.snippet);
  const companyMatchScore = scoreCompanyMatch(ctx, hit.title, hit.snippet, canon);
  return {
    id: stableLinkId(canon, hit.title),
    agency,
    title: hit.title,
    url: canon,
    snippet: hit.snippet,
    query: hit.query,
    sourceDomain: host,
    resultType,
    companyMatchScore,
    instrumentHints,
    accessLevel,
    publishedDate: hit.publishedDate ?? null,
  };
}

export async function discoverRatingsLinksWithProvider(
  input: DiscoverRatingsLinksInput,
  provider: RatingsSearchProvider,
  options?: { queryDelayMs?: number; rankMode?: "relevance" | "recent" | "agency" }
): Promise<DiscoverRatingsLinksOutput> {
  const companyName = (input.companyName ?? "").trim() || input.ticker.trim();
  const extra = Array.isArray(input.aliases) ? input.aliases.map((a) => String(a)) : [];
  const ctx = buildRatingsSearchContext(input.ticker, companyName, extra);
  const queries = buildRatingsSearchQueries(ctx);
  const collected: NormalizedRatingsLink[] = [];
  const delay = options?.queryDelayMs ?? 100;
  /** ~Previously ~12 queries × 8 hits; keep a similar organic budget across fewer calls. */
  const hitsPerQuery = Math.min(
    100,
    Math.max(10, Math.ceil(96 / Math.max(1, queries.length)))
  );

  for (const q of queries) {
    let hits: RawSearchHit[] = [];
    try {
      hits = await provider.search(q, { num: hitsPerQuery });
    } catch (e) {
      console.error("[ratings-links] query failed:", q.slice(0, 80), e);
    }
    for (const h of hits) {
      const n = normalizeHit(h, ctx);
      if (n) collected.push(n);
    }
    if (delay > 0) await sleep(delay);
  }

  const deduped = dedupeNormalizedResults(collected);
  const rankMode = options?.rankMode ?? "relevance";
  const results = rankResults(deduped, rankMode);

  return {
    company: {
      ticker: ctx.ticker,
      companyName: ctx.companyName,
      aliases: ctx.aliases,
    },
    results,
    queriesRun: queries,
  };
}
