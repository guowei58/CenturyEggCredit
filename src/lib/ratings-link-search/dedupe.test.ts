import { describe, expect, it } from "vitest";

import { mockFixtureResults } from "./__fixtures__/mockSearchExamples";
import { canonicalizeUrl, dedupeNormalizedResults } from "./dedupe";

describe("dedupe", () => {
  it("canonicalizeUrl strips utm params", () => {
    const u = canonicalizeUrl("https://www.fitchratings.com/a/b?utm_source=x&utm_campaign=y");
    expect(u).not.toContain("utm_");
    expect(u).toContain("fitchratings.com");
  });

  it("dedupeNormalizedResults keeps higher score for same URL", () => {
    const url = "https://www.spglobal.com/ratings/en/test-dedupe";
    const a = { ...mockFixtureResults[0], url, companyMatchScore: 88 };
    const b = { ...mockFixtureResults[0], url, companyMatchScore: 10, title: "Weaker duplicate" };
    const out = dedupeNormalizedResults([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.companyMatchScore).toBe(88);
  });
});
