export type DiscoverySource = "db" | "serpapi_live" | "merged";

export type SubstackPublicationStatus = "active" | "inactive" | "unknown";

export type SubstackPublication = {
  id: string;
  name: string | null;
  subdomain: string | null;
  baseUrl: string;
  feedUrl: string | null;
  isLikelySubstack: boolean;
  detectionMethod: "serpapi" | "manual" | "rss" | "inferred";
  status: SubstackPublicationStatus;
  confidenceScore: number;
  lastDiscoveredAt: string | null;
  lastIngestedAt: string | null;
};

export type SubstackPost = {
  id: string;
  publicationId: string;
  publicationName: string | null;
  title: string;
  url: string;
  normalizedUrl: string;
  publishedAt: string | null;
  author: string | null;
  summary: string | null;
  contentSnippet: string | null;
  tickers: string[];
  companyMentions: string[];
  matchedTerms: string[];
  matchType: "ticker" | "company" | "alias" | "mixed";
  confidenceScore: number;
  source: "rss" | "serpapi";
  discoveredAt: string;
};

export type SubstackSearchResult = {
  post: SubstackPost;
  publication: SubstackPublication | null;
  relevanceScore: number;
  discoverySource: DiscoverySource;
};

export type SubstackSearchRequest = {
  ticker: string;
  companyName?: string;
  aliases?: string[];
  liveDiscovery?: boolean;
  maxResults?: number;
  sortMode?: "relevance" | "recent" | "publication";
  filterMode?: "all" | "indexed_only" | "live_only" | "high_confidence";
};

export type SubstackSearchResponse = {
  ticker: string;
  companyName?: string;
  aliases: string[];
  stats: {
    registryPublications: number;
    publicationsSearched: number;
    indexedMatches: number;
    liveDiscoveryMatches: number;
    newPublicationsFound: number;
    rssIngestedPublications: number;
  };
  results: SubstackSearchResult[];
  error?: string;
};

export type RawDiscoveryHit = {
  title: string;
  url: string;
  snippet: string;
  query: string;
  publishedDate?: string | null;
};

export type DiscoveryParams = {
  ticker: string;
  companyName?: string;
  aliases: string[];
  maxResults: number;
};

export type DiscoveryResult = {
  hit: RawDiscoveryHit;
};

export interface DiscoveryProvider {
  readonly id: string;
  discover(params: DiscoveryParams): Promise<DiscoveryResult[]>;
};

