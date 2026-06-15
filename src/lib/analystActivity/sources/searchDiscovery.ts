import { getSourceConfig } from "../config";
import { hitToAnalystEvent } from "../eventBuilder";
import { buildAnalystActivityQueries } from "../searchQueries";
import type { AnalystActivitySourceAdapter, SourceAdapterContext, SourceAdapterResult, SourceAttemptLog } from "../types";

export function createSearchDiscoveryAdapter(): AnalystActivitySourceAdapter {
  return {
    id: "search_discovery",
    name: "Public analyst action search",
    isEnabled() {
      return getSourceConfig().searchDiscovery;
    },
    async fetch(ctx: SourceAdapterContext): Promise<SourceAdapterResult> {
      const log: SourceAttemptLog = {
        sourceId: "search_discovery",
        sourceName: "Public analyst action search",
        status: "skipped",
        rawCount: 0,
        normalizedCount: 0,
      };

      if (!this.isEnabled()) {
        log.message = "Disabled in config";
        return { events: [], coverage: [], log };
      }
      if (!ctx.search) {
        log.message = "No search provider configured";
        return { events: [], coverage: [], log };
      }

      const queries = buildAnalystActivityQueries(ctx.ticker, ctx.companyName);
      const seenUrls = new Set<string>();
      const rawHits = [];

      try {
        for (const query of queries) {
          const hits = await ctx.search.search(query, { num: 8 });
          for (const hit of hits) {
            if (seenUrls.has(hit.url)) continue;
            seenUrls.add(hit.url);
            rawHits.push(hit);
          }
        }
        log.rawCount = rawHits.length;

        const events = rawHits
          .map((hit) =>
            hitToAnalystEvent(hit, ctx.ticker, ctx.companyName ?? null, ctx.retrievedAt)
          )
          .filter((e): e is NonNullable<typeof e> => e != null);

        log.normalizedCount = events.length;
        log.status = "success";
        return { events, coverage: [], log };
      } catch (e) {
        log.status = "failed";
        log.message = e instanceof Error ? e.message : "Search discovery failed";
        return { events: [], coverage: [], log };
      }
    },
  };
}
