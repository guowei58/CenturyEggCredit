import { describe, expect, it } from "vitest";
import { secCompanyTickerLookupCandidates } from "@/lib/sec-edgar";

describe("secCompanyTickerLookupCandidates", () => {
  it("maps broker-style class dots to SEC hyphen tickers", () => {
    expect(secCompanyTickerLookupCandidates("BRK.B")).toEqual(["BRK.B", "BRK-B"]);
    expect(secCompanyTickerLookupCandidates("bf.b")).toEqual(["BF.B", "BF-B"]);
  });

  it("passes through ordinary symbols unchanged", () => {
    expect(secCompanyTickerLookupCandidates("MSFT")).toEqual(["MSFT"]);
    expect(secCompanyTickerLookupCandidates(" BRK-B ")).toEqual(["BRK-B"]);
  });

  it("collapses spaces as extra variants", () => {
    expect(secCompanyTickerLookupCandidates("BRK B")).toContain("BRKB");
    expect(secCompanyTickerLookupCandidates("BRK B")).toContain("BRK-B");
  });
});
