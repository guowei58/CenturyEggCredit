import type { RawSearchHit, RatingsSearchProvider, SearchProviderId } from "./types";

type SerpOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SerpResponse = {
  organic_results?: SerpOrganic[];
  error?: string;
};

export function createSerpApiProvider(apiKey: string): RatingsSearchProvider {
  return {
    id: "serpapi" as SearchProviderId,
    async search(query: string, opts?: { num?: number }) {
      const num = Math.min(10, Math.max(1, opts?.num ?? 10));
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(num));

      const res = await fetch(url.toString(), { next: { revalidate: 0 } });
      const json = (await res.json()) as SerpResponse;
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `SerpApi error ${res.status}`);
      }
      if (json.error) throw new Error(json.error);

      const organic = json.organic_results ?? [];
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
