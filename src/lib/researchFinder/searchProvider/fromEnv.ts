import { getSearchProviderFromEnv } from "@/lib/ratings-link-search/provider";

export type SearchProvider = {
  id: string;
  search(query: string, opts?: { num?: number }): Promise<Array<{ title: string; url: string; snippet: string; query: string; publishedDate?: string | null }>>;
};

export function getResearchFinderSearchProviderFromEnv():
  | { ok: true; provider: SearchProvider }
  | { ok: false; message: string } {
  const r = getSearchProviderFromEnv();
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: true, provider: { id: r.provider.id, search: (q, o) => r.provider.search(q, o) } };
}

