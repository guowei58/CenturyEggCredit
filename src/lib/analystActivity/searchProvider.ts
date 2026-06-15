import { createSerperProvider } from "@/lib/ratings-link-search/serperProvider";

import type { AnalystActivitySearchProvider } from "./types";

export type SearchProviderConfigError = { code: "missing_env"; message: string };

export function getAnalystActivitySearchProvider():
  | { ok: true; provider: AnalystActivitySearchProvider }
  | { ok: false; error: SearchProviderConfigError } {
  const serperKey = process.env.SERPER_API_KEY?.trim();
  if (serperKey) {
    return { ok: true, provider: createSerperProvider(serperKey) };
  }

  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (braveKey) {
    return { ok: true, provider: createBraveSearchProvider(braveKey) };
  }

  return {
    ok: false,
    error: {
      code: "missing_env",
      message:
        "Analyst activity discovery needs a search provider. Set SERPER_API_KEY or BRAVE_SEARCH_API_KEY in .env.local.",
    },
  };
}

function createBraveSearchProvider(apiKey: string): AnalystActivitySearchProvider {
  return {
    id: "brave",
    async search(query: string, opts?: { num?: number }) {
      const count = Math.min(20, Math.max(1, opts?.num ?? 10));
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        next: { revalidate: 0 },
      });
      if (!res.ok) {
        throw new Error(`Brave Search error ${res.status}`);
      }
      const json = (await res.json()) as {
        web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] };
      };
      return (json.web?.results ?? [])
        .map((r) => ({
          title: r.title?.trim() ?? "",
          url: r.url?.trim() ?? "",
          snippet: r.description?.trim() ?? "",
          query,
          publishedDate: r.age?.trim() || null,
        }))
        .filter((h) => h.title && h.url);
    },
  };
}
