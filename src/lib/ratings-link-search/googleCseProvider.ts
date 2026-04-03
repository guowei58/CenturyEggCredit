import type { RawSearchHit, RatingsSearchProvider, SearchProviderId } from "./types";

type GoogleCseItem = {
  title?: string;
  link?: string;
  snippet?: string;
  pagemap?: { metatags?: Record<string, string>[] };
};

type GoogleCseResponse = {
  items?: GoogleCseItem[];
  error?: { message?: string };
};

function extractDate(meta: Record<string, string> | undefined): string | null {
  if (!meta) return null;
  const keys = [
    "article:published_time",
    "datepublished",
    "pubdate",
    "og:updated_time",
    "date",
  ];
  for (const k of keys) {
    const v = meta[k];
    if (v && typeof v === "string") return v;
  }
  return null;
}

export function createGoogleCseProvider(apiKey: string, cx: string): RatingsSearchProvider {
  return {
    id: "google" as SearchProviderId,
    async search(query: string, opts?: { num?: number }) {
      const num = Math.min(10, Math.max(1, opts?.num ?? 10));
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(num));

      const res = await fetch(url.toString(), { next: { revalidate: 0 } });
      const json = (await res.json()) as GoogleCseResponse;
      if (!res.ok) {
        throw new Error(json.error?.message ?? `Google CSE error ${res.status}`);
      }
      const items = json.items ?? [];
      const hits: RawSearchHit[] = [];
      for (const it of items) {
        const title = it.title?.trim() ?? "";
        const link = it.link?.trim() ?? "";
        const snippet = it.snippet?.trim() ?? "";
        if (!title || !link) continue;
        const metas = it.pagemap?.metatags?.[0];
        hits.push({
          title,
          url: link,
          snippet,
          query,
          publishedDate: extractDate(metas),
        });
      }
      return hits;
    },
  };
}
