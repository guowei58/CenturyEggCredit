import { describe, expect, it } from "vitest";

import {
  fetchAsPresentedStatements,
  fetchAsPresentedValidationContext,
  incomeStatementSelectionPriority,
  isComprehensiveIncomeRole,
  isStandaloneComprehensiveIncomeTitle,
  ideaViewerDefrefToConcept,
  parseIdeaViewerDefrefRows,
  primaryStatementKind,
} from "@/lib/sec-xbrl-as-presented";
import { visiblePeriodsAndRowsForStatement } from "@/lib/sec-xbrl-as-presented-save-client";

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

  it("uses Comprehensive Income title only for standalone CI — not combined Income and Comprehensive Income roles", () => {
    expect(
      isStandaloneComprehensiveIncomeTitle(
        "http://issuer.example/role/ConsolidatedStatementsOfIncomeAndComprehensiveIncome"
      )
    ).toBe(false);
    expect(
      isStandaloneComprehensiveIncomeTitle(
        "http://issuer.example/role/StatementsOfIncomeLossAndComprehensiveIncomeLoss"
      )
    ).toBe(false);
    expect(
      isStandaloneComprehensiveIncomeTitle("http://issuer.example/role/ConsolidatedStatementsofComprehensiveIncomeLoss")
    ).toBe(true);
    expect(isStandaloneComprehensiveIncomeTitle("http://issuer.example/role/StatementsofConsolidatedIncome")).toBe(false);
  });

  it("prefers a direct income statement role over a comprehensive income role", () => {
    expect(incomeStatementSelectionPriority("http://issuer.example/role/StatementsofConsolidatedIncome")).toBeGreaterThan(
      incomeStatementSelectionPriority("http://issuer.example/role/StatementsofConsolidatedComprehensiveIncome")
    );
  });

  it("deprioritizes Condensed roles vs full operations (segment revenue/cost lines often omitted from condensed)", () => {
    expect(
      incomeStatementSelectionPriority("http://issuer.example/role/ConsolidatedStatementsOfOperations")
    ).toBeGreaterThan(
      incomeStatementSelectionPriority("http://issuer.example/role/CondensedConsolidatedStatementsOfOperations")
    );
  });
});

describe("visiblePeriodsAndRowsForStatement", () => {
  it("keeps sparse historical rows when inclusive mode is requested", () => {
    const stmt = {
      id: "bs",
      title: "Balance Sheet",
      role: "testRole",
      periods: [
        { key: "FY23", label: "FY23", end: "2023-12-31", start: null },
        { key: "FY24", label: "FY24", end: "2024-12-31", start: null },
        { key: "1Q25", label: "1Q25", end: "2025-03-31", start: null },
      ],
      rows: [
        {
          concept: "us-gaap:Cash",
          label: "Cash",
          depth: 0,
          preferredLabelRole: null,
          values: { FY23: null, FY24: 10, "1Q25": 11 },
          rawValues: { FY23: null, FY24: 10, "1Q25": 11 },
        },
        {
          concept: "us-gaap:IntangibleAssetsNetExcludingGoodwill",
          label: "Intangible Assets, Net (Excluding Goodwill)",
          depth: 0,
          preferredLabelRole: null,
          values: { FY23: 3, FY24: null, "1Q25": null },
          rawValues: { FY23: 3, FY24: null, "1Q25": null },
        },
        {
          concept: "us-gaap:Inventory",
          label: "Inventory",
          depth: 0,
          preferredLabelRole: null,
          values: { FY23: null, FY24: 7, "1Q25": 8 },
          rawValues: { FY23: null, FY24: 7, "1Q25": 8 },
        },
      ],
    };

    const filtered = visiblePeriodsAndRowsForStatement(stmt, { minLineFillRatio: 0.5 });
    expect(filtered.periods.map((p) => p.key)).toEqual(["FY24", "1Q25"]);
    expect(filtered.rows.map((r) => r.concept)).toEqual(["us-gaap:Cash", "us-gaap:Inventory"]);

    const sparseColumnsInclusiveRows = visiblePeriodsAndRowsForStatement(stmt, {
      minLineFillRatio: 0.5,
      includeAllRowsWithFacts: true,
    });
    expect(sparseColumnsInclusiveRows.periods.map((p) => p.key)).toEqual(["FY24", "1Q25"]);
    expect(sparseColumnsInclusiveRows.rows.map((r) => r.concept)).toEqual([
      "us-gaap:Cash",
      "us-gaap:IntangibleAssetsNetExcludingGoodwill",
      "us-gaap:Inventory",
    ]);

    const inclusive = visiblePeriodsAndRowsForStatement(stmt, {
      minLineFillRatio: 0.5,
      includeAllPeriods: true,
      includeAllRowsWithFacts: true,
    });
    expect(inclusive.periods.map((p) => p.key)).toEqual(["FY23", "FY24", "1Q25"]);
    expect(inclusive.rows.map((r) => r.concept)).toEqual([
      "us-gaap:Cash",
      "us-gaap:IntangibleAssetsNetExcludingGoodwill",
      "us-gaap:Inventory",
    ]);
  });
});

describe("fetchAsPresentedStatements (network)", () => {
  it(
    "TSLA 10-Q 2023-06-30: income statement includes product/service revenue and COGS slices (ProductOrService axis)",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0001318605",
        accessionNumber: "0000950170-23-033872",
        form: "10-Q",
        filingDate: "2023-07-21",
      });
      expect(out.ok).toBe(true);
      const income = out.statements.find((s) => s.id === "primary-is");
      expect(income).toBeTruthy();
      const labels = income!.rows.map((r) => r.label.toLowerCase());
      expect(labels.some((l) => l.includes("energy") && (l.includes("storage") || l.includes("generation")))).toBe(
        true
      );
      expect(labels.some((l) => l.includes("service"))).toBe(true);
      const revContractRows = income!.rows.filter(
        (r) => r.concept === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
      );
      expect(revContractRows.length).toBeGreaterThanOrEqual(2);
      const cogsRows = income!.rows.filter((r) => r.concept === "us-gaap:CostOfGoodsAndServicesSold");
      expect(cogsRows.length).toBeGreaterThanOrEqual(2);
    },
    120_000
  );

  it(
    "TSLA 10-Q 2023-06-30: _cal.xml CostOfRevenue and Revenues rollups tie (raw resolver)",
    async () => {
      const ctx = await fetchAsPresentedValidationContext({
        cik: "0001318605",
        accessionNumber: "0000950170-23-033872",
        form: "10-Q",
        filingDate: "2023-07-21",
      });
      const costOfRevFail = ctx.payload.validation.find(
        (v) =>
          v.severity === "fail" &&
          v.statement === "calculation" &&
          v.check === "Calculation rollup: CostOfRevenue"
      );
      const revRollupFail = ctx.payload.validation.find(
        (v) => v.severity === "fail" && v.statement === "calculation" && v.check?.includes("Revenues")
      );
      expect(costOfRevFail).toBeUndefined();
      expect(revRollupFail).toBeUndefined();
    },
    120_000
  );

  it(
    "TSLA 10-Q 2022-09-30: energy COGS axis rows merge (QName swap across periods); CostOfRevenue rollup",
    async () => {
      const ctx = await fetchAsPresentedValidationContext({
        cik: "0001318605",
        accessionNumber: "0000950170-22-019867",
        form: "10-Q",
        filingDate: "2022-10-24",
      });
      const income = ctx.payload.statements.find((s) => s.id === "primary-is");
      expect(income).toBeTruthy();
      const energyCostRows = income!.rows.filter(
        (r) => /energy\s+generation/i.test(r.label) && /cost/i.test(r.concept)
      );
      expect(energyCostRows.length).toBe(1);

      const costOfRevFail = ctx.payload.validation.find(
        (v) =>
          v.severity === "fail" &&
          v.statement === "calculation" &&
          v.check === "Calculation rollup: CostOfRevenue"
      );
      expect(costOfRevFail).toBeUndefined();
    },
    120_000
  );

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

  it(
    "resolves GOOG-era Alphabet 10-Q filed under predecessor accession CIK (archive under successor CIK)",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0001652044",
        accessionNumber: "0001288776-15-000046",
        form: "10-Q",
        filingDate: "2015-10-29",
      });
      expect(out.ok).toBe(true);
      expect(out.statements.length).toBeGreaterThanOrEqual(3);
    },
    120_000
  );

  it(
    "resolves GOOG 10-K filed by agent accession 0001193125-… (artifacts only under issuer CIK from filing index)",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0001652044",
        accessionNumber: "0001193125-13-028362",
        form: "10-K",
        filingDate: "2013-01-29",
      });
      expect(out.ok).toBe(true);
      expect(out.statements.length).toBeGreaterThanOrEqual(3);
    },
    120_000
  );

  it(
    "FICO 10-Q calculation rollups within tolerance (display rounding on CF totals)",
    async () => {
      const ctx = await fetchAsPresentedValidationContext({
        cik: "0000814547",
        accessionNumber: "0000814547-24-000024",
        form: "10-Q",
        filingDate: "2024-07-31",
      });
      const fails = ctx.payload.validation.filter((v) => v.severity === "fail");
      expect(fails).toEqual([]);
    },
    300_000
  );

  it(
    "FICO 10-Q 2026-04-28 calculation rollups pass (weighted instance facts vs _cal.xml)",
    async () => {
      const ctx = await fetchAsPresentedValidationContext({
        cik: "0000814547",
        accessionNumber: "0000814547-26-000021",
        form: "10-Q",
        filingDate: "2026-04-28",
      });
      const fails = ctx.payload.validation.filter((v) => v.severity === "fail");
      expect(fails).toEqual([]);
    },
    300_000
  );

  it(
    "FICO 2018 10-K includes calc-only investing line (proceeds from sale of cost-method investment)",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000814547",
        accessionNumber: "0000814547-18-000010",
        form: "10-K",
        filingDate: "2018-11-09",
      });
      expect(out.ok).toBe(true);
      const cf = out.statements?.find((s) => s.id === "primary-cf");
      expect(cf).toBeDefined();
      const costSale = cf!.rows.find((r) =>
        /ProceedsFromSaleAndMaturityOfOtherInvestments/i.test(r.concept)
      );
      expect(costSale).toBeDefined();
      const invIdx = cf!.rows.findLastIndex((r) =>
        /NetCashProvidedByUsedInInvestingActivities/i.test(r.concept)
      );
      expect(invIdx).toBeGreaterThan(0);
      if (costSale) expect(cf!.rows.indexOf(costSale)).toBeLessThan(invIdx);
      const hasProceeds = Object.values(costSale?.values ?? {}).some(
        (v) => v !== null && v !== undefined && Number.isFinite(v) && v !== 0
      );
      expect(hasProceeds).toBe(true);
    },
    300_000
  );

  it(
    "FICO 10-Q 2026-04-28 includes calc-only financing lines (debt issuance costs, finance lease payments)",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000814547",
        accessionNumber: "0000814547-26-000021",
        form: "10-Q",
        filingDate: "2026-04-28",
      });
      expect(out.ok).toBe(true);
      const cf = out.statements?.find((s) => s.id === "primary-cf");
      expect(cf).toBeDefined();
      const debtIssuance = cf!.rows.find((r) => /PaymentsOfDebtIssuanceCosts/i.test(r.concept));
      const financeLease = cf!.rows.find((r) => /FinanceLeasePrincipalPayments/i.test(r.concept));
      expect(debtIssuance).toBeDefined();
      expect(financeLease).toBeDefined();
      const finIdx = cf!.rows.findLastIndex((r) => /NetCashProvidedByUsedInFinancingActivities/i.test(r.concept));
      expect(finIdx).toBeGreaterThan(0);
      if (debtIssuance) expect(cf!.rows.indexOf(debtIssuance)).toBeLessThan(finIdx);
      if (financeLease) expect(cf!.rows.indexOf(financeLease)).toBeLessThan(finIdx);
      const hasDebtFact = Object.values(debtIssuance?.values ?? {}).some(
        (v) => v !== null && v !== undefined && Number.isFinite(v) && v !== 0
      );
      expect(hasDebtFact).toBe(true);
    },
    300_000
  );

  it(
    "FICO 10-Q primary income table title is Income Statement when role combines income and comprehensive income",
    async () => {
      const out = await fetchAsPresentedStatements({
        cik: "0000814547",
        accessionNumber: "0000814547-26-000021",
        form: "10-Q",
        filingDate: "2026-04-28",
      });
      expect(out.ok).toBe(true);
      const income = out.statements.find((s) => s.id === "primary-is");
      expect(income?.title).toBe("Income Statement");
    },
    300_000
  );

  it(
    "FICO 2019-01-30 10-Q: calculation rollups pass (duplicate marketable-securities arcs handled)",
    async () => {
      const ctx = await fetchAsPresentedValidationContext({
        cik: "0000814547",
        accessionNumber: "0000814547-19-000003",
        form: "10-Q",
        filingDate: "2019-01-30",
      });
      const fails = ctx.payload.validation.filter((v) => v.severity === "fail");
      expect(fails).toEqual([]);
    },
    300_000
  );

  it(
    "FICO 2019-04-30 10-Q: calculation rollups pass (duplicate marketable-securities arcs handled)",
    async () => {
      const ctx = await fetchAsPresentedValidationContext({
        cik: "0000814547",
        accessionNumber: "0000814547-19-000008",
        form: "10-Q",
        filingDate: "2019-04-30",
      });
      const fails = ctx.payload.validation.filter((v) => v.severity === "fail");
      expect(fails).toEqual([]);
    },
    300_000
  );
});
