import { describe, expect, it } from "vitest";

import { normalizeBrokerName } from "./brokerAliases";
import { probableReportExists, scoreEventConfidence, shouldDisplayEvent } from "./confidence";
import { buildDedupeKey, dedupeEvents } from "./dedupe";
import { hitToAnalystEvent } from "./eventBuilder";
import { extractRatings, parseActionType, ratingToBucket } from "./normalize";
import { parsePriceTargets } from "./priceTargetParse";
import { buildBrokerActivitySummary } from "./summary";
import type { AnalystActivityEvent } from "./types";

describe("broker normalization", () => {
  it("maps JP Morgan variants", () => {
    expect(normalizeBrokerName("J.P. Morgan")).toBe("JPMorgan");
    expect(normalizeBrokerName("JP Morgan")).toBe("JPMorgan");
  });
  it("maps BofA variants", () => {
    expect(normalizeBrokerName("BofA")).toBe("BofA Securities");
    expect(normalizeBrokerName("Bank of America Securities")).toBe("BofA Securities");
  });
});

describe("rating normalization", () => {
  it("buckets ratings", () => {
    expect(ratingToBucket("Buy")).toBe("bullish");
    expect(ratingToBucket("Outperform")).toBe("bullish");
    expect(ratingToBucket("Hold")).toBe("neutral");
    expect(ratingToBucket("Sell")).toBe("bearish");
  });
  it("extracts from/to ratings", () => {
    const r = extractRatings("Goldman Sachs upgraded AAPL from Hold to Buy");
    expect(r.prior).toBe("Hold");
    expect(r.current).toBe("Buy");
  });
});

describe("action type parsing", () => {
  it("detects upgrades and PT raises", () => {
    expect(parseActionType("Analyst upgrades stock to Buy")).toBe("upgraded");
    expect(parseActionType("raises price target to $200 from $180")).toBe("price_target_raised");
    expect(parseActionType("initiates coverage with Outperform")).toBe("initiated_coverage");
    expect(parseActionType("reiterates Buy rating")).toBe("reiterated");
  });
});

describe("price target parsing", () => {
  it("parses from/to targets", () => {
    const pt = parsePriceTargets("raises price target to $12 from $10");
    expect(pt.current).toBe(12);
    expect(pt.prior).toBe(10);
    expect(pt.currency).toBe("USD");
  });
  it("parses single target", () => {
    const pt = parsePriceTargets("price target of US$45");
    expect(pt.current).toBe(45);
  });
});

describe("deduplication", () => {
  it("merges duplicate keys and keeps richer record", () => {
    const base: AnalystActivityEvent = {
      id: "a",
      ticker: "AAPL",
      companyName: "Apple",
      eventDate: "2024-01-15",
      broker: "Goldman Sachs",
      analystName: null,
      actionType: "upgraded",
      ratingPrior: "Hold",
      ratingCurrent: "Buy",
      ratingBucketPrior: "neutral",
      ratingBucketCurrent: "bullish",
      priceTargetPrior: null,
      priceTargetCurrent: null,
      currency: null,
      headline: "Short",
      snippet: null,
      sourceName: "Web",
      sourceUrl: "https://example.com/a",
      sourceType: "search_discovery",
      retrievedAt: "2024-01-16T00:00:00Z",
      confidenceScore: 70,
      probableReportExists: true,
      dedupeKey: "",
    };
    base.dedupeKey = buildDedupeKey(base);
    const dup = { ...base, id: "b", analystName: "Jane Doe", sourceUrl: "https://example.com/b", confidenceScore: 85 };
    const out = dedupeEvents([base, dup]);
    expect(out).toHaveLength(1);
    expect(out[0].analystName).toBe("Jane Doe");
    expect(out[0].secondarySourceUrls).toContain("https://example.com/b");
  });
});

describe("confidence scoring", () => {
  it("scores structured sources higher", () => {
    const s = scoreEventConfidence({
      sourceType: "marketbeat",
      hasDate: true,
      hasBroker: true,
      hasAction: true,
      hasRating: true,
      hasPriceTarget: true,
      hasHeadline: true,
    });
    expect(s).toBeGreaterThanOrEqual(85);
  });
  it("probable report exists for upgrades", () => {
    expect(probableReportExists("upgraded", "Upgrade", null)).toBe(true);
    expect(probableReportExists("unknown", "Analyst coverage list", null)).toBe(false);
  });
  it("hides unknown broker or missing date", () => {
    const base: AnalystActivityEvent = {
      id: "1",
      ticker: "HTZ",
      companyName: null,
      eventDate: "2026-01-01",
      broker: "Goldman Sachs",
      analystName: null,
      actionType: "upgraded",
      ratingPrior: null,
      ratingCurrent: "Buy",
      ratingBucketPrior: "unknown",
      ratingBucketCurrent: "bullish",
      priceTargetPrior: null,
      priceTargetCurrent: null,
      currency: null,
      headline: "h",
      snippet: null,
      sourceName: "Web",
      sourceUrl: "u",
      sourceType: "search_discovery",
      retrievedAt: "2026-01-01",
      confidenceScore: 80,
      probableReportExists: true,
      dedupeKey: "k",
    };
    expect(shouldDisplayEvent(base)).toBe(true);
    expect(shouldDisplayEvent({ ...base, broker: "Unknown" })).toBe(false);
    expect(shouldDisplayEvent({ ...base, eventDate: null })).toBe(false);
  });
});

describe("event builder from search hit", () => {
  it("builds event from sample headline", () => {
    const event = hitToAnalystEvent(
      {
        title: "JPMorgan upgrades Tesla to Overweight, raises price target to $300 from $250",
        url: "https://www.marketbeat.com/stock/tesla/ratings/",
        snippet: "Analyst Sam Doe at JPMorgan upgraded shares.",
        query: "test",
        publishedDate: "Jan 10, 2024",
      },
      "TSLA",
      "Tesla",
      "2024-01-11T00:00:00Z"
    );
    expect(event).not.toBeNull();
    expect(event!.broker).toBe("JPMorgan");
    expect(event!.actionType).toBe("upgraded");
    expect(event!.priceTargetCurrent).toBe(300);
    expect(event!.sourceType).toBe("marketbeat");
  });
});

describe("summary", () => {
  it("counts action types and stale warning", () => {
    const events: AnalystActivityEvent[] = [
      {
        id: "1",
        ticker: "X",
        companyName: null,
        eventDate: "2020-01-01",
        broker: "A",
        analystName: null,
        actionType: "upgraded",
        ratingPrior: null,
        ratingCurrent: "Buy",
        ratingBucketPrior: "unknown",
        ratingBucketCurrent: "bullish",
        priceTargetPrior: 10,
        priceTargetCurrent: 12,
        currency: "USD",
        headline: "h",
        snippet: null,
        sourceName: "s",
        sourceUrl: "u",
        sourceType: "search_discovery",
        retrievedAt: "2024-01-01",
        confidenceScore: 80,
        probableReportExists: true,
        dedupeKey: "k1",
      },
    ];
    const summary = buildBrokerActivitySummary(events, 3);
    expect(summary.upgradeCount).toBe(1);
    expect(summary.activeCoveringBrokers).toBe(3);
    expect(summary.staleCoverageWarning).toBe(true);
  });
});
