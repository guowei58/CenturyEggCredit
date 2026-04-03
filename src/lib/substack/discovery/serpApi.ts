import type { DiscoveryParams, DiscoveryProvider, DiscoveryResult, RawDiscoveryHit } from "../types";
import { fetchWithTimeout } from "../utils";
import { buildDiscoveryQueries } from "./queryBuilder";

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

export function createSerpApiDiscoveryProvider(apiKey: string, timeoutMs: number): DiscoveryProvider {
  return {
    id: "serpapi",
    async discover(params: DiscoveryParams): Promise<DiscoveryResult[]> {
      const queries = buildDiscoveryQueries({
        ticker: params.ticker,
        companyName: params.companyName,
        aliases: params.aliases,
      });

      const perQuery = Math.min(10, Math.max(1, Math.ceil(params.maxResults / Math.max(1, queries.length))));

      const settled = await Promise.allSettled(
        queries.map(async (q) => {
          const url = new URL("https://serpapi.com/search.json");
          url.searchParams.set("engine", "google");
          url.searchParams.set("api_key", apiKey);
          url.searchParams.set("q", q);
          url.searchParams.set("num", String(perQuery));
          const res = await fetchWithTimeout(url.toString(), timeoutMs);
          const json = (await res.json()) as SerpResponse;
          if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `SerpApi error ${res.status}`);
          if (json.error) throw new Error(json.error);
          const organic = json.organic_results ?? [];
          const hits: RawDiscoveryHit[] = [];
          for (const it of organic) {
            const title = it.title?.trim() ?? "";
            const link = it.link?.trim() ?? "";
            const snippet = it.snippet?.trim() ?? "";
            if (!title || !link) continue;
            hits.push({
              title,
              url: link,
              snippet,
              query: q,
              publishedDate: it.date?.trim() || null,
            });
          }
          return hits;
        })
      );

      const out: DiscoveryResult[] = [];
      for (const s of settled) {
        if (s.status === "rejected") continue;
        for (const h of s.value) out.push({ hit: h });
      }
      return out.slice(0, params.maxResults);
    },
  };
}

