/** Stored JSON payload for `UserDailyNewsBatch.payloadJson`. */

export type DailyNewsSourceType = "WSJ" | "Bloomberg" | "FT" | "trade" | "SEC" | "other";

export type DailyNewsItem = {
  dedupeHash: string;
  ticker: string;
  source: string;
  sourceType: DailyNewsSourceType;
  headline: string;
  url: string;
  publishedAt: string;
  summary: string;
  whyItMatters: string;
};

/** The three trade / industry publications used for Google News `site:` search for this ticker. */
export type DailyNewsIndustryPublication = {
  id: string;
  name: string;
  siteDomain: string;
};

export type DailyNewsTickerBlock = {
  ticker: string;
  companyName: string;
  newSinceLastUpdate: string[];
  /** Resolved from `industry-source-map` (ticker, name, SIC, description, former names, SIC semantic tags). Omitted on older stored digests. */
  industryPublications?: DailyNewsIndustryPublication[];
  companyNews: DailyNewsItem[];
  industryNews: DailyNewsItem[];
  secFilings: DailyNewsItem[];
  whyItMatters: string;
};

export type DailyNewsBatchPayload = {
  v: 1;
  generatedAt: string;
  /** ISO timestamp of latest refresh (same as generatedAt for v1) */
  latestRefreshAt: string;
  tickers: string[];
  watchlistSignature: string;
  topLevelSummary: string;
  summaryByTicker: Record<string, DailyNewsTickerBlock>;
  sourcesUsed: string[];
  fetchErrors: Array<{ source: string; message: string }>;
};
