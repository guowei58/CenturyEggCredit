import { afterEach, describe, expect, it, vi } from "vitest";

import type { NewsAggregationResponse } from "@/lib/news/types";
import { fetchNewsEventsTabItemsForDay } from "./news-events-ingest";

vi.mock("@/lib/news/service", () => ({
  runNewsAggregation: vi.fn(),
}));

import { runNewsAggregation } from "@/lib/news/service";

const mockedRun = vi.mocked(runNewsAggregation);

describe("fetchNewsEventsTabItemsForDay", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps only articles published on the request NY date", async () => {
    mockedRun.mockResolvedValue({
      ticker: "MSTR",
      activeProviders: ["major_outlet_rss"],
      disabledProviders: [],
      providerStats: {
        major_outlet_rss: { success: true, count: 2 },
      },
      totalBeforeDedupe: 2,
      totalAfterDedupe: 2,
      articles: [
        {
          id: "1",
          title: "Strategy buys more bitcoin",
          url: "https://www.wsj.com/articles/strategy-bitcoin",
          sourceName: "Wall Street Journal",
          sourceDomain: "wsj.com",
          publishedAt: "2026-06-15T16:00:00.000Z",
          summary: "Details",
          imageUrl: null,
          tickers: ["MSTR"],
          companies: ["Strategy Inc."],
          sentimentScore: null,
          sentimentLabel: null,
          providers: ["major_outlet_rss"],
        },
        {
          id: "2",
          title: "Older headline",
          url: "https://www.wsj.com/articles/older",
          sourceName: "Wall Street Journal",
          sourceDomain: "wsj.com",
          publishedAt: "2026-06-14T12:00:00.000Z",
          summary: null,
          imageUrl: null,
          tickers: ["MSTR"],
          companies: [],
          sentimentScore: null,
          sentimentLabel: null,
          providers: ["major_outlet_rss"],
        },
        {
          id: "3",
          title: "MSTR Stock Price Today - WSJ",
          url: "https://www.wsj.com/market-data/stocks/mstr",
          sourceName: "Wall Street Journal",
          sourceDomain: "wsj.com",
          publishedAt: "2026-06-15T12:00:00.000Z",
          summary: null,
          imageUrl: null,
          tickers: ["MSTR"],
          companies: [],
          sentimentScore: null,
          sentimentLabel: null,
          providers: ["major_outlet_rss"],
        },
      ],
    } satisfies NewsAggregationResponse);

    const result = await fetchNewsEventsTabItemsForDay(
      "MSTR",
      "Strategy Inc.",
      new Date("2026-06-15T20:00:00.000Z")
    );

    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: "MSTR",
        companyName: "Strategy Inc.",
        from: "2026-06-15",
        to: "2026-06-15",
      }),
      { sortMode: "recent" }
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.headline).toBe("Strategy buys more bitcoin");
    expect(result.sourcesUsed).toContain("News & Events (major_outlet_rss)");
  });
});
