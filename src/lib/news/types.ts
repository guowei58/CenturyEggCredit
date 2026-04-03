/**
 * Shared news aggregation types — providers map into NormalizedNewsArticle only.
 */

export type NewsQueryParams = {
  ticker: string;
  companyName?: string;
  from?: string;
  to?: string;
  limit?: number;
  enabledProviders?: string[];
};

export type NormalizedNewsArticle = {
  id: string;
  title: string;
  url: string;
  normalizedUrl?: string;
  sourceName: string;
  publishedAt: string | null;
  summary: string | null;
  imageUrl: string | null;
  tickers: string[];
  companies: string[];
  sentimentScore: number | null;
  sentimentLabel: string | null;
  providers: string[];
  providerIds?: Record<string, string>;
  rawCategories?: string[];
  language?: string | null;
  /** Internal: best provider priority among sources (lower = higher priority). */
  _bestProviderPriority?: number;
};

export type ProviderFetchResult = {
  providerId: string;
  success: boolean;
  articles: NormalizedNewsArticle[];
  error?: string;
  rawCount?: number;
};

export type ProviderConfig = {
  id: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  maxResults: number;
};

export interface NewsProvider {
  id: string;
  name: string;
  enabledByDefault: boolean;
  supportsTickerQuery: boolean;
  supportsCompanyQuery: boolean;
  fetchNews(params: NewsQueryParams, runtime: ProviderRuntimeContext): Promise<ProviderFetchResult>;
}

export type ProviderRuntimeContext = {
  config: ProviderConfig;
  apiKey: string | undefined;
};

export type ProviderRegistryEntry = {
  id: string;
  displayName: string;
  /** Read API key from env (never exposed to client). */
  getApiKey: () => string | undefined;
  create: (ctx: ProviderRuntimeContext) => NewsProvider;
};

export type NewsAggregationResponse = {
  ticker: string;
  companyName?: string;
  activeProviders: string[];
  disabledProviders: string[];
  providerStats: Record<
    string,
    {
      success: boolean;
      count: number;
      error?: string;
    }
  >;
  totalBeforeDedupe: number;
  totalAfterDedupe: number;
  articles: NormalizedNewsArticle[];
};
