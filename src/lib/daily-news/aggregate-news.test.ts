import { describe, expect, it } from "vitest";

import { buildAggregateNewsRows } from "./aggregate-news";
import type { DailyNewsBatchPayload } from "./types";

function item(ticker: string, headline: string, publishedAt: string) {
  return {
    dedupeHash: `${ticker}-${headline}`,
    ticker,
    source: "Test",
    sourceType: "trade" as const,
    headline,
    url: `https://example.com/${encodeURIComponent(headline)}`,
    publishedAt,
    summary: headline,
    whyItMatters: "",
  };
}

describe("buildAggregateNewsRows", () => {
  it("lists news in watchlist ticker order, not global date order", () => {
    const payload: DailyNewsBatchPayload = {
      v: 1,
      generatedAt: "2026-06-15T12:00:00.000Z",
      latestRefreshAt: "2026-06-15T12:00:00.000Z",
      tickers: ["AAA", "CMPR", "ZZZ"],
      watchlistSignature: "AAA|CMPR|ZZZ",
      topLevelSummary: "",
      summaryByTicker: {
        AAA: {
          ticker: "AAA",
          companyName: "AAA Inc",
          newSinceLastUpdate: [],
          secFilings: [],
          companyNews: [item("AAA", "AAA newer", "2026-06-15")],
          industryNews: [],
          whyItMatters: "",
        },
        CMPR: {
          ticker: "CMPR",
          companyName: "Cimpress",
          newSinceLastUpdate: [],
          secFilings: [],
          companyNews: [],
          industryNews: [
            item("CMPR", "CMPR one", "2026-06-15"),
            item("CMPR", "CMPR two", "2026-06-15"),
          ],
          whyItMatters: "",
        },
        ZZZ: {
          ticker: "ZZZ",
          companyName: "ZZZ Corp",
          newSinceLastUpdate: [],
          secFilings: [],
          companyNews: [item("ZZZ", "ZZZ older", "2026-06-14")],
          industryNews: [],
          whyItMatters: "",
        },
      },
      sourcesUsed: [],
      fetchErrors: [],
    };

    const rows = buildAggregateNewsRows(payload);
    expect(rows.map((r) => r.workspaceKey)).toEqual(["AAA", "CMPR", "CMPR", "ZZZ"]);
    expect(rows.map((r) => r.headline)).toEqual(["AAA newer", "CMPR one", "CMPR two", "ZZZ older"]);
  });
});
