import { describe, expect, it } from "vitest";

import {
  fetchAsPresentedStatements,
  incomeStatementSelectionPriority,
  isComprehensiveIncomeRole,
  ideaViewerDefrefToConcept,
  parseIdeaViewerDefrefRows,
  primaryStatementKind,
} from "@/lib/sec-xbrl-as-presented";

describe("ideaViewerDefrefToConcept", () => {
  it("maps us-gaap defref token to QName", () => {
    expect(ideaViewerDefrefToConcept("us-gaap_CashAndCashEquivalentsAtCarryingValue")).toBe(
      "us-gaap:CashAndCashEquivalentsAtCarryingValue"
    );
  });

  it("maps extension prefix", () => {
    expect(ideaViewerDefrefToConcept("nxst_BroadcastRightsCurrent")).toBe("nxst:BroadcastRightsCurrent");
  });
});

describe("parseIdeaViewerDefrefRows", () => {
  it("extracts concept and label from SEC viewer anchor pattern", () => {
    const html = `<tr><td class="pl"><a class="a" href="javascript:void(0);" onclick="Show.showAR( this, 'defref_us-gaap_Assets', window );">Total assets</a></td></tr>`;
    expect(parseIdeaViewerDefrefRows(html)).toEqual([{ concept: "us-gaap:Assets", label: "Total assets" }]);
  });
});

describe("primaryStatementKind", () => {
  it("recognizes income-loss style primary statement roles", () => {
    expect(primaryStatementKind("http://smuckers.com/role/CondensedStatementsofConsolidatedIncomeLossUnaudited")).toBe("is");
  });

  it("recognizes comprehensive income-loss style primary statement roles", () => {
    expect(primaryStatementKind("http://issuer.example/role/ConsolidatedStatementsofComprehensiveIncomeLoss")).toBe("is");
  });

  it("flags comprehensive income roles separately for selection", () => {
    expect(isComprehensiveIncomeRole("http://issuer.example/role/ConsolidatedStatementsofComprehensiveIncomeLoss")).toBe(true);
    expect(isComprehensiveIncomeRole("http://issuer.example/role/StatementsofConsolidatedIncome")).toBe(false);
  });

  it("prefers a direct income statement role over a comprehensive income role", () => {
    expect(incomeStatementSelectionPriority("http://issuer.example/role/StatementsofConsolidatedIncome")).toBeGreaterThan(
      incomeStatementSelectionPriority("http://issuer.example/role/StatementsofConsolidatedComprehensiveIncome")
    );
  });
});

describe("fetchAsPresentedStatements (network)", () => {
  it(
    "resolves NXST 10-Q with no loose _pre/_lab using FilingSummary + R*.htm",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0001142417",
        accessionNumber: "0001193125-25-269795",
        form: "10-Q",
        filingDate: "2025-11-06",
      });
      expect(out.ok).toBe(true);
      expect(out.statements.length).toBeGreaterThanOrEqual(3);
      const titles = new Set(out.statements.map((s) => s.title));
      expect(titles.has("Balance Sheet")).toBe(true);
      expect(titles.has("Income Statement")).toBe(true);
      expect(titles.has("Cash Flow")).toBe(true);
    },
    120_000
  );

  it(
    "resolves SJM 10-Q primary statements when the income statement role uses IncomeLoss naming",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000091419",
        accessionNumber: "0000091419-26-000016",
        form: "10-Q",
        filingDate: "2026-02-26",
      });
      expect(out.ok).toBe(true);
      const titles = new Set(out.statements.map((s) => s.title));
      expect(titles.has("Balance Sheet")).toBe(true);
      expect(titles.has("Income Statement")).toBe(true);
      expect(titles.has("Cash Flow")).toBe(true);
    },
    120_000
  );

  it(
    "resolves SJM 10-K primary statements when the income role includes a consolidated qualifier",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000091419",
        accessionNumber: "0000091419-24-000054",
        form: "10-K",
        filingDate: "2024-06-18",
      });
      expect(out.ok).toBe(true);
      const titles = new Set(out.statements.map((s) => s.title));
      expect(titles.has("Balance Sheet")).toBe(true);
      expect(titles.has("Income Statement")).toBe(true);
      expect(titles.has("Cash Flow")).toBe(true);
    },
    120_000
  );

  it(
    "resolves legacy SJM filings by picking the real XBRL instance xml",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000091419",
        accessionNumber: "0000950123-11-024851",
        form: "10-Q",
        filingDate: "2011-03-10",
      });
      expect(out.ok).toBe(true);
      const titles = new Set(out.statements.map((s) => s.title));
      expect(titles.has("Balance Sheet")).toBe(true);
      expect(titles.has("Income Statement")).toBe(true);
      expect(titles.has("Cash Flow")).toBe(true);
    },
    120_000
  );

  it(
    "prefers the direct income statement over comprehensive income when both are present",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000091419",
        accessionNumber: "0000091419-26-000016",
        form: "10-Q",
        filingDate: "2026-02-26",
      });
      expect(out.ok).toBe(true);
      const income = out.statements.find((s) => s.id === "primary-is");
      expect(income).toBeTruthy();
      expect(income?.title).toBe("Income Statement");
      expect(income?.role.toLowerCase()).not.toContain("comprehensive");
    },
    120_000
  );
});
