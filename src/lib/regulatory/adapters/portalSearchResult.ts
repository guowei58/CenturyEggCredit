import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type PortalSearchConfig = {
  sourceId: string;
  sourceName: string;
  agency: string;
  category: string;
  detailUrl: (query: string) => string;
  description: string;
  warning?: string;
};

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function portalSearchResultAdapter(config: PortalSearchConfig): RegulatoryAgencyAdapter {
  return {
    sourceId: config.sourceId,
    validateConfig: () => ({ ok: true, mode: "manual", message: `Using ${config.sourceName} portal search handoff.` }),
    search: async (params: RegulatorySearchParams) => {
      const q = params.query?.trim();
      if (!q) return { ok: false, error: "Search query required." };
      const detailUrl = config.detailUrl(q);
      const confidence = matchConfidenceFromQuery(q, [q]);
      const retrievedAt = new Date().toISOString();
      const results: RegulatorySearchResult[] = [
        {
          result_id: rid(config.sourceId),
          source_id: config.sourceId,
          source_name: config.sourceName,
          agency: config.agency,
          category: config.category,
          query_used: q,
          matched_entity: q,
          matched_entity_confidence: confidence,
          title: `${config.sourceName} search for "${q}"`,
          record_type: "portal_search",
          description: config.description,
          detail_url: detailUrl,
          raw_source_url: detailUrl,
          raw_json: { query: q, detailUrl },
          confidence,
          importance_score: 20,
          retrieved_at: retrievedAt,
          request_url: detailUrl,
        },
      ];

      return {
        ok: true,
        requestUrl: detailUrl,
        raw: { query: q, detailUrl },
        results,
        warnings: config.warning ? [config.warning] : undefined,
      };
    },
  };
}
