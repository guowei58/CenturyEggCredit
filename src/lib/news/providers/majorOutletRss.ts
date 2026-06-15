import {
  fetchGoogleNewsRssSearch,
  fetchRssFeed,
  isGoogleNewsUrl,
  resolvePublisherUrlFromGoogleNewsRss,
  type RssArticle,
} from "@/lib/daily-news/rss";
import {
  buildGoogleNewsSiteGroupForDomains,
  GOOGLE_NEWS_SITE_BATCHES,
  hostnameMatchesNewsApiAllowlist,
  outletLabelFromHost,
} from "../newsApiDomains";
import { MAJOR_OUTLET_GOOGLE_NEWS_WHEN } from "../constants";
import { isLikelyTickerInstrumentPage } from "../stockPageFilter";
import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { clampInt, normalizeUrlForMatch } from "../utils";
import { okResult, perRequestLimit } from "./base";

const CORPORATE_SUFFIX = /^(inc|corp|corporation|ltd|llc|plc|group|holdings|co|company)$/i;

const GENERIC_NAME_TOKENS = new Set([
  "global",
  "holdings",
  "media",
  "group",
  "services",
  "systems",
  "international",
  "national",
  "american",
  "capital",
  "financial",
  "technologies",
  "technology",
  "industries",
  "industrial",
  "resources",
  "partners",
  "partnership",
  "management",
  "entertainment",
  "communications",
  "solutions",
  "worldwide",
]);

function significantNameTokens(companyName?: string, ticker?: string): string[] {
  const name = companyName?.trim();
  if (!name) return [];
  if (ticker && name.toUpperCase() === ticker.toUpperCase()) return [];
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[.,]/g, ""))
    .filter(
      (w) =>
        w.length >= 4 &&
        !CORPORATE_SUFFIX.test(w) &&
        !GENERIC_NAME_TOKENS.has(w.toLowerCase())
    );
}

function buildEntityQuery(params: NewsQueryParams, siteGroup: string): string {
  const tk = params.ticker.trim().toUpperCase();
  const terms: string[] = [`"$${tk}"`];
  const name = params.companyName?.trim();
  if (name && name.length >= 2 && name.toUpperCase() !== tk) {
    terms.push(`"${name.replace(/"/g, "")}"`);
  }
  for (const token of significantNameTokens(name, tk).slice(0, 3)) {
    terms.push(`"${token.replace(/"/g, "")}"`);
  }
  for (const a of (params.aliases ?? []).slice(0, 4)) {
    const t = a.trim();
    if (t.length >= 2) terms.push(`"${t.replace(/"/g, "")}"`);
  }
  if (terms.length === 1 && tk.length >= 1) {
    terms.push(tk);
  }
  let q = `(${terms.join(" OR ")}) ${siteGroup}`;
  if (q.length > 480) {
    q = `("$${tk}") ${siteGroup}`;
  }
  return q;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedOutletHost(host: string): boolean {
  return hostnameMatchesNewsApiAllowlist(host);
}

function textMatchesEntity(hay: string, ticker: string, companyName?: string, aliases?: string[]): boolean {
  const u = hay.toUpperCase();
  const tk = ticker.toUpperCase();
  if (u.includes(`$${tk}`)) return true;
  if (tk.length >= 3 && new RegExp(`\\b${tk}\\b`).test(u)) return true;
  const name = companyName?.trim();
  if (name && name.length >= 3 && name.toUpperCase() !== tk && hay.toLowerCase().includes(name.toLowerCase())) {
    return true;
  }
  for (const token of significantNameTokens(name, tk)) {
    if (hay.toLowerCase().includes(token.toLowerCase())) return true;
  }
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

/** Resolve outlet identity + open URL after best-effort Google redirect follow. */
export function resolveMajorOutletArticleContext(
  resolvedUrl: string,
  row: Pick<RssArticle, "link" | "sourceUrl" | "sourceName">
): { host: string; openUrl: string; sourceName: string } | null {
  const resolvedHost = hostOf(resolvedUrl);
  if (isAllowedOutletHost(resolvedHost)) {
    return {
      host: resolvedHost,
      openUrl: resolvedUrl,
      sourceName: outletLabelFromHost(resolvedHost),
    };
  }

  const feedSourceHost = hostOf(row.sourceUrl?.trim() ?? "");
  if (!isAllowedOutletHost(feedSourceHost)) return null;

  const openUrl = isGoogleNewsUrl(resolvedUrl) ? row.link.trim() : resolvedUrl;
  if (!openUrl) return null;

  return {
    host: feedSourceHost,
    openUrl,
    sourceName: row.sourceName?.trim() || outletLabelFromHost(feedSourceHost),
  };
}

function mapRssToArticle(
  row: RssArticle,
  ticker: string,
  resolvedUrl: string,
  matchedQuery: string,
  companyName?: string,
  aliases?: string[]
): ReturnType<typeof attachNormalizedUrl> | null {
  const title = row.title?.trim();
  if (!title) return null;
  const blob = `${title}\n${row.description ?? ""}`;
  if (!textMatchesEntity(blob, ticker, companyName, aliases)) return null;

  const outlet = resolveMajorOutletArticleContext(resolvedUrl, row);
  if (!outlet) return null;

  if (
    isLikelyTickerInstrumentPage({
      title,
      url: outlet.openUrl,
      sourceDomain: outlet.host,
    })
  ) {
    return null;
  }

  const summary = row.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;

  return attachNormalizedUrl({
    id: makeArticleId(outlet.openUrl, title),
    title,
    url: outlet.openUrl,
    sourceName: outlet.sourceName,
    sourceDomain: outlet.host,
    publishedAt: parsePub(row.pubDate),
    summary,
    imageUrl: null,
    tickers: [ticker],
    companies: companyName ? [companyName] : [],
    sentimentScore: null,
    sentimentLabel: null,
    providers: ["major_outlet_rss"],
    providerIds: { major_outlet_rss: `rss:${normalizeUrlForMatch(outlet.openUrl) ?? outlet.openUrl}` },
    matchedQuery,
    language: "en",
  });
}

async function fetchGoogleNewsRows(params: NewsQueryParams, perBatchCap: number): Promise<RssArticle[]> {
  const batches = GOOGLE_NEWS_SITE_BATCHES;
  const settled = await Promise.allSettled(
    batches.map(async (batch) => {
      const siteGroup = buildGoogleNewsSiteGroupForDomains(batch);
      const query = buildEntityQuery(params, siteGroup);
      return fetchGoogleNewsRssSearch(query, perBatchCap, MAJOR_OUTLET_GOOGLE_NEWS_WHEN);
    })
  );

  const merged: RssArticle[] = [];
  const seenLinks = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const row of result.value) {
      const link = row.link?.trim();
      if (!link || seenLinks.has(link)) continue;
      seenLinks.add(link);
      merged.push(row);
    }
  }
  return merged;
}

export function createMajorOutletRssNewsProvider(): NewsProvider {
  return {
    id: "major_outlet_rss",
    name: "Major outlet RSS",
    enabledByDefault: true,
    supportsTickerQuery: true,
    supportsCompanyQuery: true,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      const ticker = params.ticker.trim().toUpperCase();
      const maxTotal = clampInt(perRequestLimit(params, runtime.config.maxResults, 100), 1, 100);
      const yahooCap = Math.min(50, Math.ceil(maxTotal * 0.5));
      const googleCap = Math.min(60, maxTotal);
      const googlePerBatch = Math.min(35, Math.ceil(googleCap / GOOGLE_NEWS_SITE_BATCHES.length) + 5);

      const companyName = params.companyName?.trim();
      const aliases = params.aliases;
      const resolveTimeout = Math.min(12_000, runtime.config.timeoutMs);

      const yahooUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
      let yahooRows: RssArticle[] = [];
      try {
        yahooRows = await fetchRssFeed(yahooUrl, yahooCap);
      } catch {
        yahooRows = [];
      }

      let googleRows: RssArticle[] = [];
      try {
        googleRows = await fetchGoogleNewsRows(params, googlePerBatch);
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
          url = await resolvePublisherUrlFromGoogleNewsRss(url, resolveTimeout);
        } catch {
          /* keep */
        }
        const k = normalizeUrlForMatch(url) ?? url;
        if (seen.has(k)) continue;
        const a = mapRssToArticle(row, ticker, url, `yahoo-headline:${yahooUrl}`, companyName, aliases);
        if (!a) continue;
        seen.add(k);
        articles.push(a);
      }

      for (const row of googleRows) {
        rawCount += 1;
        let url = row.link?.trim();
        if (!url) continue;
        try {
          url = await resolvePublisherUrlFromGoogleNewsRss(url, resolveTimeout);
        } catch {
          /* keep */
        }
        const k = normalizeUrlForMatch(url) ?? url;
        if (seen.has(k)) continue;
        const a = mapRssToArticle(
          row,
          ticker,
          url,
          `google-news-rss:${buildEntityQuery(params, buildGoogleNewsSiteGroupForDomains(GOOGLE_NEWS_SITE_BATCHES[0]!)).slice(0, 120)}`,
          companyName,
          aliases
        );
        if (!a) continue;
        seen.add(k);
        articles.push(a);
      }

      return okResult("major_outlet_rss", articles.slice(0, maxTotal), rawCount);
    },
  };
}
