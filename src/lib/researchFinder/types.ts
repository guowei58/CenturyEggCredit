export type ResearchProviderId = "octus" | "creditsights" | "9fin" | "debtwire" | "wsj_bankruptcy";

export type AccessLevel = "public" | "partially_gated" | "gated";

export type ConfidenceBucket = "high" | "medium" | "low";

export type PageType =
  | "research_report"
  | "article"
  | "insight"
  | "webinar"
  | "event"
  | "podcast"
  | "transcript"
  | "presentation"
  | "resource"
  | "news"
  | "gated_article"
  | "generic_page"
  | "irrelevant";

export type ResearchProfile = {
  ticker: string;
  companyName?: string;
  aliases: string[];
  terms: string[]; // generated search terms
};

export type ResearchSearch = {
  id: string;
  ticker: string;
  company_name: string | null;
  aliases_json: string[];
  providers_json: ResearchProviderId[];
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type ResearchResult = {
  id: string;
  search_id: string;
  provider: ResearchProviderId;
  provider_domain: string;
  ticker: string;
  company_name: string | null;
  matched_alias: string | null;
  url: string;
  normalized_url: string;
  canonical_url: string | null;
  title: string | null;
  page_type: PageType;
  publication_date: string | null;
  snippet: string | null;
  excerpt: string | null;
  query_used: string;
  search_provider_used: string;
  match_score: number;
  confidence_bucket: ConfidenceBucket;
  match_reasons: string[];
  access_level: AccessLevel;
  byline: string | null;
  section_label: string | null;
  is_publicly_accessible: boolean;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ResearchFinderSearchRequest = {
  ticker: string;
  companyName?: string;
  aliases?: string[];
  providers?: ResearchProviderId[];
  maxResults?: number;
};

export type ResearchFinderSearchResponse = {
  disclaimer: string;
  profile: ResearchProfile;
  queriesUsed: Record<ResearchProviderId, string[]>;
  providerStatus: Record<
    ResearchProviderId,
    { ok: boolean; error?: string; candidateUrls: number; kept: number; rssCandidates?: number }
  >;
  summary: {
    candidateUrls: number;
    keptResults: number;
    /** URLs discovered via Google News RSS (before merge/dedupe with search) */
    rssCandidatesTotal?: number;
    byProvider: Record<ResearchProviderId, number>;
    confidence: Record<ConfidenceBucket, number>;
  };
  results: ResearchResult[];
  searchId: string;
  error?: string;
};

