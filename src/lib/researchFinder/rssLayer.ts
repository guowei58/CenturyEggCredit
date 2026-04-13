import { fetchGoogleNewsRssSearch, resolvePublisherUrlFromGoogleNewsRss } from "@/lib/daily-news/rss";
import { buildProviderQueries } from "./queryBuilder";
import type { ResearchFinderConfig } from "./config";
import type { ResearchProviderId, ResearchProfile } from "./types";
import { getProviderById } from "./providers";
import { hostnameOf, normalizeUrlForMatch } from "./utils";

export type DiscoveryHit = {
  title: string;
  url: string;
  snippet: string;
  query: string;
  publishedDate?: string | null;
  /** Serper / Google CSE organic hit */
  fromSearch: boolean;
  /** Google News RSS (no API key) */
  fromRss: boolean;
};

function keyOf(url: string): string {
  return (normalizeUrlForMatch(url) ?? url).toLowerCase();
}

function isJunkUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /(login|signup|trial|careers|privacy|terms|about|contact)/i.test(u);
}

/**
 * Google News RSS + optional redirect resolution, scoped to the same site-restricted queries as web search.
 */
export async function gatherRssDiscoveryHits(
  providerId: ResearchProviderId,
  profile: ResearchProfile,
  cfg: ResearchFinderConfig
): Promise<DiscoveryHit[]> {
  if (!cfg.rssLayerEnabled) return [];

  const def = getProviderById(providerId);
  if (!def) return [];

  const allow = new Set(def.domains.map((d) => d.toLowerCase()));
  const queries = buildProviderQueries(providerId, profile, cfg.maxQueriesPerProvider);
  const out: DiscoveryHit[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    let articles;
    try {
      articles = await fetchGoogleNewsRssSearch(q, cfg.rssMaxItemsPerQuery, cfg.rssWhenWindow);
    } catch {
      continue;
    }

    for (const a of articles) {
      let url = a.link;
      try {
        url = await resolvePublisherUrlFromGoogleNewsRss(a.link, cfg.rssResolveTimeoutMs);
      } catch {
        /* keep original */
      }

      const host = hostnameOf(url).toLowerCase();
      const okDomain = Array.from(allow).some((d) => host === d || host.endsWith(`.${d}`));
      if (!okDomain || isJunkUrl(url)) continue;

      const k = keyOf(url);
      if (seen.has(k)) continue;
      seen.add(k);

      const snippet = (a.description ?? "").trim() || a.title;
      out.push({
        title: a.title,
        url,
        snippet,
        query: `rss-google:${q.slice(0, 120)}`,
        publishedDate: a.pubDate,
        fromSearch: false,
        fromRss: true,
      });
    }
  }

  return out;
}

export function mergeSearchAndDiscoveryHits(
  searchHits: Array<{ title: string; url: string; snippet: string; query: string; publishedDate?: string | null }>,
  extra: DiscoveryHit[]
): DiscoveryHit[] {
  const map = new Map<string, DiscoveryHit>();

  for (const h of searchHits) {
    const k = keyOf(h.url);
    map.set(k, {
      title: h.title,
      url: h.url,
      snippet: h.snippet,
      query: h.query,
      publishedDate: h.publishedDate,
      fromSearch: true,
      fromRss: false,
    });
  }

  for (const h of extra) {
    const k = keyOf(h.url);
    const ex = map.get(k);
    if (!ex) {
      map.set(k, h);
      continue;
    }
    const preferSnippet = (h.snippet?.length ?? 0) > (ex.snippet?.length ?? 0) ? h.snippet : ex.snippet;
    map.set(k, {
      ...ex,
      ...h,
      snippet: preferSnippet ?? ex.snippet,
      query: ex.fromSearch ? `${ex.query} | ${h.query}` : h.query,
      fromSearch: ex.fromSearch,
      fromRss: true,
    });
  }

  return [...map.values()];
}

export function discoveryChannels(hit: DiscoveryHit): ("search" | "rss")[] {
  const ch: ("search" | "rss")[] = [];
  if (hit.fromSearch) ch.push("search");
  if (hit.fromRss) ch.push("rss");
  return ch;
}
