import { describe, expect, it } from "vitest";

import {
  bsTreasuryShareCountConceptHeuristic,
  isBalanceSheetShareCountRow,
} from "@/lib/sec-xbrl-balance-sheet-shares";

describe("isBalanceSheetShareCountRow", () => {
  it("omits concepts with only xbrli:shares facts", () => {
    const inst = {
      unitMeasure: new Map<string, string>([["u_sh", "xbrli:shares"]]),
      facts: new Map([
        [
          "us-gaap:TreasuryStockShares",
          [{ unitRef: "u_sh", value: 1_000_000 }],
        ],
      ]),
    };
    expect(isBalanceSheetShareCountRow(inst, "us-gaap:TreasuryStockShares")).toBe(true);
  });

  it("keeps monetary lines (USD)", () => {
    const inst = {
      unitMeasure: new Map<string, string>([
        ["u_usd", "iso4217:USD"],
        ["u_sh", "xbrli:shares"],
      ]),
      facts: new Map([
        ["us-gaap:TreasuryStockValue", [{ unitRef: "u_usd", value: 50e6 }]],
      ]),
    };
    expect(isBalanceSheetShareCountRow(inst, "us-gaap:TreasuryStockValue")).toBe(false);
  });

  it("keeps rows with mixed currency and shares facts", () => {
    const inst = {
      unitMeasure: new Map<string, string>([
        ["u_usd", "iso4217:USD"],
        ["u_sh", "xbrli:shares"],
      ]),
      facts: new Map([
        [
          "us-gaap:Weird",
          [
            { unitRef: "u_usd", value: 1 },
            { unitRef: "u_sh", value: 2 },
          ],
        ],
      ]),
    };
    expect(isBalanceSheetShareCountRow(inst, "us-gaap:Weird")).toBe(false);
  });

  it("heuristic matches treasury + shares concept names", () => {
    expect(bsTreasuryShareCountConceptHeuristic("us-gaap:TreasuryStockCommonShares")).toBe(true);
    expect(bsTreasuryShareCountConceptHeuristic("us-gaap:CommonStockSharesOutstanding")).toBe(false);
  });
});
