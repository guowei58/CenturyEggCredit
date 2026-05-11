import type { RegulatoryAgencyAdapter, RegulatorySearchParams } from "@/lib/regulatory/types";
import { getRegulatorySource } from "@/lib/regulatory/registry";

export function manualOnlyAdapter(sourceId: string): RegulatoryAgencyAdapter {
  return {
    sourceId,
    validateConfig: () => ({ ok: true, mode: "manual", message: "Manual / portal source (not automated yet)." }),
    search: async (_params: RegulatorySearchParams) => {
      const src = getRegulatorySource(sourceId);
      return {
        ok: false,
        error: "This source is not automated yet.",
        hint: src?.api_docs_url || src?.base_url ? `Use the source portal: ${src.api_docs_url ?? src.base_url}` : undefined,
      };
    },
  };
}

