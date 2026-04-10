import { getSearchProviderFromEnv } from "@/lib/ratings-link-search/provider";
import type { BrokerResearchSearchProvider } from "../types";

/**
 * Reuses Serper wiring from ratings-link-search (SERPER_API_KEY).
 */
export function getBrokerResearchSearchProviderFromEnv():
  | { ok: true; provider: BrokerResearchSearchProvider }
  | { ok: false; message: string } {
  const r = getSearchProviderFromEnv();
  if (!r.ok) {
    return { ok: false, message: r.error.message };
  }
  const p = r.provider;
  return {
    ok: true,
    provider: {
      id: p.id,
      search: (query, opts) => p.search(query, opts),
    },
  };
}
