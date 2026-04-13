import {
  fetchGoogleNewsRssSearch,
  fetchRssFeed,
  resolvePublisherUrlFromGoogleNewsRss,
  type RssArticle,
} from "@/lib/daily-news/rss";
import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { clampInt, normalizeUrlForMatch } from "../utils";
import { okResult, perRequestLimit } from "./base";

/** Outlets requested for Google News site-restricted RSS (matches News & Events workflow). */
const SITE_GROUP =
  "(site:wsj.com OR site:ft.com OR site:bloomberg.com OR site:finance.yahoo.com OR site:reuters.com OR site:apnews.com)";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedOutletHost(host: string): boolean {
  if (!host) return false;
  const allow = [
    "wsj.com",
    "ft.com",
    "bloomberg.com",
    "finance.yahoo.com",
    "reuters.com",
    "apnews.com",
    "yahoo.com", // rare Yahoo News paths
  ];
  return allow.some((d) => host === d || host.endsWith(`.${d}`));
}

function outletLabelFromHost(host: string): string {
  if (host.includes("wsj.")) return "WSJ";
  if (host.includes("ft.com")) return "Financial Times";
  if (host.includes("bloomberg.")) return "Bloomberg";
  if (host.includes("finance.yahoo.") || (host.includes("yahoo.") && host.includes("finance"))) return "Yahoo Finance";
  if (host.includes("reuters.")) return "Reuters";
  if (host.includes("apnews.")) return "Associated Press";
  if (host.includes("yahoo.")) return "Yahoo";
  return host || "News";
}

function buildEntityQuery(params: NewsQueryParams): string {
  const tk = params.ticker.trim().toUpperCase();
  const terms: string[] = [`"$${tk}"`];
  const name = params.companyName?.trim();
  if (name && name.length >= 2) {
    terms.push(`"${name.replace(/"/g, "")}"`);
  }
  for (const a of (params.aliases ?? []).slice(0, 4)) {
    const t = a.trim();
    if (t.length >= 2) terms.push(`"${t.replace(/"/g, "")}"`);
  }
  if (terms.length === 1 && tk.length >= 1) {
    terms.push(tk);
  }
  let q = `(${terms.join(" OR ")}) ${SITE_GROUP}`;
  if (q.length > 480) {
    q = `("$${tk}") ${SITE_GROUP}`;
  }
  return q;
}

function textMatchesEntity(hay: string, ticker: string, companyName?: string, aliases?: string[]): boolean {
  const u = hay.toUpperCase();
  const tk = ticker.toUpperCase();
  if (u.includes(`$${tk}`)) return true;
  if (u.includes(tk) && tk.length >= 3) return true;
  const name = companyName?.trim();
  if (name && name.length >= 3 && hay.toLowerCase().includes(name.toLowerCase())) return true;
  for (const a of aliases ?? []) {
    const s = a.trim();
    if (s.length >= 3 && hay.toLowerCase().includes(s.toLowerCase())) return true;
  }
  return false;
}

function parsePub(isoOrRfc: string): string | null {
  const d = Date.parse(isoOrRfc);
  if (!Number.isFinite(d)) return null;
  return new Date(d).toISOString();
}

function mapRssToArticle(
  row: RssArticle,
  ticker: string,
  resolvedUrl: string,
  matchedQuery: string,
  companyName?: string,
  aliases?: string[],
  /** Yahoo headline feed is already scoped to the symbol; skip strict keyword match. */
  fromYahooHeadlineFeed?: boolean
): ReturnType<typeof attachNormalizedUrl> | null {
  const title = row.title?.trim();
  if (!title) return null;
  const blob = `${title}\n${row.description ?? ""}`;
  if (!fromYahooHeadlineFeed && !textMatchesEntity(blob, ticker, companyName, aliases)) return null;

  const host = hostOf(resolvedUrl);
  if (!isAllowedOutletHost(host)) return null;

  const summary = row.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;

  return attachNormalizedUrl({
    id: makeArticleId(resolvedUrl, title),
    title,
    url: resolvedUrl,
    sourceName: outletLabelFromHost(host),
    sourceDomain: host,
    publishedAt: parsePub(row.pubDate),
    summary,
    imageUrl: null,
    tickers: [ticker],
    companies: companyName ? [companyName] : [],
    sentimentScore: null,
    sentimentLabel: null,
    providers: ["major_outlet_rss"],
    providerIds: { major_outlet_rss: `rss:${normalizeUrlForMatch(resolvedUrl) ?? resolvedUrl}` },
    matchedQuery,
    language: "en",
  });
}

export function createMajorOutletRssNewsProvider(): NewsProvider {
  return {
    id: "major_outlet_rss",
    name: "Major outlets (RSS)",
    enabledByDefault: true,
    supportsTickerQuery: true,
    supportsCompanyQuery: true,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      const ticker = params.ticker.trim().toUpperCase();
      const maxTotal = clampInt(perRequestLimit(params, runtime.config.maxResults, 80), 1, 80);
      const yahooCap = Math.min(35, Math.ceil(maxTotal * 0.45));
      const googleCap = Math.min(40, maxTotal - yahooCap + 10);

      const companyName = params.companyName?.trim();
      const aliases = params.aliases;

      const yahooUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
      let yahooRows: RssArticle[] = [];
      try {
        yahooRows = await fetchRssFeed(yahooUrl, yahooCap);
      } catch {
        yahooRows = [];
      }

      const googleQuery = buildEntityQuery(params);
      let googleRows: RssArticle[] = [];
      try {
        googleRows = await fetchGoogleNewsRssSearch(googleQuery, googleCap, "90d");
      } catch {
        googleRows = [];
      }

      const seen = new Set<string>();
      const articles: ReturnType<typeof attachNormalizedUrl>[] = [];
      let rawCount = 0;

      for (const row of yahooRows) {
        rawCount += 1;
        let url = row.link?.trim();
        if (!url) continue;
        try {
          url = await resolvePublisherUrlFromGoogleNewsRss(url, Math.min(12_000, runtime.config.timeoutMs));
        } catch {
          /* keep */
        }
        const k = normalizeUrlForMatch(url) ?? url;
        if (seen.has(k)) continue;
        const a = mapRssToArticle(row, ticker, url, `yahoo-headline:${yahooUrl}`, companyName, aliases, true);
        if (!a) continue;
        seen.add(k);
        articles.push(a);
      }

      for (const row of googleRows) {
        rawCount += 1;
        let url = row.link?.trim();
        if (!url) continue;
        try {
          url = await resolvePublisherUrlFromGoogleNewsRss(url, Math.min(12_000, runtime.config.timeoutMs));
        } catch {
          /* keep */
        }
        const k = normalizeUrlForMatch(url) ?? url;
        if (seen.has(k)) continue;
        const a = mapRssToArticle(row, ticker, url, `google-news-rss:${googleQuery.slice(0, 200)}`, companyName, aliases);
        if (!a) continue;
        seen.add(k);
        articles.push(a);
      }

      return okResult("major_outlet_rss", articles.slice(0, maxTotal), rawCount);
    },
  };
}
