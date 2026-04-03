import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { clampInt, unixSecondsToIso } from "../utils";
import { errResult, fetchWithTimeout, okResult, perRequestLimit } from "./base";

type FinnhubItem = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function createFinnhubNewsProvider(): NewsProvider {
  return {
    id: "finnhub",
    name: "Finnhub",
    enabledByDefault: true,
    supportsTickerQuery: true,
    supportsCompanyQuery: false,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      const key = runtime.apiKey?.trim();
      if (!key) {
        return errResult("finnhub", "FINNHUB_API_KEY not configured");
      }
      const ticker = params.ticker.trim().toUpperCase();
      const max = clampInt(perRequestLimit(params, runtime.config.maxResults, 100), 1, 100);
      const { from, to } =
        params.from && params.to
          ? { from: params.from.slice(0, 10), to: params.to.slice(0, 10) }
          : defaultRange();

      const url = new URL("https://finnhub.io/api/v1/company-news");
      url.searchParams.set("symbol", ticker);
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
      url.searchParams.set("token", key);

      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString(), runtime.config.timeoutMs);
      } catch (e) {
        return errResult("finnhub", e instanceof Error ? e.message : "Network error");
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return errResult("finnhub", "Invalid JSON response");
      }

      if (!res.ok) {
        return errResult("finnhub", `HTTP ${res.status}`);
      }

      if (!Array.isArray(json)) {
        const msg =
          json && typeof json === "object" && "error" in json
            ? String((json as { error: string }).error)
            : "Unexpected Finnhub response";
        return errResult("finnhub", msg);
      }

      const rows = json as FinnhubItem[];
      const sliced = rows.slice(0, max);
      const articles = sliced
        .map((row) => mapRow(row, ticker))
        .filter((a): a is NonNullable<typeof a> => a != null);

      return okResult("finnhub", articles, rows.length);
    },
  };
}

function mapRow(row: FinnhubItem, fallbackTicker: string): ReturnType<typeof attachNormalizedUrl> | null {
  const title = row.headline?.trim();
  const url = row.url?.trim();
  if (!title || !url) return null;
  const tickers = new Set<string>([fallbackTicker]);
  if (row.related) {
    for (const p of row.related.split(",")) {
      const x = p.trim().toUpperCase();
      if (x) tickers.add(x);
    }
  }
  const cats = row.category ? [row.category] : [];

  return attachNormalizedUrl({
    id: makeArticleId(url, title),
    title,
    url,
    sourceName: row.source?.trim() || "Finnhub",
    publishedAt: unixSecondsToIso(row.datetime),
    summary: row.summary?.trim() || null,
    imageUrl: row.image?.trim() || null,
    tickers: Array.from(tickers),
    companies: [],
    sentimentScore: null,
    sentimentLabel: null,
    providers: ["finnhub"],
    providerIds: row.id != null ? { finnhub: String(row.id) } : { finnhub: url },
    rawCategories: cats.length ? cats : undefined,
    language: "en",
  });
}
