import { describe, expect, it } from "vitest";

import { buildDiscoveryQueries } from "./discovery/queryBuilder";
import { detectPublicationFromHit } from "./discovery/publicationDetector";
import { inferFeedUrl } from "./rss/feedInference";
import { matchText } from "./matching/matcher";
import { normalizeUrlForMatch } from "./utils";
import { dedupeResults } from "./search/dedupe";

describe("substack query builder", () => {
  it("builds multiple queries", () => {
    const q = buildDiscoveryQueries({ ticker: "TSLA", companyName: "Tesla", aliases: ["Tesla, Inc."] });
    expect(q.length).toBeGreaterThan(2);
  });
});

describe("publication detector", () => {
  it("detects subdomain publication from post url", () => {
    const det = detectPublicationFromHit({
      url: "https://example.substack.com/p/some-post",
      title: "Some post",
      snippet: "Substack",
    });
    expect(det?.publication.baseUrl).toBe("https://example.substack.com/");
    expect(det?.isPostUrl).toBe(true);
  });
});

describe("rss inference", () => {
  it("infers /feed", () => {
    expect(inferFeedUrl("https://x.substack.com/")).toBe("https://x.substack.com/feed");
  });
});

describe("matcher ambiguity", () => {
  it("downweights ambiguous ticker-only matches", () => {
    const m = matchText({ ticker: "T", companyName: "AT&T", aliases: [], text: "T is a letter." });
    expect(m.confidence).toBeLessThan(0.4);
  });
});

describe("url normalization", () => {
  it("strips tracking params", () => {
    expect(normalizeUrlForMatch("https://a.com/p/x?utm_source=y#z")).toBe("https://a.com/p/x");
  });
});

describe("dedupe results", () => {
  it("dedupes by normalized URL", () => {
    const out = dedupeResults([
      { post: { normalizedUrl: "https://a.com/p/1" } as any, publication: null, relevanceScore: 0, discoverySource: "db" },
      { post: { normalizedUrl: "https://a.com/p/1" } as any, publication: null, relevanceScore: 0, discoverySource: "serpapi_live" },
    ] as any);
    expect(out).toHaveLength(1);
  });
});

