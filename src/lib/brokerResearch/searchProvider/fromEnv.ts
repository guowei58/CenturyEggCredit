import { getSearchProviderFromEnv } from "@/lib/ratings-link-search/provider";
import type { BrokerResearchSearchProvider } from "../types";

/**
 * Reuses Google CSE JSON API / SerpApi wiring from ratings-link-search (same env vars).
 * SEARCH_PROVIDER=google|serpapi, GOOGLE_CSE_*, SERPAPI_API_KEY
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
