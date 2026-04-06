/**
 * Normalized types for the environmental risk research workflow (SEC + federal EPA).
 */

export type MatchConfidence = "high" | "medium" | "low" | "unresolved";

export type FacilityOverrideStatus = "confirmed" | "rejected" | "none";

export type EnvTopic =
  | "environmental_liability"
  | "remediation_reserve"
  | "aro"
  | "legal_environmental"
  | "permitting"
  | "emissions_climate"
  | "water_waste"
  | "capex_environmental"
  | "superfund_cercla"
  | "rcra_hazwaste"
  | "pfas"
  | "asbestos"
  | "groundwater"
  | "spill_release"
  | "other";

export type DisclosureRow = {
  source_document: string;
  filing_date: string;
  form: string;
  accession_number: string;
  section_name: string;
  topic: EnvTopic;
  extracted_text: string;
  extracted_amount: string | null;
  facility_reference: string | null;
  confidence_score: number;
  sec_url: string | null;
};

export type FilingExtractionSummary = {
  accession_number: string;
  form: string;
  filing_date: string;
  primary_document: string;
  doc_url: string;
  snippet_count: number;
  topics: EnvTopic[];
  content_hash: string;
};

export type CrossPeriodNote = {
  kind: "new_language" | "removed_language" | "reserve_change" | "legal_change" | "tone";
  description: string;
  filing_dates: string[];
  evidence: string;
};

export type CanonicalEnvProfile = {
  ticker: string;
  parent_name: string;
  cik: string | null;
  sic_description: string | null;
  state_of_incorporation: string | null;
  legal_entity_names: string[];
  subsidiary_names: string[];
  trade_name_hints: string[];
  facility_name_hints: string[];
  operating_states_hint: string[];
  sources: string[];
};

export type ResolvedFacility = {
  id: string;
  registry_id: string | null;
  facility_name: string;
  state: string | null;
  city: string | null;
  address_line: string | null;
  matched_entity: string;
  match_confidence: MatchConfidence;
  match_score: number;
  business_segment: string | null;
  source: "frs" | "echo" | "merged";
  compliance_flags: string[];
  enforcement_flags: string[];
  emissions_flags: string[];
  waste_flags: string[];
  echo_detail_url: string | null;
  raw_echo: Record<string, string | null> | null;
  override_status: FacilityOverrideStatus;
};

export type StateFollowUpRow = {
  state: string;
  facility_count: number;
  rationale: string;
  priority: "high" | "medium" | "low";
  future_connector: string;
};

export type RiskSubScores = {
  disclosure_risk: number;
  compliance_risk: number;
  enforcement_risk: number;
  emissions_release_risk: number;
  waste_cleanup_risk: number;
  permit_operational_risk: number;
  data_confidence: number;
};

export type RiskScoreResult = RiskSubScores & {
  overall_environmental_risk: number;
  rationale: string[];
};

export type HotspotRow = {
  risk_area: string;
  evidence: string;
  affected_facilities_or_entities: string;
  severity: "high" | "medium" | "low";
  what_to_monitor: string;
};

export type EnvRiskTrends = {
  filings_with_env_hits_by_year: Record<string, number>;
  facility_count_by_state: Record<string, number>;
  echo_flag_counts: {
    significant_violation: number;
    formal_action_recent: number;
    tri_flag: number;
    air_flag: number;
  };
};

export type NarrativeMemo = {
  bottom_line: string;
  what_company_discloses: string;
  what_regulatory_data_shows: string;
  where_main_risk_sits: string;
  hidden_liabilities_capex: string;
  facilities_states_to_monitor: string;
  benign_or_low_risk: string;
  open_questions: string;
};

export type SourceRef = {
  source_type: "sec_filing" | "echo" | "envirofacts_frs" | "internal_cache" | "note";
  label: string;
  url: string | null;
  retrieved_at_iso: string;
};

export type MonitoringSignals = {
  new_env_language_in_latest_filing: boolean;
  new_facility_matches: number;
  material_score_change: boolean;
  new_enforcement_flags: number;
  notes: string[];
};

export type EnvRiskSnapshot = {
  version: 1;
  ticker: string;
  generated_at_iso: string;
  last_refreshed_iso: string;
  config_flags: {
    echo: boolean;
    envirofacts: boolean;
    rcra: boolean;
    state_connectors: boolean;
  };
  profile: CanonicalEnvProfile;
  disclosure_rows: DisclosureRow[];
  filing_summaries: FilingExtractionSummary[];
  cross_period: CrossPeriodNote[];
  facilities: ResolvedFacility[];
  state_follow_up: StateFollowUpRow[];
  scores: RiskScoreResult;
  hotspots: HotspotRow[];
  trends: EnvRiskTrends;
  narrative: NarrativeMemo;
  sources: SourceRef[];
  monitoring: MonitoringSignals;
  errors: string[];
  pipeline_notes: string[];
};

export type FacilityOverridesFile = {
  confirmed_registry_ids: string[];
  rejected_registry_ids: string[];
};

export type EchoFacilityRaw = Record<string, string | null>;
