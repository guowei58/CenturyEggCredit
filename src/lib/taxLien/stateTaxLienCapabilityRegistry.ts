/**
 * Configurable state tax lien / federal NFTL recording capability — drives manual vs automated posture.
 * URLs are intentionally sparse until validated per state; empty official_search_url still queues diligence.
 */

import { ALL_US_STATE_ABBREVIATIONS } from "@/lib/ucc/allUsStates";
import { getStateCapability, UNKNOWN_JURISDICTION_CODE } from "@/lib/ucc/stateCapabilityRegistry";

export type TaxLienSearchLocationHint = "sos" | "dor" | "county" | "centralized" | "unknown";

export type TaxLienAdapterStatus = "not_started" | "in_progress" | "working" | "blocked" | "manual_only";

export type TaxLienTriBool = true | false | "unknown";

export type TaxLienStateCapabilityRecord = {
  state: string;
  state_name: string;
  federal_tax_lien_search_location: TaxLienSearchLocationHint;
  state_tax_lien_search_location: TaxLienSearchLocationHint;
  official_search_url: string;
  county_search_required: TaxLienTriBool;
  supports_name_search: TaxLienTriBool;
  supports_address_search: TaxLienTriBool;
  supports_document_type_filter: TaxLienTriBool;
  bulk_data_available: TaxLienTriBool;
  api_available: TaxLienTriBool;
  requires_login: boolean;
  requires_payment: boolean;
  captcha_likely: TaxLienTriBool;
  automation_allowed: TaxLienTriBool;
  adapter_status: TaxLienAdapterStatus;
  notes: string;
};

function baseRecord(abbr: string): TaxLienStateCapabilityRecord {
  const ucc = getStateCapability(abbr);
  return {
    state: abbr,
    state_name: ucc.state_name,
    federal_tax_lien_search_location: "county",
    state_tax_lien_search_location: "dor",
    official_search_url: "",
    county_search_required: true,
    supports_name_search: "unknown",
    supports_address_search: "unknown",
    supports_document_type_filter: "unknown",
    bulk_data_available: "unknown",
    api_available: "unknown",
    requires_login: false,
    requires_payment: false,
    captcha_likely: "unknown",
    automation_allowed: false,
    adapter_status: "not_started",
    notes:
      "NFTLs are typically recorded with county land records where filed; state DOR may publish tax warrants or centralized business liens. Verify official portals and terms before automation.",
  };
}

const OVERRIDES: Partial<Record<string, Partial<TaxLienStateCapabilityRecord>>> = {
  DE: {
    federal_tax_lien_search_location: "county",
    state_tax_lien_search_location: "dor",
    official_search_url: "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
    county_search_required: true,
    notes: "Delaware — verify Division of Revenue vs recorder indexes for state tax liens; NFTL usually county-recorded.",
  },
};

function buildRegistry(): Record<string, TaxLienStateCapabilityRecord> {
  const out: Record<string, TaxLienStateCapabilityRecord> = {};
  for (const abbr of ALL_US_STATE_ABBREVIATIONS) {
    const row = { ...baseRecord(abbr), ...(OVERRIDES[abbr] ?? {}) };
    out[abbr] = row;
  }
  out[UNKNOWN_JURISDICTION_CODE] = {
    state: UNKNOWN_JURISDICTION_CODE,
    state_name: "Unknown jurisdiction",
    federal_tax_lien_search_location: "unknown",
    state_tax_lien_search_location: "unknown",
    official_search_url: "",
    county_search_required: "unknown",
    supports_name_search: false,
    supports_address_search: false,
    supports_document_type_filter: false,
    bulk_data_available: false,
    api_available: false,
    requires_login: false,
    requires_payment: false,
    captcha_likely: "unknown",
    automation_allowed: false,
    adapter_status: "manual_only",
    notes: "Resolve US formation or recording footprint before tax lien search.",
  };
  return out;
}

export const STATE_TAX_LIEN_CAPABILITY_REGISTRY: Record<string, TaxLienStateCapabilityRecord> = buildRegistry();

export function getTaxLienStateCapability(stateAbbr: string | null | undefined): TaxLienStateCapabilityRecord {
  const k = (stateAbbr ?? "").trim().toUpperCase();
  if (!k) return STATE_TAX_LIEN_CAPABILITY_REGISTRY[UNKNOWN_JURISDICTION_CODE]!;
  return STATE_TAX_LIEN_CAPABILITY_REGISTRY[k] ?? STATE_TAX_LIEN_CAPABILITY_REGISTRY[UNKNOWN_JURISDICTION_CODE]!;
}
