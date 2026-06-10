/** Source adapter that produced a presentation file candidate. */
export type PresentationSourceType = "sec_exhibit" | "live_ir" | "q4_ir" | "wayback" | "web_search";

export type PresentationFileType = "pdf" | "ppt" | "pptx";

export type PresentationReviewStatus = "auto_accept" | "review" | "reject";

/** Raw or validated candidate for an earnings / investor presentation deck. */
export type PresentationCandidate = {
  ticker: string;
  cik: string;
  company_name: string;
  period: string;
  document_date: string | null;
  title: string;
  url: string;
  source_page_url: string;
  source_type: PresentationSourceType;
  file_type: PresentationFileType;
  confidence: number;
  evidence: string[];
  sha256: string | null;
  page_count: number | null;
  text_sample: string | null;
};

export type PresentationDiscoveryInput = {
  ticker: string;
  cik: string;
  companyName: string;
  /** Display token, e.g. `Q3 2025` or `2025Q3`. */
  period: string;
  earningsDate?: string | null;
  reportDate?: string | null;
};

export type ValidatedPresentationCandidate = PresentationCandidate & {
  review_status: PresentationReviewStatus;
  validation: PresentationValidationResult;
};

export type PresentationValidationResult = {
  downloaded: boolean;
  company_name_match: boolean;
  document_type:
    | "investor_presentation"
    | "earnings_deck"
    | "press_release"
    | "earnings_transcript"
    | "other"
    | "unknown";
  period_match: boolean;
  inferred_period: string | null;
  inferred_document_date: string | null;
  keyword_hits: string[];
  llm?: {
    is_presentation: boolean;
    period_match: boolean;
    confidence_adjustment: number;
    rationale: string;
  };
  reject_reason?: string;
};

export type PresentationDiscoveryMetadata = {
  discoveredAt: string;
  input: PresentationDiscoveryInput;
  candidatesConsidered: number;
  candidatesValidated: number;
  allCandidates: ValidatedPresentationCandidate[];
  irDomains: string[];
  adapterCounts: Record<PresentationSourceType, number>;
};

export type PresentationDiscoveryResult = {
  ok: boolean;
  best: ValidatedPresentationCandidate | null;
  metadata: PresentationDiscoveryMetadata;
  savedDocument?: {
    filename: string;
    openUrl: string;
    bytes: number;
  };
  metaFilename?: string;
  error?: string;
};

/** Lightweight candidate before download / validation. */
export type RawPresentationLink = {
  url: string;
  title: string;
  source_page_url: string;
  source_type: PresentationSourceType;
  file_type: PresentationFileType;
  document_date: string | null;
  pre_score: number;
  evidence: string[];
};

export type PresentationAdapter = {
  name: PresentationSourceType;
  discover(input: PresentationDiscoveryInput, ctx: PresentationAdapterContext): Promise<RawPresentationLink[]>;
};

export type PresentationAdapterContext = {
  anchorDate: string;
  irDomains: string[];
  cdnDomains: string[];
};
