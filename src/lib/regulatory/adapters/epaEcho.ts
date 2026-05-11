import type { EchoFacilityRaw } from "@/lib/env-risk/types";
import { getEnvRiskConfig } from "@/lib/env-risk/config";
import { echoFacilityDetailUrl, echoSearchFacilitiesByName } from "@/lib/env-risk/providers/echo-service";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { Confidence, RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `epa_echo_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function rowToResult(
  query: string,
  row: EchoFacilityRaw,
  retrievedAt: string
): RegulatorySearchResult {
  const name = String(row.FacName ?? "").trim();
  const regId = String(row.RegistryID ?? "").trim();
  const city = String(row.FacCity ?? "").trim();
  const st = String(row.FacState ?? "").trim();
  const street = String(row.FacStreet ?? "").trim();
  const zip = String(row.FacZip ?? "").trim();
  const county = String(row.FacCounty ?? "").trim();
  const compliance = String(row.FacComplianceStatus ?? "").trim();
  const rcra = String(row.RCRAComplianceStatus ?? "").trim();
  const cwa = String(row.CWAComplianceStatus ?? "").trim();
  const caa = String(row.CAAComplianceStatus ?? "").trim();
  const sdwa = String(row.SDWAComplianceStatus ?? "").trim();
  const detailUrl = regId ? echoFacilityDetailUrl(regId) : undefined;
  const mc = matchConfidenceFromQuery(query, [name]);
  const conf: Confidence = mc;

  const statusParts = [compliance || null, rcra || null, cwa || null, caa || null, sdwa || null].filter(Boolean);
  const desc = statusParts.length ? `Program status (where present): ${statusParts.join(" · ")}` : undefined;

  return {
    result_id: rid(),
    source_id: "epa_echo",
    source_name: "EPA ECHO",
    agency: "EPA",
    category: "Environmental / Compliance",
    query_used: query,
    matched_entity: name || query,
    matched_entity_confidence: conf,
    title: name || `Registry ${regId || "—"}`,
    record_type: "facility",
    record_subtype: "All media (facility search)",
    description: desc,
    filing_or_record_date: String(row.FacDateLastInspection ?? "").trim() || undefined,
    status: compliance || undefined,
    state: st || undefined,
    facility_name: name || undefined,
    facility_address: [street, city, st, zip].filter(Boolean).join(", ") || undefined,
    jurisdiction: county ? `${county} County` : undefined,
    agency_identifier: regId || undefined,
    detail_url: detailUrl,
    raw_source_url: detailUrl,
    raw_json: row,
    confidence: conf,
    importance_score: 0,
    retrieved_at: retrievedAt,
    request_url: undefined,
    notes: regId ? `Registry ID: ${regId}` : undefined,
  };
}

export const epaEchoAdapter: RegulatoryAgencyAdapter = {
  sourceId: "epa_echo",
  validateConfig: () => ({
    ok: true,
    mode: "no_key",
    message: "EPA ECHO All Media facility search (public REST: get_facilities / get_qid).",
  }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const cfg = getEnvRiskConfig();
    const state = params.state?.trim().toUpperCase();
    const { facilities, error, requestUrl } = await echoSearchFacilitiesByName(q, cfg, {
      state: state && state.length === 2 ? state : undefined,
    });

    if (error) {
      return {
        ok: false,
        error: error,
        requestUrl: requestUrl || undefined,
        hint: "Documentation: https://echo.epa.gov/tools/web-services",
      };
    }

    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = (facilities ?? []).map((row) => rowToResult(q, row, retrievedAt));

    const warnings: string[] = [];
    if (results.length >= cfg.echoPageSize) {
      warnings.push(`Showing first ${cfg.echoPageSize} facilities (ECHO page size; refine name or add state).`);
    }

    return {
      ok: true,
      requestUrl,
      raw: { facilities, count: results.length },
      results,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
