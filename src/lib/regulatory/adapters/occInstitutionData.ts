import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `occ_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function occSearchUrl(q: string): string {
  return `https://www.occ.gov/institution-search/list?q=${encodeURIComponent(q)}`;
}

export const occInstitutionDataAdapter: RegulatoryAgencyAdapter = {
  sourceId: "occ_institution_data",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Searching OCC-regulated institution autocomplete." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const url = new URL(`https://apps.occ.gov/Occ.DataServices.WebApi.Public/api/Institutions/AutoComplete/${encodeURIComponent(q)}`);
    const res = await fetch(url.toString(), { cache: "no-store", headers: { accept: "application/json" } });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: `OCC institution lookup failed (HTTP ${res.status}).`,
        requestUrl: url.toString(),
        raw,
      };
    }

    const rows = Array.isArray(raw) ? raw : [];
    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = rows.map((value) => {
      const name = String(value ?? "").trim();
      const confidence = matchConfidenceFromQuery(q, [name]);
      const detailUrl = occSearchUrl(name || q);

      return {
        result_id: rid(),
        source_id: "occ_institution_data",
        source_name: "OCC Institution Data",
        agency: "OCC",
        category: "Banks / OCC-Regulated Institutions / Enforcement",
        query_used: q,
        matched_entity: name || q,
        matched_entity_confidence: confidence,
        title: name || "OCC-regulated institution",
        record_type: "institution_match",
        description: "Autocomplete match from OCC's financial institution search.",
        detail_url: detailUrl,
        raw_source_url: detailUrl,
        raw_json: value,
        confidence,
        importance_score: confidence === "High" ? 75 : confidence === "Medium" ? 50 : 20,
        retrieved_at: retrievedAt,
        request_url: url.toString(),
      };
    });

    return {
      ok: true,
      requestUrl: url.toString(),
      raw,
      results,
      warnings:
        results.length === 0
          ? ["No OCC-regulated institution matches were returned. This source only covers OCC-supervised banks/savings associations."]
          : undefined,
    };
  },
};
