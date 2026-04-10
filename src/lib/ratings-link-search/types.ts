export type RatingsAgency = "Fitch" | "Moody's" | "S&P";

export type RatingsResultType =
  | "issuer_rating"
  | "issue_rating"
  | "rating_action"
  | "research"
  | "commentary"
  | "unknown";

export type AccessLevel = "public" | "login_required" | "subscription_likely" | "unknown";

export interface NormalizedRatingsLink {
  id: string;
  agency: RatingsAgency;
  title: string;
  url: string;
  snippet: string;
  query: string;
  sourceDomain: string;
  resultType: RatingsResultType;
  companyMatchScore: number;
  instrumentHints: string[];
  accessLevel: AccessLevel;
  publishedDate: string | null;
}

export interface RatingsLinkSearchContext {
  ticker: string;
  companyName: string;
  aliases: string[];
}

export interface RawSearchHit {
  title: string;
  url: string;
  snippet: string;
  query: string;
  publishedDate?: string | null;
}

export type SearchProviderId = "serper";

export interface RatingsSearchProvider {
  readonly id: SearchProviderId;
  search(query: string, opts?: { num?: number }): Promise<RawSearchHit[]>;
}

export interface DiscoverRatingsLinksInput {
  ticker: string;
  companyName?: string;
  aliases?: string[];
}

export interface DiscoverRatingsLinksOutput {
  company: {
    ticker: string;
    companyName: string;
    aliases: string[];
  };
  results: NormalizedRatingsLink[];
  queriesRun: string[];
}
