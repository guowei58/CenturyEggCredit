export type XSourceProviderId = "recent_search" | "full_archive" | "filtered_stream";

export type XSearchParams = {
  ticker: string;
  companyName?: string;
  aliases?: string[];
  from?: string;
  to?: string;
  limit?: number;
  includeRetweets?: boolean;
  language?: string;
};

export type NormalizedXPost = {
  id: string;
  text: string;
  authorId: string | null;
  authorUsername: string | null;
  authorName: string | null;
  createdAt: string | null;
  url: string;
  language: string | null;
  metrics?: {
    likeCount?: number | null;
    repostCount?: number | null;
    replyCount?: number | null;
    quoteCount?: number | null;
    bookmarkCount?: number | null;
    impressionCount?: number | null;
  };
  cashtags: string[];
  hashtags: string[];
  mentions: string[];
  matchedTicker: string | null;
  matchedCompanyNames: string[];
  matchedAliases: string[];
  matchSignals: string[];
  confidenceScore: number;
  relevanceScore: number;
  sourceProvider: XSourceProviderId;
  isRetweet: boolean;
  isReply: boolean;
  isQuote: boolean;
  conversationId?: string | null;
};

export type XProviderResult = {
  providerId: XSourceProviderId;
  success: boolean;
  posts: NormalizedXPost[];
  countEstimate?: number | null;
  error?: string;
  query?: string;
  queryExplanation?: string;
};

export interface XPostProvider {
  id: XSourceProviderId;
  enabled: boolean;
  search(params: XSearchParams): Promise<XProviderResult>;
}

export type XSearchResponse = {
  ticker: string;
  companyName?: string;
  aliases: string[];
  providerUsed: XSourceProviderId | null;
  query: string | null;
  queryExplanation: string | null;
  countEstimate: number | null;
  warnings: string[];
  rawCount: number;
  finalCount: number;
  posts: NormalizedXPost[];
  error?: string;
};

