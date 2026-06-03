import { describe, expect, it } from "vitest";

import { reorderBalanceSheetRowsForPresentationSemantics } from "@/lib/sec-xbrl-balance-sheet-reorder";

function r(
  concept: string,
  label: string,
  depth: number
): { concept: string; label: string; depth: number; values: Record<string, null> } {
  return { concept, label, depth, values: {} };
}

describe("reorderBalanceSheetRowsForPresentationSemantics", () => {
  it("moves cost method investments after last non-current investment peer", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:MarketableSecuritiesNoncurrent", "Marketable Securities, Noncurrent", 2),
      r("us-gaap:Goodwill", "Goodwill", 2),
      r("us-gaap:CostMethodInvestments", "Cost method investments", 2),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    expect(out.map((x) => x.concept)).toEqual([
      "us-gaap:Cash",
      "us-gaap:MarketableSecuritiesNoncurrent",
      "us-gaap:CostMethodInvestments",
      "us-gaap:Goodwill",
    ]);
  });

  it("treats singular cost method investment tag like plural", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:EquityMethodInvestments", "Equity method investments", 2),
      r("us-gaap:CostMethodInvestment", "Cost method investment", 2),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    expect(out.map((x) => x.concept)).toEqual([
      "us-gaap:Cash",
      "us-gaap:EquityMethodInvestments",
      "us-gaap:CostMethodInvestment",
    ]);
  });

  it("moves cost method from after consolidated total (label: Liabilities and Equity)", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:MarketableSecuritiesNoncurrent", "Marketable Securities, Noncurrent", 2),
      r("us-gaap:AccountsPayableCurrent", "Accounts payable", 2),
      r("us-gaap:LiabilitiesAndStockholdersEquity", "Liabilities and Equity", 0),
      r("us-gaap:CostMethodInvestments", "Cost method investments", 2),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    const costI = out.findIndex((x) => x.concept.includes("CostMethod"));
    const totalI = out.findIndex((x) => x.label.includes("Liabilities and Equity"));
    expect(costI).toBeGreaterThanOrEqual(0);
    expect(totalI).toBeGreaterThanOrEqual(0);
    expect(costI).toBeLessThan(totalI);
  });

  it("prefers the final L+E total when StockholdersEquity appears earlier on the face", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:MarketableSecuritiesNoncurrent", "Marketable Securities, Noncurrent", 2),
      r("us-gaap:StockholdersEquity", "Total stockholders' equity", 1),
      r("us-gaap:LiabilitiesAndStockholdersEquity", "Liabilities and Equity", 0),
      r("us-gaap:CostMethodInvestments", "Cost method investments", 2),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    const costI = out.findIndex((x) => x.concept.includes("CostMethod"));
    const leI = out.findIndex((x) => x.concept === "us-gaap:LiabilitiesAndStockholdersEquity");
    expect(costI).toBeLessThan(leI);
  });

  it("moves disposal group from after consolidated total before total current liabilities", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:AccountsPayableCurrent", "Accounts payable", 2),
      r("us-gaap:LiabilitiesCurrent", "Total current liabilities", 1),
      r("us-gaap:LongTermDebtNoncurrent", "Long-term debt", 2),
      r("us-gaap:LiabilitiesAndStockholdersEquity", "Liabilities and Equity", 0),
      r(
        "us-gaap:DisposalGroupIncludingDiscontinuedOperationLiabilitiesCurrent",
        "Disposal Group, Including Discontinued Operation, Liabilities, Current",
        2
      ),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    const dispI = out.findIndex((x) => x.concept.includes("Disposal"));
    const totalI = out.findIndex((x) => x.label.includes("Liabilities and Equity"));
    const tclI = out.findIndex((x) => x.concept === "us-gaap:LiabilitiesCurrent");
    expect(dispI).toBeGreaterThanOrEqual(0);
    expect(dispI).toBeLessThan(totalI);
    expect(dispI).toBeLessThan(tclI);
  });

  it("recognizes Liabilities & Equity (ampersand) as the grand total when the concept is not the US‑GAAP check tag", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:MarketableSecuritiesNoncurrent", "Marketable Securities, Noncurrent", 2),
      r("us-gaap:AccountsPayableCurrent", "Accounts payable", 2),
      r("xyz:CustomTotalLine", "Liabilities & Equity", 0),
      r("us-gaap:CostMethodInvestments", "Cost method investments", 2),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    const costI = out.findIndex((x) => x.concept.includes("CostMethod"));
    const totalI = out.findIndex((x) => x.label.includes("Liabilities & Equity"));
    expect(costI).toBeGreaterThanOrEqual(0);
    expect(totalI).toBeGreaterThanOrEqual(0);
    expect(costI).toBeLessThan(totalI);
  });

  it("moves disposal group from after consolidated total using first current liability row when subtotal tag is absent", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:AccountsPayableCurrent", "Accounts payable", 2),
      r("us-gaap:LongTermDebtNoncurrent", "Long-term debt", 2),
      r("us-gaap:LiabilitiesAndStockholdersEquity", "Liabilities and Equity", 0),
      r(
        "us-gaap:DisposalGroupIncludingDiscontinuedOperationLiabilitiesCurrent",
        "Disposal Group, Including Discontinued Operation, Liabilities, Current",
        2
      ),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    expect(out.map((x) => x.concept)).toEqual([
      "us-gaap:Cash",
      "us-gaap:DisposalGroupIncludingDiscontinuedOperationLiabilitiesCurrent",
      "us-gaap:AccountsPayableCurrent",
      "us-gaap:LongTermDebtNoncurrent",
      "us-gaap:LiabilitiesAndStockholdersEquity",
    ]);
  });

  it("moves disposal group current liability before total current liabilities when it appears after other CL lines", () => {
    const rows = [
      r("us-gaap:Cash", "Cash", 1),
      r("us-gaap:AccountsPayableCurrent", "Accounts payable", 2),
      r(
        "us-gaap:DisposalGroupIncludingDiscontinuedOperationLiabilitiesCurrent",
        "Disposal Group, Including Discontinued Operation, Liabilities, Current",
        2
      ),
      r("us-gaap:LiabilitiesCurrent", "Total current liabilities", 1),
      r("us-gaap:LongTermDebtNoncurrent", "Long-term debt", 2),
    ];
    const out = reorderBalanceSheetRowsForPresentationSemantics(rows);
    expect(out.map((x) => x.concept)).toEqual([
      "us-gaap:Cash",
      "us-gaap:AccountsPayableCurrent",
      "us-gaap:DisposalGroupIncludingDiscontinuedOperationLiabilitiesCurrent",
      "us-gaap:LiabilitiesCurrent",
      "us-gaap:LongTermDebtNoncurrent",
    ]);
  });
});
