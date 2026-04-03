import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertCatalogMatchesConstants, getAllBrokerDefinitions } from "./brokerRegistry";
import { MOCK_BROKER_DEFINITION } from "./brokers/mockBroker";
import { classifyAccessLevel, classifyReportType } from "./classifier";
import { isBrokerGloballyEnabled, resolveActiveBrokers } from "./config";
import { dedupeBrokerResults, resultsAreDuplicates } from "./dedupe";
import type { QueryContext } from "./queryBuilder";
import { buildQueriesForBroker } from "./queryBuilder";
import { rankBrokerResults, scoreForRanking } from "./rank";
import { runBrokerResearch } from "./service";
import type { BrokerDefinition, BrokerResearchSearchProvider, BrokerResearchResult } from "./types";
import { normalizeUrlForMatch, titleSimilarity } from "./utils";

describe("broker registry", () => {
  it("keeps production catalog aligned with constants", () => {
    expect(() => assertCatalogMatchesConstants()).not.toThrow();
  });

  it("lists all production brokers", () => {
    const all = getAllBrokerDefinitions();
    expect(all.length).toBe(25);
    expect(new Set(all.map((b) => b.id)).size).toBe(25);
  });
});

describe("config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables a broker when env is false", () => {
    vi.stubEnv("BROKER_RESEARCH_JPM_ENABLED", "false");
    const jpm = getAllBrokerDefinitions().find((b) => b.id === "jpmorgan")!;
    expect(isBrokerGloballyEnabled(jpm)).toBe(false);
  });

  it("honors enabledBrokers request filter", () => {
    const all = getAllBrokerDefinitions();
    const { active, skipped } = resolveActiveBrokers(all, ["goldman", "ubs"]);
    expect(active.map((b) => b.id).sort()).toEqual(["goldman", "ubs"]);
    expect(skipped.length).toBe(all.length - 2);
  });
});

describe("query builder", () => {
  const jpm = getAllBrokerDefinitions().find((b) => b.id === "jpmorgan")!;
  const ctx: QueryContext = {
    ticker: "IBM",
    companyName: "International Business Machines",
    aliases: ["IBM Corp"],
    from: "2025-01-01",
    to: "2026-12-31",
  };

  it("includes site: restriction and entity terms", () => {
    const qs = buildQueriesForBroker(jpm, ctx, 20);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.every((q) => q.includes("site:jpmorgan.com"))).toBe(true);
    expect(qs.some((q) => q.includes("IBM"))).toBe(true);
  });
});

describe("classification", () => {
  it("classifies initiation", () => {
    expect(classifyReportType("We initiate IBM at Overweight", "", "https://x.com/a")).toBe("initiation");
  });

  it("classifies downgrade", () => {
    expect(classifyReportType("Firm downgrades XYZ to Neutral", "cut PT", "https://x.com/b")).toBe("downgrade");
  });

  it("detects portal / login access", () => {
    expect(classifyAccessLevel("Research", "Please sign in to view", "https://x.com/login")).toBe("login_required");
  });
});

describe("deduplication", () => {
  it("merges normalized URL duplicates", () => {
    const a: BrokerResearchResult = {
      id: "1",
      brokerId: "goldman",
      brokerName: "Goldman",
      title: "IBM note",
      url: "https://goldmansachs.com/a?utm_source=x",
      snippet: "s1",
      publishedAt: "2026-01-01T12:00:00.000Z",
      companyName: "IBM",
      ticker: "IBM",
      matchedTickers: ["IBM"],
      matchedCompanies: [],
      reportType: "company_update",
      accessLevel: "unknown",
      relevanceScore: 0,
      confidenceScore: 0.5,
      searchQuery: "q",
      searchProvider: "google",
      rawSourceDomain: "goldmansachs.com",
      supportingSignals: [],
    };
    const b = { ...a, id: "2", url: "https://goldmansachs.com/a", snippet: "longer snippet text here" };
    expect(resultsAreDuplicates(a, b)).toBe(true);
    const { merged, after } = dedupeBrokerResults([a, b]);
    expect(after).toBe(1);
    expect((merged[0]!.snippet ?? "").length).toBeGreaterThan(5);
  });
});

describe("ranking", () => {
  it("scores ticker match higher", () => {
    const hi: BrokerResearchResult = {
      id: "h",
      brokerId: "b",
      brokerName: "B",
      title: "IBM detailed",
      url: "https://b.com/ibm",
      snippet: "IBM",
      publishedAt: "2026-02-01T00:00:00.000Z",
      companyName: null,
      ticker: "IBM",
      matchedTickers: ["IBM"],
      matchedCompanies: [],
      reportType: "company_update",
      accessLevel: "public",
      relevanceScore: 0,
      confidenceScore: 0.9,
      searchQuery: "q",
      searchProvider: "google",
      rawSourceDomain: "b.com",
      supportingSignals: ["ticker_in_text", "broker_domain_match"],
    };
    const lo = { ...hi, id: "l", title: "Generic sector wrap", matchedTickers: [], snippet: "macro" };
    expect(scoreForRanking(hi, { ticker: "IBM" })).toBeGreaterThan(scoreForRanking(lo, { ticker: "IBM" }));
  });

  it("sorts by recent", () => {
    const older = "2025-01-01T00:00:00.000Z";
    const newer = "2026-03-01T00:00:00.000Z";
    const a = makeResult({ id: "a", publishedAt: older });
    const b = makeResult({ id: "b", publishedAt: newer });
    const r = rankBrokerResults([a, b], { ticker: "IBM" }, "recent");
    expect(r[0]!.publishedAt).toBe(newer);
  });
});

function makeResult(p: Partial<BrokerResearchResult> & Pick<BrokerResearchResult, "id">): BrokerResearchResult {
  return {
    brokerId: "x",
    brokerName: "X",
    title: "T",
    url: "https://x.com/a",
    snippet: null,
    publishedAt: null,
    companyName: null,
    ticker: "IBM",
    matchedTickers: [],
    matchedCompanies: [],
    reportType: "unknown",
    accessLevel: "unknown",
    relevanceScore: 0,
    confidenceScore: 0.5,
    searchQuery: "q",
    searchProvider: "t",
    rawSourceDomain: "x.com",
    supportingSignals: [],
    ...p,
  };
}

describe("service integration", () => {
  const failBroker: BrokerDefinition = {
    id: "fail_broker",
    name: "Fail Broker",
    enabledByDefault: true,
    domains: ["fail.test"],
    aliases: [],
    searchPatterns: [],
  };

  const mockSearchProvider: BrokerResearchSearchProvider = {
    id: "test_provider",
    async search(query: string) {
      if (query.includes("site:fail.test")) {
        throw new Error("simulated failure");
      }
      return [
        {
          title: "Initiating coverage on TestCo",
          url: "https://research.example.test/reports/1",
          snippet: "We initiate with buy rating and price target",
          query,
          publishedDate: "2026-01-15T00:00:00Z",
        },
      ];
    },
  };

  it("aggregates mock broker and survives failing broker", async () => {
    const out = await runBrokerResearch(
      { ticker: "TST", companyName: "TestCo Inc", maxResults: 50 },
      {
        searchProvider: mockSearchProvider,
        brokers: [MOCK_BROKER_DEFINITION, failBroker],
      }
    );
    expect(out.reports.length).toBeGreaterThan(0);
    expect(out.brokerStats.fail_broker?.success).toBe(false);
    expect(out.brokerStats.mock_broker?.success).toBe(true);
  });

  it("proves extensibility with only a mock broker registration", async () => {
    const out = await runBrokerResearch(
      { ticker: "ABC", maxResults: 20 },
      { searchProvider: mockSearchProvider, brokers: [MOCK_BROKER_DEFINITION] }
    );
    expect(out.activeBrokers).toEqual(["mock_broker"]);
    expect(out.reports.every((r) => r.brokerId === "mock_broker")).toBe(true);
  });
});

describe("utils", () => {
  it("normalizes URLs for dedupe", () => {
    const a = normalizeUrlForMatch("https://Ex.COM/path/?utm_medium=email");
    const b = normalizeUrlForMatch("https://ex.com/path");
    expect(a).toBe(b);
  });

  it("title similarity", () => {
    expect(titleSimilarity("IBM raises guidance", "IBM Raises Guidance")).toBeGreaterThan(0.85);
  });
});
