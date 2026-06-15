import { describe, expect, it } from "vitest";

import { buildCourtListenerQuery, courtListenerRowMatchesEntity, litigationApiSearchQuery, pacerRowMatchesEntity } from "./litigation";

describe("litigationApiSearchQuery", () => {
  it("uses the search-box query, not a higher-scored subsidiary name", () => {
    expect(
      litigationApiSearchQuery({
        query: "Nexstar Media",
        companyName: "Nexstar Inc.",
        entityNames: ["Tribune Real Estate", "Tribune Publishing"],
      }),
    ).toBe("Nexstar Media");
  });

  it("falls back to company name when query is empty", () => {
    expect(
      litigationApiSearchQuery({
        query: "",
        companyName: "Nexstar Inc.",
        entityNames: ["Tribune Real Estate"],
      }),
    ).toBe("Nexstar Inc.");
  });
});

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

describe("pacerRowMatchesEntity", () => {
  const params = {
    query: "Lumen Technologies",
    companyName: "Lumen Technologies, Inc.",
    ticker: "LUMN",
  };

  it("keeps rows whose case caption includes the company name", () => {
    expect(
      pacerRowMatchesEntity(
        {
          lastName: "Lumen Technologies, Inc.",
          courtCase: { caseTitle: "Lumen Technologies, Inc. v. Example Corp" },
        },
        params,
      ),
    ).toBe(true);
  });

  it("drops unrelated party rows", () => {
    expect(
      pacerRowMatchesEntity(
        {
          lastName: "Unrelated LLC",
          courtCase: { caseTitle: "Smith v. Jones" },
        },
        params,
      ),
    ).toBe(false);
  });
});
