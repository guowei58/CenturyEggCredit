import { describe, expect, it } from "vitest";

import { buildCourtListenerQuery, courtListenerRowMatchesEntity } from "./litigation";

describe("litigation CourtListener query selection", () => {
  it("prefers a cleaned multi-word company name over legal suffix variants", () => {
    expect(buildCourtListenerQuery(["HCA Healthcare, Inc.", "HCA Healthcare"])).toBe("HCA Healthcare");
  });

  it("prefers a descriptive company name over a bare ticker-like acronym", () => {
    expect(buildCourtListenerQuery(["HCA", "HCA Healthcare"])).toBe("HCA Healthcare");
  });

  it("falls back to the only available variant", () => {
    expect(buildCourtListenerQuery(["3M"])).toBe("3M");
  });
});

describe("courtListenerRowMatchesEntity", () => {
  const qvcParams = {
    query: "QVC",
    companyName: "QVC Group, Inc.",
    ticker: "QVC",
  };

  it("keeps rows whose caption includes the company name", () => {
    expect(
      courtListenerRowMatchesEntity(
        {
          caseName: "QVC Group, Inc. v. Example Vendor LLC",
        },
        qvcParams,
      ),
    ).toBe(true);
  });

  it("drops rows that only match broad docket text but not the caption", () => {
    expect(
      courtListenerRowMatchesEntity(
        {
          caseName: "Michael Todd Liddick",
          snippet: "Creditor matrix includes QVC Group, Inc.",
        },
        qvcParams,
      ),
    ).toBe(false);
  });
});
