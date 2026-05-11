import { getEnvRiskConfig } from "@/lib/env-risk/config";
import { echoFacilityDetailUrl } from "@/lib/env-risk/providers/echo-service";
import { frsSearchFacilityNameContains, type FrsSiteRow } from "@/lib/env-risk/providers/envirofacts-frs";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { Confidence, RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `epa_ef_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function rowToResult(query: string, row: FrsSiteRow, retrievedAt: string): RegulatorySearchResult {
  const name = String(row.primary_name ?? "").trim();
  const regId = String(row.registry_id ?? "").trim();
  const city = String(row.city_name ?? "").trim();
  const st = String(row.state_code ?? "").trim();
  const street = String(row.location_address ?? row.std_loc_address ?? "").trim();
  const detailUrl = regId ? echoFacilityDetailUrl(regId) : undefined;
  const conf: Confidence = matchConfidenceFromQuery(query, [name, street, city]);

  return {
    result_id: rid(),
    source_id: "epa_envirofacts",
    source_name: "EPA Envirofacts",
    agency: "EPA",
    category: "Environmental / Facility Data",
    query_used: query,
    matched_entity: name || query,
    matched_entity_confidence: conf,
    title: name || `Registry ${regId || "—"}`,
    record_type: "frs_facility_site",
    record_subtype: "FRS (Facility Registry Service)",
    description: [street, city, st].filter(Boolean).join(", ") || undefined,
    status: undefined,
    state: st || undefined,
    facility_name: name || undefined,
    facility_address: [street, city, st].filter(Boolean).join(", ") || undefined,
    agency_identifier: regId || undefined,
    detail_url: detailUrl,
    raw_source_url: detailUrl,
    raw_json: row,
    confidence: conf,
    importance_score: 0,
    retrieved_at: retrievedAt,
    notes: regId ? `Registry ID: ${regId} · Envirofacts FRS_FACILITY_SITE` : undefined,
  };
}

export const epaEnvirofactsAdapter: RegulatoryAgencyAdapter = {
  sourceId: "epa_envirofacts",
  validateConfig: () => ({
    ok: true,
    mode: "no_key",
    message: "FRS facility site search via Envirofacts Data Service API (data.epa.gov/efservice).",
  }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const cfg = getEnvRiskConfig();
    const state = params.state?.trim().toUpperCase();
    const { rows, error, requestUrl } = await frsSearchFacilityNameContains(q, cfg, cfg.echoPageSize, {
      state: state && state.length === 2 ? state : undefined,
    });

    if (error) {
      return {
        ok: false,
        error,
        requestUrl: requestUrl || undefined,
        hint: "Documentation: https://www.epa.gov/enviro/envirofacts-data-service-api",
      };
    }

    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = rows.map((row) => rowToResult(q, row, retrievedAt));

    const warnings: string[] = [];
    if (results.length >= cfg.echoPageSize) {
      warnings.push(`Showing first ${cfg.echoPageSize} rows (page size; narrow the name or set State).`);
    }

    return {
      ok: true,
      requestUrl,
      raw: { rows, count: results.length },
      results,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
