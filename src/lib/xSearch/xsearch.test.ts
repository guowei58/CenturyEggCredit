import { describe, expect, it, vi, afterEach } from "vitest";

import { buildXQuery } from "./query/queryBuilder";
import { dedupePosts } from "./dedupe/dedupe";
import { scorePost } from "./ranking/rank";
import { runXSearch } from "./service";
import type { NormalizedXPost } from "./types";

describe("xSearch query builder", () => {
  it("uses cashtag and lang filter (no bare ticker token)", () => {
    const q = buildXQuery({ ticker: "IBM", includeRetweets: false, language: "en" });
    expect(q.query).toContain("$IBM");
    expect(q.query).toContain("lang:en");
    expect(q.query).toContain("-is:retweet");
    expect(q.query).not.toMatch(/\bOR\s+IBM\b/);
  });

  it("adds quoted company name alongside cashtag", () => {
    const q = buildXQuery({
      ticker: "CABO",
      companyName: "Cable One, Inc.",
      includeRetweets: false,
      language: "en",
    });
    expect(q.query).toContain("$CABO");
    expect(q.query).toContain("Cable One");
    expect(q.query).not.toMatch(/\bOR\s+CABO\b/);
  });

  it("tightens query for ambiguous tickers", () => {
    const q = buildXQuery({ ticker: "T", companyName: "AT&T", includeRetweets: false, language: "en" });
    expect(q.ambiguous).toBe(true);
    expect(q.query).toContain("earnings");
  });
});

describe("xSearch dedupe", () => {
  it("dedupes by id", () => {
    const p = (id: string): NormalizedXPost => ({
      id,
      text: "x",
      authorId: null,
      authorUsername: null,
      authorName: null,
      createdAt: null,
      url: `https://x.com/i/web/status/${id}`,
      language: "en",
      cashtags: [],
      hashtags: [],
      mentions: [],
      matchedTicker: "IBM",
      matchedCompanyNames: [],
      matchedAliases: [],
      matchSignals: [],
      confidenceScore: 0.5,
      relevanceScore: 0,
      sourceProvider: "recent_search",
      isRetweet: false,
      isReply: false,
      isQuote: false,
    });
    expect(dedupePosts([p("1"), p("1"), p("2")])).toHaveLength(2);
  });
});

describe("xSearch ranking", () => {
  it("prefers cashtag", () => {
    const base: NormalizedXPost = {
      id: "1",
      text: "hello",
      authorId: null,
      authorUsername: null,
      authorName: null,
      createdAt: new Date().toISOString(),
      url: "https://x.com/i/web/status/1",
      language: "en",
      cashtags: [],
      hashtags: [],
      mentions: [],
      matchedTicker: "IBM",
      matchedCompanyNames: [],
      matchedAliases: [],
      matchSignals: [],
      confidenceScore: 0.5,
      relevanceScore: 0,
      sourceProvider: "recent_search",
      isRetweet: false,
      isReply: false,
      isQuote: false,
    };
    const a = { ...base, id: "a", text: "IBM debt maturity" };
    const b = { ...base, id: "b", text: "$IBM debt maturity", cashtags: ["IBM"] };
    expect(scorePost(b, { ticker: "IBM" })).toBeGreaterThan(scorePost(a, { ticker: "IBM" }));
  });
});

describe("xSearch service behavior when missing token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a clean error payload", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    const out = await runXSearch({ ticker: "IBM" });
    expect(out.posts).toHaveLength(0);
    expect(out.error).toBeTruthy();
  });
});

