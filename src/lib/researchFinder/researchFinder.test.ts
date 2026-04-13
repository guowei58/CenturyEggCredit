import { describe, expect, it } from "vitest";

import { buildProfile } from "./profile";
import { buildProviderQueries } from "./queryBuilder";
import { mergeSearchAndDiscoveryHits } from "./rssLayer";
import { scoreMatch } from "./scoring";

describe("researchFinder profile", () => {
  it("normalizes ticker and dedupes aliases", () => {
    const p = buildProfile({ ticker: " htz ", companyName: "Hertz", aliases: ["Hertz", " Hertz "] });
    expect(p.ticker).toBe("HTZ");
    expect(p.aliases).toHaveLength(1);
  });
});

describe("researchFinder query builder", () => {
  it("builds site queries", () => {
    const p = buildProfile({ ticker: "HTZ", companyName: "Hertz", aliases: [] });
    const q = buildProviderQueries("octus", p, 5);
    expect(q[0]).toMatch(/site:/);
  });
});

describe("researchFinder RSS merge", () => {
  it("dedupes URLs and marks both channels when search and rss agree", () => {
    const merged = mergeSearchAndDiscoveryHits(
      [
        {
          title: "A",
          url: "https://octus.com/a",
          snippet: "short",
          query: "q1",
          publishedDate: null,
        },
      ],
      [
        {
          title: "A",
          url: "https://octus.com/a",
          snippet: "longer snippet from rss",
          query: "rss-google:q1",
          publishedDate: "Mon, 1 Jan 2024 00:00:00 GMT",
          fromSearch: false,
          fromRss: true,
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.fromSearch).toBe(true);
    expect(merged[0]!.fromRss).toBe(true);
    expect(merged[0]!.snippet).toContain("longer snippet");
  });
});

describe("researchFinder scoring", () => {
  it("scores ticker in title higher", () => {
    const p = buildProfile({ ticker: "HTZ", companyName: "Hertz", aliases: [] });
    const r1 = scoreMatch({
      provider: "octus",
      profile: p,
      title: "HTZ restructuring update",
      snippet: "",
      url: "https://octus.com/x",
      excerpt: "",
      importantPathBoost: false,
      accessLevel: "public",
      pageType: "article",
    });
    const r2 = scoreMatch({
      provider: "octus",
      profile: p,
      title: "restructuring update",
      snippet: "HTZ",
      url: "https://octus.com/x",
      excerpt: "",
      importantPathBoost: false,
      accessLevel: "public",
      pageType: "article",
    });
    expect(r1.score).toBeGreaterThan(r2.score);
  });
});

