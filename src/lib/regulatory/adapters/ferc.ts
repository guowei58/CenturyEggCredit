import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `ferc_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const ELIBRARY_URL = "https://elibrary.ferc.gov/eLibrary/search?searchtype=general";
const CID_LISTING_URL = "https://data.ferc.gov/company-registration/ferc-company-identifier-listing/";
const COMPANY_REG_URL = "https://data.ferc.gov/company-registration/";

export const fercAdapter: RegulatoryAgencyAdapter = {
  sourceId: "ferc",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Using FERC's public company-registration and eLibrary search surfaces." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };
    const retrievedAt = new Date().toISOString();
    const confidence = matchConfidenceFromQuery(q, [q, params.companyName, ...(params.entityNames ?? [])]);
    const results: RegulatorySearchResult[] = [
      {
        result_id: rid(),
        source_id: "ferc",
        source_name: "FERC",
        agency: "FERC",
        category: "Energy / Utility / Pipeline Proceedings",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: `FERC company identifier listing for "${q}"`,
        record_type: "registration_listing",
        record_subtype: "Company registration / CID",
        description:
          "FERC's public company identifier listing is the cleanest place to confirm whether the company or affiliate has registered CIDs across electric, hydropower, natural gas, or oil programs.",
        detail_url: CID_LISTING_URL,
        raw_source_url: CID_LISTING_URL,
        raw_json: { kind: "cid_listing", query: q },
        confidence,
        importance_score: 75,
        notes: "Use this first to confirm the regulated entity name and CID before opening eLibrary or form-specific filings.",
        retrieved_at: retrievedAt,
        request_url: CID_LISTING_URL,
      },
      {
        result_id: rid(),
        source_id: "ferc",
        source_name: "FERC",
        agency: "FERC",
        category: "Energy / Utility / Pipeline Proceedings",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: `FERC eLibrary proceedings for "${q}"`,
        record_type: "portal_search",
        record_subtype: "Proceedings / filings",
        description:
          "FERC eLibrary remains the main public surface for dockets, accessions, orders, tariffs, and participant-submitted PDFs tied to a regulated entity or affiliate.",
        detail_url: ELIBRARY_URL,
        raw_source_url: ELIBRARY_URL,
        raw_json: { kind: "elibrary", query: q },
        confidence,
        importance_score: 70,
        notes: "Search by company name, CID, docket number, or accession once you confirm the registered entity name.",
        retrieved_at: retrievedAt,
        request_url: ELIBRARY_URL,
      },
      {
        result_id: rid(),
        source_id: "ferc",
        source_name: "FERC",
        agency: "FERC",
        category: "Energy / Utility / Pipeline Proceedings",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: `FERC company registration data for "${q}"`,
        record_type: "data_portal",
        record_subtype: "Program registration data",
        description:
          "FERC's company registration data portal provides broader context around regulated-company registration and filing obligations across programs.",
        detail_url: COMPANY_REG_URL,
        raw_source_url: COMPANY_REG_URL,
        raw_json: { kind: "company_registration", query: q },
        confidence,
        importance_score: 60,
        notes: "Useful for understanding how the entity is registered with FERC even when document-level search remains portal-driven.",
        retrieved_at: retrievedAt,
        request_url: COMPANY_REG_URL,
      },
    ];

    return {
      ok: true,
      requestUrl: ELIBRARY_URL,
      raw: { query: q, urls: [CID_LISTING_URL, ELIBRARY_URL, COMPANY_REG_URL] },
      results,
      warnings: ["FERC still does not expose a stable public document-search API comparable to other tabs, so this tab now routes you to the highest-value public registration and proceedings surfaces instead of a single generic handoff."],
    };
  },
};
