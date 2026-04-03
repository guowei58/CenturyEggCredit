import { describe, expect, it } from "vitest";

import { buildRatingsSearchQueries, collectNameTerms, orGroupBareTicker } from "./queryBuilder";

describe("queryBuilder", () => {
  it("collectNameTerms dedupes and caps", () => {
    const ctx = {
      ticker: "LUMN",
      companyName: "Lumen Technologies, Inc.",
      aliases: ["LUMN", "Lumen"],
    };
    const terms = collectNameTerms(ctx);
    expect(terms).toContain("LUMN");
    expect(terms.join(" ")).toMatch(/Lumen/i);
  });

  it("buildRatingsSearchQueries includes site restrictions for all three agencies", () => {
    const qs = buildRatingsSearchQueries({
      ticker: "HTZ",
      companyName: "Hertz Global Holdings, Inc.",
      aliases: ["HTZ", "Hertz"],
    });
    expect(qs.length).toBeGreaterThanOrEqual(6);
    expect(qs.some((q) => q.startsWith("site:fitchratings.com"))).toBe(true);
    expect(qs.some((q) => q.startsWith("site:moodys.com"))).toBe(true);
    expect(qs.some((q) => q.startsWith("site:spglobal.com"))).toBe(true);
    const unique = new Set(qs);
    expect(unique.size).toBe(qs.length);
  });

  it("orGroupBareTicker combines quoted names and bare tickers", () => {
    const g = orGroupBareTicker(["AMC", "AMC Entertainment Holdings, Inc."]);
    expect(g).toMatch(/AMC/);
    expect(g).toMatch(/Entertainment/);
  });
});
