import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { clampInt, parseAlphaVantageTime } from "../utils";
import { errResult, fetchWithTimeout, okResult, perRequestLimit } from "./base";

type AvTickerSent = {
  ticker?: string;
  ticker_sentiment_score?: string;
  ticker_sentiment_label?: string;
};

type AvFeedItem = {
  title?: string;
  url?: string;
  time_published?: string;
  summary?: string;
  banner_image?: string;
  source?: string;
  category_within_source?: string;
  overall_sentiment_score?: string;
  overall_sentiment_label?: string;
  ticker_sentiment?: AvTickerSent[];
};

type AvResponse = {
  feed?: AvFeedItem[];
  items?: AvFeedItem[];
  Information?: string;
  Note?: string;
  "Error Message"?: string;
};

export function createAlphaVantageNewsProvider(): NewsProvider {
  return {
    id: "alpha_vantage",
    name: "Alpha Vantage",
    enabledByDefault: true,
    supportsTickerQuery: true,
    supportsCompanyQuery: false,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      const key = runtime.apiKey?.trim();
      if (!key) {
        return errResult("alpha_vantage", "ALPHA_VANTAGE_API_KEY not configured");
      }
      const ticker = params.ticker.trim().toUpperCase();
      const limit = clampInt(perRequestLimit(params, Math.min(runtime.config.maxResults, 50), 50), 1, 50);

      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", "NEWS_SENTIMENT");
      url.searchParams.set("tickers", ticker);
      url.searchParams.set("apikey", key);
      url.searchParams.set("limit", String(limit));

      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString(), runtime.config.timeoutMs);
      } catch (e) {
        return errResult("alpha_vantage", e instanceof Error ? e.message : "Network error");
      }

      let json: AvResponse;
      try {
        json = (await res.json()) as AvResponse;
      } catch {
        return errResult("alpha_vantage", "Invalid JSON response");
      }

      if (json["Error Message"]) {
        return errResult("alpha_vantage", String(json["Error Message"]));
      }
      if (json.Note?.includes("call frequency") || json.Note?.includes("limit")) {
        return errResult("alpha_vantage", json.Note);
      }
      if (json.Information) {
        return errResult("alpha_vantage", json.Information);
      }

      const feed = Array.isArray(json.feed) ? json.feed : Array.isArray(json.items) ? json.items : [];
      const articles = feed
        .map((row) => mapFeedRow(row, ticker))
        .filter((a): a is NonNullable<typeof a> => a != null);

      return okResult("alpha_vantage", articles, feed.length);
    },
  };
}

function mapFeedRow(row: AvFeedItem, fallbackTicker: string): ReturnType<typeof attachNormalizedUrl> | null {
  const title = row.title?.trim();
  const url = row.url?.trim();
  if (!title || !url) return null;

  const tickers = new Set<string>([fallbackTicker]);
  let sentimentScore: number | null = null;
  let sentimentLabel: string | null = row.overall_sentiment_label?.trim() ?? null;

  if (row.overall_sentiment_score != null && row.overall_sentiment_score !== "") {
    const os = Number.parseFloat(row.overall_sentiment_score);
    if (Number.isFinite(os)) sentimentScore = os;
  }

  const ts = row.ticker_sentiment?.find(
    (t) => (t.ticker ?? "").toUpperCase() === fallbackTicker
  );
  if (ts?.ticker_sentiment_score != null && ts.ticker_sentiment_score !== "") {
    const s = Number.parseFloat(ts.ticker_sentiment_score);
    if (Number.isFinite(s)) sentimentScore = s;
    if (ts.ticker_sentiment_label) sentimentLabel = ts.ticker_sentiment_label;
  }
  for (const t of row.ticker_sentiment ?? []) {
    if (t.ticker) tickers.add(String(t.ticker).toUpperCase());
  }

  const cats = [row.category_within_source, row.source].filter(Boolean) as string[];

  return attachNormalizedUrl({
    id: makeArticleId(url, title),
    title,
    url,
    sourceName: row.source?.trim() || "Alpha Vantage",
    publishedAt: parseAlphaVantageTime(row.time_published ?? null),
    summary: row.summary?.trim() || null,
    imageUrl: row.banner_image?.trim() || null,
    tickers: Array.from(tickers),
    companies: [],
    sentimentScore,
    sentimentLabel,
    providers: ["alpha_vantage"],
    providerIds: { alpha_vantage: url },
    rawCategories: cats.length ? cats : undefined,
    language: "en",
  });
}
