import { describe, expect, it } from "vitest";

import { enforcementTextMatchesQuery, significantEnforcementQueryTokens } from "./enforcements";

describe("significantEnforcementQueryTokens", () => {
  it("drops generic corporate suffix tokens like inc and group", () => {
    expect(significantEnforcementQueryTokens("QVC Group, Inc.")).toEqual(["qvc"]);
  });
});

describe("enforcementTextMatchesQuery", () => {
  it("rejects DOJ press releases that only match generic inc inside including", () => {
    expect(
      enforcementTextMatchesQuery(
        "QVC Group, Inc.",
        "Memphis Man Sentenced to 27 Years in Prison for Methamphetamine Distribution",
        "A federal judge sentenced Terry Curtis after including multiple co-conspirators.",
      ),
    ).toBe(false);
  });

  it("keeps rows that mention the company token", () => {
    expect(
      enforcementTextMatchesQuery(
        "QVC Group, Inc.",
        "FTC Takes Action Against QVC Group, Inc.",
        "The Commission alleges QVC engaged in deceptive practices.",
      ),
    ).toBe(true);
  });
});
