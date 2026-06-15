import { describe, expect, it, vi, afterEach } from "vitest";

import { buildXQuery } from "./query/queryBuilder";
import { dedupePosts } from "./dedupe/dedupe";
import { filterLowQualityPosts, isSpamOrLowQualityPost } from "./filter/qualityFilter";
import { filterBySearchIntent, postMatchesSearchIntent } from "./filter/intentFilter";
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

  it("tightens query for cashtag-noisy tickers like SATS", () => {
    const q = buildXQuery({
      ticker: "SATS",
      companyName: "EchoStar Corporation",
      includeRetweets: false,
      language: "en",
    });
    expect(q.ambiguous).toBe(true);
    expect(q.query).toContain("$SATS");
    expect(q.query).toContain("EchoStar");
    expect(q.query).toContain("earnings");
  });
});

describe("xSearch dedupe", () => {
  it("dedupes by id", () => {
    const p = (id: string): NormalizedXPost => ({
      id,
      text: "x",
      isTruncatedPreview: false,
      media: [],
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
      isTruncatedPreview: false,
      media: [],
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

describe("xSearch intent filter", () => {
  const base: NormalizedXPost = {
    id: "1",
    text: "stack of sats into a bigger stack",
    isTruncatedPreview: false,
    media: [],
    authorId: null,
    authorUsername: null,
    authorName: null,
    createdAt: new Date().toISOString(),
    url: "https://x.com/i/web/status/1",
    language: "en",
    metrics: { likeCount: 1, repostCount: 0, replyCount: 1, quoteCount: 0 },
    cashtags: [],
    hashtags: [],
    mentions: [],
    matchedTicker: "SATS",
    matchedCompanyNames: [],
    matchedAliases: [],
    matchSignals: ["ticker"],
    confidenceScore: 0.43,
    relevanceScore: 0,
    sourceProvider: "recent_search",
    isRetweet: false,
    isReply: false,
    isQuote: false,
  };

  it("rejects bare-word matches without cashtag", () => {
    expect(postMatchesSearchIntent(base, { ticker: "SATS" })).toBe(false);
    expect(filterBySearchIntent([base], { ticker: "SATS" }).kept).toHaveLength(0);
  });

  it("keeps posts with $TICKER", () => {
    const good = { ...base, id: "2", text: "$SATS looks interesting", cashtags: ["SATS"], matchSignals: ["cashtag"] };
    expect(postMatchesSearchIntent(good, { ticker: "SATS" })).toBe(true);
  });
});

describe("xSearch quality filter", () => {
  const base: NormalizedXPost = {
    id: "1",
    text: "$HTZ looking strong",
    isTruncatedPreview: false,
    media: [],
    authorId: null,
    authorUsername: null,
    authorName: null,
    createdAt: new Date().toISOString(),
    url: "https://x.com/i/web/status/1",
    language: "en",
    metrics: { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 },
    cashtags: ["HTZ"],
    hashtags: [],
    mentions: [],
    matchedTicker: "HTZ",
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

  it("drops zero-engagement posts", () => {
    expect(isSpamOrLowQualityPost(base, 1)).toBe(true);
    const kept = filterLowQualityPosts([base]).kept;
    expect(kept).toHaveLength(0);
  });

  it("keeps posts with engagement", () => {
    const good = { ...base, id: "2", metrics: { likeCount: 3, repostCount: 1, replyCount: 0, quoteCount: 0 } };
    expect(isSpamOrLowQualityPost(good, 1)).toBe(false);
    expect(filterLowQualityPosts([base, good]).kept).toHaveLength(1);
  });

  it("drops obvious spam patterns", () => {
    const spam = {
      ...base,
      id: "3",
      text: "DM me on telegram for 100x stock signals $HTZ $AAPL $TSLA",
      metrics: { likeCount: 50, repostCount: 10, replyCount: 0, quoteCount: 0 },
    };
    expect(isSpamOrLowQualityPost(spam, 1)).toBe(true);
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

