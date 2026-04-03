import { describe, expect, it } from "vitest";

import { createRawMap, mergeRedditHit, rawMapToResults } from "./dedupe";
import { buildSearchProfile } from "./queryGenerator";
import { scoreRedditPost } from "./scoring";
import { cacheFingerprint } from "./utils";
import type { RedditPostProvenance } from "./types";

const defaultSubs = ["stocks", "investing", "wallstreetbets"];

describe("reddit query generator", () => {
  it("requires ticker or company", () => {
    const r = buildSearchProfile({
      ticker: "",
      companyName: "",
      defaultSubreddits: defaultSubs,
      timeRange: "month",
      sortMode: "relevance",
      maxSubs: 5,
      maxQueryVariants: 20,
    });
    expect(r.error).toBeTruthy();
    expect(r.profile.queries).toHaveLength(0);
  });

  it("normalizes ticker and generates variants", () => {
    const r = buildSearchProfile({
      ticker: "htz",
      companyName: "Hertz Global Holdings",
      aliases: ["Hertz", "Hertz"],
      defaultSubreddits: defaultSubs,
      timeRange: "year",
      sortMode: "relevance",
      maxSubs: 5,
      maxQueryVariants: 30,
    });
    expect(r.error).toBeUndefined();
    expect(r.profile.ticker).toBe("HTZ");
    expect(r.profile.aliases).toEqual(["Hertz"]);
    expect(r.profile.queries).toContain("HTZ");
    expect(r.profile.queries.some((q) => q.includes("Hertz Global Holdings"))).toBe(true);
  });

  it("uses custom subreddits when provided", () => {
    const r = buildSearchProfile({
      ticker: "IBM",
      defaultSubreddits: defaultSubs,
      selectedSubreddits: ["SecurityAnalysis", "stocks"],
      timeRange: "month",
      sortMode: "new",
      maxSubs: 5,
      maxQueryVariants: 10,
    });
    expect(r.profile.selectedSubreddits).toEqual(["securityanalysis", "stocks"]);
  });
});

describe("reddit scoring", () => {
  const profile = {
    ticker: "HTZ",
    companyName: "Hertz Global Holdings",
    aliases: ["Hertz"],
    selectedSubreddits: [],
    timeRange: "year" as const,
    sortMode: "relevance" as const,
    queries: [],
    ambiguousTicker: false,
  };

  it("boosts exact ticker in title", () => {
    const s = scoreRedditPost({
      profile,
      title: "HTZ bonds discussion",
      selftext: "credit",
      subreddit: "stocks",
      score: 10,
      numComments: 5,
      matchedQueries: ['"HTZ"'],
      queryCount: 1,
    });
    expect(s.reasons).toContain("ticker_in_title");
    expect(s.confidence).not.toBe("low");
  });

  it("applies ambiguous ticker penalty without company context", () => {
    const pAmb = { ...profile, ticker: "IT", companyName: "", aliases: [], ambiguousTicker: true };
    const s = scoreRedditPost({
      profile: pAmb,
      title: "Hello world",
      selftext: "abc def ghi",
      subreddit: "pics",
      score: 2,
      numComments: 1,
      matchedQueries: ["IT"],
      queryCount: 1,
    });
    expect(s.reasons).toContain("ambiguous_ticker_penalty");
  });
});

describe("reddit dedupe", () => {
  const baseFields = {
    reddit_post_id: "abc",
    permalink: "https://www.reddit.com/x",
    title: "t",
    selftext_excerpt: null,
    subreddit: "stocks",
    author: "u",
    created_utc: 1,
    score: 1,
    upvote_ratio: null,
    num_comments: 1,
    domain: null,
    external_url: null,
    is_self: true,
    flair: null,
    over_18: false,
    stickied: false,
    locked: false,
    removed_or_deleted: false,
    metadata_json: {},
  };

  it("merges queries and keeps higher score", () => {
    const m = createRawMap();
    const prov: RedditPostProvenance = { query: "Q1", subredditScope: "sitewide", sort: "relevance", time: "year" };
    mergeRedditHit(m, "abc", { ...baseFields, reddit_post_id: "abc" }, "Q1", prov, 50, "medium", ["a"]);
    mergeRedditHit(m, "abc", { ...baseFields, reddit_post_id: "abc" }, "Q2", prov, 80, "high", ["b"]);
    const rows = rawMapToResults(m, "search1", (p) => p.join("_"), "now");
    expect(rows).toHaveLength(1);
    expect(rows[0].matched_queries_json.sort()).toEqual(["Q1", "Q2"].sort());
    expect(rows[0].match_score).toBe(80);
  });
});

describe("reddit cache fingerprint", () => {
  it("changes when inputs change", () => {
    const a = cacheFingerprint({
      ticker: "A",
      companyName: "",
      aliases: [],
      subs: [],
      time: "year",
      sort: "relevance",
      sitewideOnly: false,
      subredditOnly: false,
    });
    const b = cacheFingerprint({
      ticker: "B",
      companyName: "",
      aliases: [],
      subs: [],
      time: "year",
      sort: "relevance",
      sitewideOnly: false,
      subredditOnly: false,
    });
    expect(a).not.toBe(b);
  });
});
