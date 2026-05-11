import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `phmsa_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const INCIDENTS_URL =
  "https://www.phmsa.dot.gov/data-and-statistics/pipeline/distribution-transmission-gathering-lng-and-liquid-accident-and-incident-data";
const ENFORCEMENT_URL = "https://primis.phmsa.dot.gov/enforcement-documents/";
const PORTAL_URL = "https://portalpublic.phmsa.dot.gov/PDMPublicReport/";

export const phmsaAdapter: RegulatoryAgencyAdapter = {
  sourceId: "phmsa",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Using PHMSA's public incident data, enforcement, and operator-reporting portals." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };
    const retrievedAt = new Date().toISOString();
    const confidence = matchConfidenceFromQuery(q, [q, params.companyName, ...(params.entityNames ?? [])]);
    const results: RegulatorySearchResult[] = [
      {
        result_id: rid(),
        source_id: "phmsa",
        source_name: "PHMSA",
        agency: "PHMSA",
        category: "Pipeline / Hazardous Materials Safety",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: `PHMSA incidents and accidents for "${q}"`,
        record_type: "bulk_data_portal",
        record_subtype: "Incident / accident data",
        description:
          "PHMSA publishes operator-specific incident and accident source files covering gas distribution, transmission, gathering, LNG, and hazardous liquid events.",
        detail_url: INCIDENTS_URL,
        raw_source_url: INCIDENTS_URL,
        raw_json: { kind: "incidents", query: q, state: params.state ?? null },
        confidence,
        importance_score: 70,
        notes: params.state?.trim()
          ? `Use the PHMSA bulk files or portal filters with state ${params.state.trim().toUpperCase()} plus operator name for tighter diligence review.`
          : "Best for incident history, casualties, releases, causes, and operator-specific trend review.",
        retrieved_at: retrievedAt,
        request_url: INCIDENTS_URL,
      },
      {
        result_id: rid(),
        source_id: "phmsa",
        source_name: "PHMSA",
        agency: "PHMSA",
        category: "Pipeline / Hazardous Materials Safety",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: `PHMSA enforcement actions for "${q}"`,
        record_type: "enforcement_portal",
        record_subtype: "Enforcement / compliance",
        description: "PHMSA's enforcement-document site is the best public source for penalty, violation, and case-status review by operator or affiliate.",
        detail_url: ENFORCEMENT_URL,
        raw_source_url: ENFORCEMENT_URL,
        raw_json: { kind: "enforcement", query: q, state: params.state ?? null },
        confidence,
        importance_score: 75,
        notes: "Use this to review corrective action orders, notices of probable violation, consent orders, and civil penalties.",
        retrieved_at: retrievedAt,
        request_url: ENFORCEMENT_URL,
      },
      {
        result_id: rid(),
        source_id: "phmsa",
        source_name: "PHMSA",
        agency: "PHMSA",
        category: "Pipeline / Hazardous Materials Safety",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: `PHMSA public reports portal for "${q}"`,
        record_type: "portal_search",
        record_subtype: "Operator / incident portal",
        description: "PHMSA's public report portal supports operator-name, geography, and report-type exploration when the bulk artifacts need manual narrowing.",
        detail_url: PORTAL_URL,
        raw_source_url: PORTAL_URL,
        raw_json: { kind: "portal", query: q, state: params.state ?? null },
        confidence,
        importance_score: 55,
        notes: "Use the operator name, state, and report family together to narrow large result sets.",
        retrieved_at: retrievedAt,
        request_url: PORTAL_URL,
      },
    ];

    return {
      ok: true,
      requestUrl: PORTAL_URL,
      raw: { query: q, state: params.state ?? null, urls: [INCIDENTS_URL, ENFORCEMENT_URL, PORTAL_URL] },
      results,
      warnings: ["PHMSA still publishes most company-relevant data as bulk files and portals rather than a stable row API, so this tab now points you directly to the highest-value public surfaces."],
    };
  },
};
