import type { RawSearchHit, RatingsSearchProvider, SearchProviderId } from "./types";

type SerperOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SerperSearchResponse = {
  organic?: SerperOrganic[];
  message?: string;
};

export function createSerperProvider(apiKey: string): RatingsSearchProvider {
  return {
    id: "serper" as SearchProviderId,
    async search(query: string, opts?: { num?: number }) {
      const num = Math.min(10, Math.max(1, opts?.num ?? 10));
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num }),
        next: { revalidate: 0 },
      });
      const json = (await res.json()) as SerperSearchResponse;
      if (!res.ok) {
        throw new Error(json.message?.trim() || `Serper error ${res.status}`);
      }
      const organic = json.organic ?? [];
      const hits: RawSearchHit[] = [];
      for (const it of organic) {
        const title = it.title?.trim() ?? "";
        const link = it.link?.trim() ?? "";
        const snippet = it.snippet?.trim() ?? "";
        if (!title || !link) continue;
        hits.push({
          title,
          url: link,
          snippet,
          query,
          publishedDate: it.date?.trim() || null,
        });
      }
      return hits;
    },
  };
}
