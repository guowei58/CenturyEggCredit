import { attachNormalizedUrl, makeArticleId } from "../normalize";
import type { NewsProvider, NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";
import { clampInt, parseIsoOrNull } from "../utils";
import { errResult, fetchWithTimeout, okResult, perRequestLimit } from "./base";

type MarketauxEntity = { symbol?: string; name?: string; sentiment_score?: number };
type MarketauxItem = {
  uuid?: string;
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
  image_url?: string;
  published_at?: string;
  source?: string;
  language?: string;
  entities?: MarketauxEntity[];
  relevance_score?: number;
};

type MarketauxResponse = {
  data?: MarketauxItem[];
  meta?: { found?: number };
  error?: { code?: string; message?: string };
};

export function createMarketauxNewsProvider(): NewsProvider {
  return {
    id: "marketaux",
    name: "Marketaux",
    enabledByDefault: true,
    supportsTickerQuery: true,
    supportsCompanyQuery: false,
    async fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult> {
      const key = runtime.apiKey?.trim();
      if (!key) {
        return errResult("marketaux", "MARKETAUX_API_KEY not configured");
      }
      const ticker = params.ticker.trim().toUpperCase();
      const limit = clampInt(perRequestLimit(params, runtime.config.maxResults, 100), 1, 100);
      const url = new URL("https://api.marketaux.com/v1/news/all");
      url.searchParams.set("symbols", ticker);
      url.searchParams.set("api_token", key);
      url.searchParams.set("language", "en");
      url.searchParams.set("limit", String(limit));

      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString(), runtime.config.timeoutMs, {
          headers: {
            Accept: "application/json",
            // Some CDNs return HTML without a normal browser UA.
            "User-Agent": "CenturyEggCredit/1.0 (news aggregation)",
          },
        });
      } catch (e) {
        return errResult("marketaux", e instanceof Error ? e.message : "Network error");
      }

      const text = await res.text();
      let json: MarketauxResponse;
      try {
        json = JSON.parse(text) as MarketauxResponse;
      } catch {
        const hint = text.trim().replace(/\s+/g, " ").slice(0, 200);
        return errResult(
          "marketaux",
          hint.length
            ? `Non-JSON response (HTTP ${res.status}): ${hint}${text.length > 200 ? "…" : ""}`
            : `Empty body (HTTP ${res.status}) — check MARKETAUX_API_KEY and plan limits at marketaux.com`
        );
      }

      if (!res.ok) {
        return errResult("marketaux", json.error?.message ?? `HTTP ${res.status}`);
      }

      const rows = Array.isArray(json.data) ? json.data : [];
      const articles = rows
        .map((row) => mapRow(row, ticker))
        .filter((a): a is NonNullable<typeof a> => a != null);

      return okResult("marketaux", articles, rows.length);
    },
  };
}

function mapRow(row: MarketauxItem, fallbackTicker: string): ReturnType<typeof attachNormalizedUrl> | null {
  const title = row.title?.trim();
  const url = row.url?.trim();
  if (!title || !url) return null;
  const tickers = new Set<string>([fallbackTicker]);
  const companies = new Set<string>();
  for (const e of row.entities ?? []) {
    if (e.symbol) tickers.add(String(e.symbol).toUpperCase());
    if (e.name) companies.add(String(e.name));
  }
  const ent = row.entities?.find((e) => e.symbol?.toUpperCase() === fallbackTicker);
  const sentimentScore =
    ent != null && typeof ent.sentiment_score === "number" ? ent.sentiment_score : null;

  const art = attachNormalizedUrl({
    id: makeArticleId(url, title),
    title,
    url,
    sourceName: row.source?.trim() || "Marketaux",
    publishedAt: parseIsoOrNull(row.published_at ?? null),
    summary: (row.description ?? row.snippet ?? null)?.trim() || null,
    imageUrl: row.image_url?.trim() || null,
    tickers: Array.from(tickers),
    companies: Array.from(companies),
    sentimentScore,
    sentimentLabel: sentimentScore == null ? null : sentimentScore > 0.1 ? "positive" : sentimentScore < -0.1 ? "negative" : "neutral",
    providers: ["marketaux"],
    providerIds: { marketaux: row.uuid ?? url },
    language: row.language ?? null,
  });
  return art;
}
