import type { DiscoveryParams, DiscoveryProvider, DiscoveryResult, RawDiscoveryHit } from "../types";
import { fetchWithTimeout } from "../utils";
import { buildDiscoveryQueries } from "./queryBuilder";

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

export function createSerperDiscoveryProvider(apiKey: string, timeoutMs: number): DiscoveryProvider {
  return {
    id: "serper",
    async discover(params: DiscoveryParams): Promise<DiscoveryResult[]> {
      const queries = buildDiscoveryQueries({
        ticker: params.ticker,
        companyName: params.companyName,
        aliases: params.aliases,
      });

      const perQuery = Math.min(10, Math.max(1, Math.ceil(params.maxResults / Math.max(1, queries.length))));

      const settled = await Promise.allSettled(
        queries.map(async (q) => {
          const res = await fetchWithTimeout("https://google.serper.dev/search", timeoutMs, {
            method: "POST",
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q, num: perQuery }),
          });
          const json = (await res.json()) as SerperSearchResponse;
          if (!res.ok) throw new Error(json.message?.trim() || `Serper error ${res.status}`);
          const organic = json.organic ?? [];
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
