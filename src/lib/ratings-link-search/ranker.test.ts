import { describe, expect, it } from "vitest";

import { mockFixtureResults } from "./__fixtures__/mockSearchExamples";
import { rankResults, scoreCompanyMatch } from "./ranker";

describe("ranker", () => {
  const ctx = {
    ticker: "LUMN",
    companyName: "Lumen Technologies, Inc.",
    aliases: ["LUMN", "Lumen"],
  };

  it("scoreCompanyMatch boosts ticker and name hits", () => {
    const high = scoreCompanyMatch(ctx, "Lumen Technologies outlook", "LUMN senior notes", "https://x");
    const low = scoreCompanyMatch(ctx, "Unrelated steel issuer", "Generic market commentary", "https://x");
    expect(high).toBeGreaterThan(low);
  });

  it("rankResults sorts by agency when mode is agency", () => {
    const sorted = rankResults([...mockFixtureResults], "agency");
    expect(sorted[0]?.agency).toBe("Fitch");
  });
});
