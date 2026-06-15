/** Sell-side analyst activity metadata — no full report bodies. */

export type AnalystActionType =
  | "initiated_coverage"
  | "upgraded"
  | "downgraded"
  | "reiterated"
  | "maintained"
  | "resumed_coverage"
  | "coverage_dropped"
  | "price_target_raised"
  | "price_target_lowered"
  | "price_target_changed"
  | "estimate_revision"
  | "unknown";

export type RatingBucket = "bullish" | "neutral" | "bearish" | "unknown";

export type SourceType =
  | "search_discovery"
  | "company_ir_coverage"
  | "finnhub_api"
  | "fmp_api"
  | "alphavantage_api"
  | "yahoo_public"
  | "marketbeat"
  | "marketwatch"
  | "investing"
  | "briefing";

export type AnalystActivityEvent = {
  id: string;
  ticker: string;
  companyName: string | null;
  eventDate: string | null;
  broker: string;
  analystName: string | null;
  actionType: AnalystActionType;
  ratingPrior: string | null;
  ratingCurrent: string | null;
  ratingBucketPrior: RatingBucket;
  ratingBucketCurrent: RatingBucket;
  priceTargetPrior: number | null;
  priceTargetCurrent: number | null;
  currency: string | null;
  headline: string;
  snippet: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceType: SourceType;
  retrievedAt: string;
  confidenceScore: number;
  probableReportExists: boolean;
  dedupeKey: string;
  secondarySourceUrls?: string[];
};

export type AnalystCoverageRecord = {
  id: string;
  ticker: string;
  companyName: string | null;
  broker: string;
  analystName: string | null;
  analystEmail: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceType: "company_ir_coverage" | "search_discovery";
  retrievedAt: string;
  confidenceScore: number;
};

export type SourceAttemptLog = {
  sourceId: string;
  sourceName: string;
  status: "success" | "failed" | "skipped" | "blocked";
  message?: string;
  rawCount: number;
  normalizedCount: number;
};

export type BrokerActivitySummary = {
  activeCoveringBrokers: number;
  eventsLast30Days: number;
  eventsLast90Days: number;
  eventsLast180Days: number;
  eventsLast365Days: number;
  upgradeCount: number;
  downgradeCount: number;
  initiationCount: number;
  priceTargetRaiseCount: number;
  priceTargetCutCount: number;
  latestActivityDate: string | null;
  avgPriceTarget: number | null;
  highPriceTarget: number | null;
  lowPriceTarget: number | null;
  staleCoverageWarning: boolean;
};

export type AnalystActivityResponse = {
  ticker: string;
  companyName?: string;
  events: AnalystActivityEvent[];
  coverage: AnalystCoverageRecord[];
  summary: BrokerActivitySummary;
  sourceLogs: SourceAttemptLog[];
  retrievedAt: string;
  error?: string;
};

export type AnalystActivityRequest = {
  ticker: string;
  companyName?: string;
  aliases?: string[];
};

export type RawSearchHit = {
  title: string;
  url: string;
  snippet: string;
  query: string;
  publishedDate?: string | null;
};

export interface AnalystActivitySearchProvider {
  readonly id: string;
  search(query: string, options?: { num?: number }): Promise<RawSearchHit[]>;
}

export type SourceAdapterContext = {
  ticker: string;
  companyName?: string;
  aliases?: string[];
  search?: AnalystActivitySearchProvider;
  retrievedAt: string;
};

export type SourceAdapterResult = {
  events: AnalystActivityEvent[];
  coverage: AnalystCoverageRecord[];
  log: SourceAttemptLog;
};

export interface AnalystActivitySourceAdapter {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  fetch(ctx: SourceAdapterContext): Promise<SourceAdapterResult>;
}
