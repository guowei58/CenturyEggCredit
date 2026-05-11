export type RegulatoryAccessType = "api" | "bulk_data" | "search_portal" | "manual";

export type AdapterStatus = "working" | "partial" | "not_started" | "manual_only";

export type Priority = "high" | "medium" | "low";

export type RegulatorySourceRegistryEntry = {
  source_id: string;
  display_name: string;
  agency: string;
  category: string;
  access_type: RegulatoryAccessType;
  base_url: string;
  api_docs_url?: string;
  requires_api_key: boolean;
  env_key_name?: string;
  supports_company_search: boolean;
  supports_entity_search: boolean;
  supports_address_search: boolean;
  supports_facility_search: boolean;
  supports_document_download: boolean;
  supports_date_filter: boolean;
  supports_docket_filter: boolean;
  supports_state_filter: boolean;
  supports_naics_sic_filter: boolean;
  default_page_size: number;
  rate_limit_notes?: string;
  adapter_status: AdapterStatus;
  priority: Priority;
  notes?: string;
};

export type RegulatorySearchParams = {
  query: string;
  companyName?: string;
  entityNames?: string[];
  ticker?: string;
  cik?: string;
  address?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  exactMatch?: boolean;
  includeSubsidiaries?: boolean;
  deepSearch?: boolean;
  filters?: Record<string, unknown>;
  saveRawResults?: boolean;
};

export type Confidence = "High" | "Medium" | "Low";

export type RegulatorySearchResult = {
  result_id: string;
  source_id: string;
  source_name: string;
  agency: string;
  category: string;
  query_used: string;
  matched_entity: string;
  matched_entity_confidence: Confidence;
  title: string;
  record_type: string;
  record_subtype?: string;
  description?: string;
  filing_or_record_date?: string;
  effective_date?: string;
  last_updated?: string;
  status?: string;
  jurisdiction?: string;
  state?: string;
  facility_name?: string;
  facility_address?: string;
  docket_number?: string;
  permit_number?: string;
  case_number?: string;
  agency_identifier?: string;
  document_url?: string;
  detail_url?: string;
  download_url?: string;
  raw_source_url?: string;
  source_quote?: string;
  raw_json: unknown;
  confidence: Confidence;
  importance_score: number;
  notes?: string;
  retrieved_at: string;
  request_url?: string;
  raw_storage_path?: string;
};

export type RegulatoryAdapterConfigStatus =
  | { ok: true; mode: "api_key" | "no_key" | "manual"; message?: string }
  | { ok: false; mode: "missing_key"; message: string; envKeyName?: string };

export interface RegulatoryAgencyAdapter {
  sourceId: string;
  validateConfig: () => RegulatoryAdapterConfigStatus;
  search: (params: RegulatorySearchParams) => Promise<{
    ok: true;
    requestUrl?: string;
    raw: unknown;
    results: RegulatorySearchResult[];
    warnings?: string[];
  } | {
    ok: false;
    error: string;
    hint?: string;
    requestUrl?: string;
    raw?: unknown;
  }>;
};

