import { describe, expect, it } from "vitest";

import { buildProfile } from "./profile";
import { buildProviderQueries } from "./queryBuilder";
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

