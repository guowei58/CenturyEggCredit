/**
 * Broker research discovery — metadata and links only; no report body ingestion.
 */

export type BrokerReportType =
  | "initiation"
  | "upgrade"
  | "downgrade"
  | "rating_change"
  | "target_price_change"
  | "earnings_preview"
  | "earnings_recap"
  | "company_update"
  | "sector_note"
  | "thematic_note"
  | "research_portal"
  | "public_insight"
  | "research_landing_page"
  | "unknown";

export type BrokerAccessLevel = "public" | "login_required" | "subscription_likely" | "unknown";

export interface BrokerDefinition {
  id: string;
  name: string;
  enabledByDefault: boolean;
  /** Primary hostnames for site: queries and URL filtering (no protocol). */
  domains: string[];
  /** Extra firm names / brands to strengthen queries. */
  aliases: string[];
  /** Short tokens appended to some query variants (e.g. firm brand). */
  searchPatterns: string[];
  /** Optional path or URL substring hints for classification. */
  urlHints?: string[];
}

export type BrokerResearchResult = {
  id: string;
  brokerId: string;
  brokerName: string;
  title: string;
  url: string;
  normalizedUrl?: string;
  snippet: string | null;
  publishedAt: string | null;
  companyName: string | null;
  ticker: string | null;
  matchedTickers: string[];
  matchedCompanies: string[];
  reportType: BrokerReportType;
  accessLevel: BrokerAccessLevel;
  relevanceScore: number;
  confidenceScore: number;
  searchQuery: string;
  searchProvider: string;
  rawSourceDomain: string;
  supportingSignals: string[];
};

export type BrokerResearchRequest = {
  ticker: string;
  companyName?: string;
  aliases?: string[];
  from?: string;
  to?: string;
  enabledBrokers?: string[];
  maxResults?: number;
};

export type BrokerResearchResponse = {
  ticker: string;
  companyName?: string;
  aliases: string[];
  activeBrokers: string[];
  skippedBrokers: string[];
  queryCount: number;
  resultsBeforeDedupe: number;
  resultsAfterDedupe: number;
  brokerStats: Record<
    string,
    {
      queryCount: number;
      resultCount: number;
      success: boolean;
      error?: string;
    }
  >;
  reports: BrokerResearchResult[];
  error?: string;
};

export type RawSearchHit = {
  title: string;
  url: string;
  snippet: string;
  query: string;
  publishedDate?: string | null;
};

/** Web search via Serper (no HTML scraping). */
export interface BrokerResearchSearchProvider {
  readonly id: string;
  search(query: string, options?: { num?: number }): Promise<RawSearchHit[]>;
}
