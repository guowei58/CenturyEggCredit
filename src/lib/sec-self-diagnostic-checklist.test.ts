import { describe, expect, it } from "vitest";

import {
  buildSelfDiagnosticChecklist,
  FIFTEEN_SELF_DIAGNOSTIC_CHECKS,
} from "@/lib/sec-self-diagnostic-checklist";
import type { ExportValidationStatement, XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

describe("buildSelfDiagnosticChecklist", () => {
  it("returns all 15 checks with pass when no failures and lines exist", () => {
    const pk = "2024-12-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "FY24" }],
        rows: [
          { concept: "us-gaap:Revenues", values: { [pk]: 100 }, label: "Total revenue", depth: 0 },
          { concept: "us-gaap:ProductRevenue", values: { [pk]: 60 }, label: "Product", depth: 1 },
          { concept: "us-gaap:ServiceRevenue", values: { [pk]: 40 }, label: "Service", depth: 1 },
          { concept: "us-gaap:CostsAndExpenses", values: { [pk]: 70 }, label: "Total costs", depth: 0 },
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 30 }, label: "Operating income", depth: 0 },
          {
            concept: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
            values: { [pk]: 28 },
            label: "Pretax",
            depth: 0,
          },
          { concept: "us-gaap:IncomeTaxExpenseBenefit", values: { [pk]: 5 }, label: "Tax", depth: 0 },
          { concept: "us-gaap:NetIncomeLoss", values: { [pk]: 23 }, label: "Net income", depth: 0 },
        ],
      },
      {
        kind: "bs",
        periods: [{ key: pk, label: "FY24" }],
        rows: [
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 50 }, label: "Current assets", depth: 0 },
          { concept: "us-gaap:AssetsNoncurrent", values: { [pk]: 50 }, label: "Noncurrent", depth: 0 },
          { concept: "us-gaap:Assets", values: { [pk]: 100 }, label: "Assets", depth: 0 },
          { concept: "us-gaap:LiabilitiesCurrent", values: { [pk]: 20 }, label: "Current liab", depth: 0 },
          { concept: "us-gaap:LiabilitiesNoncurrent", values: { [pk]: 30 }, label: "Noncurrent liab", depth: 0 },
          { concept: "us-gaap:Liabilities", values: { [pk]: 50 }, label: "Liabilities", depth: 0 },
          { concept: "us-gaap:StockholdersEquity", values: { [pk]: 50 }, label: "Equity", depth: 0 },
        ],
      },
      {
        kind: "cf",
        periods: [{ key: pk, label: "FY24" }],
        rows: [
          {
            concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
            values: { [pk]: 10 },
            label: "Net cash from operating",
            depth: 1,
          },
          { concept: "us-gaap:NetIncomeLoss", values: { [pk]: 8 }, label: "Net income", depth: 2 },
          { concept: "us-gaap:Depreciation", values: { [pk]: 2 }, label: "D&A", depth: 2 },
          {
            concept: "us-gaap:NetCashProvidedByUsedInInvestingActivities",
            values: { [pk]: -3 },
            label: "Investing",
            depth: 0,
          },
          {
            concept: "us-gaap:NetCashProvidedByUsedInFinancingActivities",
            values: { [pk]: -2 },
            label: "Financing",
            depth: 0,
          },
          {
            concept: "us-gaap:CashCashEquivalentsPeriodIncreaseDecrease",
            values: { [pk]: 5 },
            label: "Net change",
            depth: 0,
          },
        ],
      },
    ];

    const checklist = buildSelfDiagnosticChecklist(stmts, [], []);
    expect(checklist).toHaveLength(15);
    expect(checklist.map((c) => c.id)).toEqual(FIFTEEN_SELF_DIAGNOSTIC_CHECKS.map((d) => d.id));
    const skipped = checklist.filter((c) => c.status === "skipped");
    expect(skipped.map((c) => c.id)).toEqual([]);
  });

  it("marks checks skipped when required statement lines are missing", () => {
    const checklist = buildSelfDiagnosticChecklist([], [], []);
    expect(checklist.every((c) => c.status === "skipped")).toBe(true);
    expect(checklist.find((c) => c.id === 1)?.skipReason).toMatch(/income statement/i);
  });

  it("runs BS checks 7 and 11 when totals exist on a later period column (not only periods[0])", () => {
    const pkEarly = "2024-03-31";
    const pkLate = "2024-12-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [
          { key: pkEarly, label: "Q1" },
          { key: pkLate, label: "FY24" },
        ],
        rows: [
          { concept: "us-gaap:AssetsCurrent", values: { [pkLate]: 40 }, label: "Current assets", depth: 0 },
          { concept: "us-gaap:AssetsNoncurrent", values: { [pkLate]: 60 }, label: "Noncurrent", depth: 0 },
          { concept: "us-gaap:Assets", values: { [pkLate]: 100 }, label: "Assets", depth: 0 },
          { concept: "us-gaap:LiabilitiesCurrent", values: { [pkLate]: 20 }, label: "Current liab", depth: 0 },
          { concept: "us-gaap:LiabilitiesNoncurrent", values: { [pkLate]: 30 }, label: "Noncurrent liab", depth: 0 },
          { concept: "us-gaap:Liabilities", values: { [pkLate]: 50 }, label: "Liabilities", depth: 0 },
          { concept: "us-gaap:StockholdersEquity", values: { [pkLate]: 50 }, label: "Equity", depth: 0 },
        ],
      },
    ];
    const checklist = buildSelfDiagnosticChecklist(stmts, [], []);
    expect(checklist.find((c) => c.id === 7)?.status).not.toBe("skipped");
    expect(checklist.find((c) => c.id === 9)?.status).not.toBe("skipped");
    expect(checklist.find((c) => c.id === 11)?.status).not.toBe("skipped");
  });

  it("runs CF checks 12–15 without presentation depth or _cal.xml", () => {
    const pk = "2024-03-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "cf",
        periods: [{ key: pk, label: "1Q24" }],
        rows: [
          { concept: "us-gaap:NetIncomeLoss", values: { [pk]: 100 }, label: "Net income" },
          { concept: "us-gaap:Depreciation", values: { [pk]: 10 }, label: "Depreciation" },
          {
            concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
            values: { [pk]: 110 },
            label: "Net cash provided by operating activities",
          },
          { concept: "us-gaap:PaymentsToAcquireProperty", values: { [pk]: -20 }, label: "Capital expenditures" },
          {
            concept: "us-gaap:NetCashProvidedByUsedInInvestingActivities",
            values: { [pk]: -20 },
            label: "Net cash provided by investing activities",
          },
          {
            concept: "us-gaap:ProceedsFromIssuanceOfDebt",
            values: { [pk]: -5 },
            label: "Debt proceeds",
          },
          {
            concept: "us-gaap:NetCashProvidedByUsedInFinancingActivities",
            values: { [pk]: -5 },
            label: "Net cash provided by financing activities",
          },
          {
            concept: "us-gaap:CashCashEquivalentsPeriodIncreaseDecrease",
            values: { [pk]: 85 },
            label: "Net increase in cash and cash equivalents",
          },
        ],
      },
    ];
    const checklist = buildSelfDiagnosticChecklist(stmts, [], []);
    for (const id of [12, 13, 14, 15]) {
      expect(checklist.find((c) => c.id === id)?.status).not.toBe("skipped");
    }
  });

  it("marks a check fail when a matching validation issue exists", () => {
    const pk = "2024-06-30";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "Q2" }],
        rows: [
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 10 }, depth: 0 },
          { concept: "us-gaap:Revenues", values: { [pk]: 100 }, depth: 0 },
          { concept: "us-gaap:CostsAndExpenses", values: { [pk]: 80 }, depth: 0 },
          {
            concept: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
            values: { [pk]: 5 },
            depth: 0,
          },
          { concept: "us-gaap:IncomeTaxExpenseBenefit", values: { [pk]: 1 }, depth: 0 },
          { concept: "us-gaap:NetIncomeLoss", values: { [pk]: 4 }, depth: 0 },
        ],
      },
      {
        kind: "bs",
        periods: [{ key: pk, label: "Q2" }],
        rows: [
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 1 }, depth: 0 },
          { concept: "us-gaap:AssetsNoncurrent", values: { [pk]: 1 }, depth: 0 },
          { concept: "us-gaap:Assets", values: { [pk]: 2 }, depth: 0 },
          { concept: "us-gaap:LiabilitiesCurrent", values: { [pk]: 1 }, depth: 0 },
          { concept: "us-gaap:LiabilitiesNoncurrent", values: { [pk]: 0 }, depth: 0 },
          { concept: "us-gaap:Liabilities", values: { [pk]: 1 }, depth: 0 },
          { concept: "us-gaap:StockholdersEquity", values: { [pk]: 1 }, depth: 0 },
        ],
      },
      {
        kind: "cf",
        periods: [{ key: pk, label: "Q2" }],
        rows: [
          { concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities", values: { [pk]: 1 }, depth: 0 },
          { concept: "us-gaap:NetCashProvidedByUsedInInvestingActivities", values: { [pk]: 0 }, depth: 0 },
          { concept: "us-gaap:NetCashProvidedByUsedInFinancingActivities", values: { [pk]: 0 }, depth: 0 },
          { concept: "us-gaap:CashCashEquivalentsPeriodIncreaseDecrease", values: { [pk]: 1 }, depth: 0 },
        ],
      },
    ];
    const issues: XbrlExportValidationIssue[] = [
      {
        statement: "income_statement",
        periodKey: pk,
        periodLabel: "Q2",
        severity: "fail",
        check: "Operating income vs revenue and expenses",
        detail: "gap",
      },
    ];
    const checklist = buildSelfDiagnosticChecklist(stmts, [], issues);
    expect(checklist.find((c) => c.id === 3)?.status).toBe("fail");
    expect(checklist.find((c) => c.id === 3)?.periodsFailed).toBe(1);
  });
});
