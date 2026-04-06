import { NEWSAPI_ALLOWED_DOMAINS, hostnameMatchesNewsApiAllowlist } from "../newsApiDomains";
import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { clampInt, parseIsoOrNull } from "../utils";
import { errResult, fetchWithTimeout, okResult, perRequestLimit } from "./base";

type NewsApiArticle = {
  source?: { id?: string | null; name?: string | null };
  author?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  urlToImage?: string | null;
  publishedAt?: string | null;
  content?: string | null;
};

type NewsApiEverythingResponse = {
  status?: string;
  code?: string;
  message?: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
};

/**
 * Build NewsAPI `q` from company-centric terms (preferred). Falls back to ticker only if no name/aliases.
 */
export function buildNewsApiKeywordQuery(params: NewsQueryParams): string | null {
  const ticker = params.ticker.trim().toUpperCase();
  const parts: string[] = [];
  const addPhrase = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2) return;
    const safe = t.replace(/"/g, "").replace(/\s+/g, " ");
    if (safe.includes(" ") || /[^a-zA-Z0-9._-]/.test(safe)) {
      parts.push(`"${safe}"`);
    } else {
      parts.push(safe);
    }
  };

  if (params.companyName?.trim()) addPhrase(params.companyName);
  for (const a of params.aliases ?? []) {
    if (typeof a === "string" && a.trim()) addPhrase(a);
  }

  if (parts.length === 0) {
    addPhrase(ticker);
  }
  if (parts.length === 0) return null;
  return parts.join(" OR ");
}

function toNewsApiDateDay(isoOrDay: string | undefined): string | undefined {
  if (!isoOrDay?.trim()) return undefined;
  const s = isoOrDay.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = Date.parse(s);
  if (!Number.isFinite(d)) return undefined;
  return new Date(d).toISOString().slice(0, 10);
}

export function createNewsApiNewsProvider(): NewsProvider {
  return {
    id: "newsapi",
    name: "NewsAPI",
    enabledByDefault: true,
    supportsTickerQuery: true,
    supportsCompanyQuery: true,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      const key = runtime.apiKey?.trim();
      if (!key) {
        return errResult("newsapi", "NEWSAPI_KEY not configured");
      }

      const q = buildNewsApiKeywordQuery(params);
      if (!q) {
        return errResult("newsapi", "Could not build keyword query (need company name, aliases, or ticker)");
      }

      const ticker = params.ticker.trim().toUpperCase();
      const companyName = params.companyName?.trim() || "";
      const pageSize = clampInt(perRequestLimit(params, runtime.config.maxResults, 100), 1, 100);
      const domains = NEWSAPI_ALLOWED_DOMAINS.join(",");

      const url = new URL("https://newsapi.org/v2/everything");
      url.searchParams.set("apiKey", key);
      url.searchParams.set("q", q);
      url.searchParams.set("domains", domains);
      url.searchParams.set("searchIn", "title");
      url.searchParams.set("sortBy", "publishedAt");
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("page", "1");
      url.searchParams.set("language", "en");

      const fromDay = toNewsApiDateDay(params.from);
      const toDay = toNewsApiDateDay(params.to);
      if (fromDay) url.searchParams.set("from", fromDay);
      if (toDay) url.searchParams.set("to", toDay);

      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString(), runtime.config.timeoutMs);
      } catch (e) {
        return errResult("newsapi", e instanceof Error ? e.message : "Network error");
      }

      let json: NewsApiEverythingResponse;
      try {
        json = (await res.json()) as NewsApiEverythingResponse;
      } catch {
        return errResult("newsapi", "Invalid JSON response");
      }

      if (!res.ok || json.status === "error") {
        return errResult("newsapi", json.message ?? `HTTP ${res.status}`);
      }

      const rows = Array.isArray(json.articles) ? json.articles : [];
      const articles = rows
        .map((row) => mapRow(row, { ticker, companyName, matchedQuery: q }))
        .filter((a): a is NonNullable<typeof a> => a != null);

      return okResult("newsapi", articles, rows.length);
    },
  };
}

function mapRow(
  row: NewsApiArticle,
  ctx: { ticker: string; companyName: string; matchedQuery: string }
): ReturnType<typeof attachNormalizedUrl> | null {
  const title = row.title?.trim();
  const url = row.url?.trim();
  if (!title || !url) return null;

  let sourceDomain = "";
  try {
    const u = new URL(url);
    sourceDomain = u.hostname.replace(/^www\./i, "");
    if (!hostnameMatchesNewsApiAllowlist(u.hostname)) {
      return null;
    }
  } catch {
    return null;
  }

  const sourceName = row.source?.name?.trim() || sourceDomain || "NewsAPI";
  const nativeId = `${url}|${row.publishedAt ?? ""}`;

  const companies = new Set<string>();
  if (ctx.companyName) companies.add(ctx.companyName);

  const art = attachNormalizedUrl({
    id: makeArticleId(url, title),
    title,
    url,
    sourceName,
    sourceDomain,
    publishedAt: parseIsoOrNull(row.publishedAt ?? null),
    summary: row.description?.trim() || null,
    imageUrl: row.urlToImage?.trim() || null,
    tickers: [ctx.ticker],
    companies: Array.from(companies),
    sentimentScore: null,
    sentimentLabel: null,
    providers: ["newsapi"],
    providerIds: { newsapi: nativeId },
    language: "en",
    matchedQuery: ctx.matchedQuery,
  });
  return art;
}
