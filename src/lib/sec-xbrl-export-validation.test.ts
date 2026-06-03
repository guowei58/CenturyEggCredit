import { describe, expect, it } from "vitest";

import {
  buildBsCfStructuralDiagnosticsForShapeIssues,
  calcChildIndicesExcludedAsDuplicatePrefixArcs,
  hasBlockingXbrlExportFailures,
  runCalculationRollupValidations,
  cashFlowSectionLineContribution,
  equityComponentContribution,
  pretaxBridgeLineContribution,
  toleranceUsd,
  runPresentationChildrenRollupValidations,
  runPresentationExtendedTieOutValidations,
  runStructuralExportValidations,
  type ExportValidationStatement,
} from "@/lib/sec-xbrl-export-validation";
import type { CalculationArcRow } from "@/lib/sec-xbrl-calculation";

function isStmt(rows: ExportValidationStatement["rows"], pk: string): ExportValidationStatement {
  return {
    kind: "is",
    periods: [{ key: pk, label: "1Q25", shortLabel: "1Q25" }],
    rows: rows.map((r) => ({ concept: r.c, values: { [pk]: r.v } })),
  };
}

describe("runStructuralExportValidations income_statement NCI bridge", () => {
  it("passes when NetIncomeLoss is parent NI and EBT−tax is consolidated (TSLA-style)", () => {
    const pk = "2025-03-31";
    const stmts: ExportValidationStatement[] = [
      isStmt(
        [
          { c: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes", v: 589e6 },
          { c: "us-gaap:IncomeTaxExpenseBenefit", v: 169e6 },
          { c: "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest", v: 11e6 },
          { c: "us-gaap:NetIncomeLoss", v: 409e6 },
        ],
        pk,
      ),
    ];
    const issues = runStructuralExportValidations(stmts);
    const niCheck = issues.filter((i) => i.check.includes("Net income vs EBT"));
    expect(niCheck.length).toBe(0);
  });

  it("still fails when nothing explains the gap", () => {
    const pk = "2025-03-31";
    const stmts: ExportValidationStatement[] = [
      isStmt(
        [
          { c: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes", v: 589e6 },
          { c: "us-gaap:IncomeTaxExpenseBenefit", v: 169e6 },
          { c: "us-gaap:NetIncomeLoss", v: 400e6 },
        ],
        pk,
      ),
    ];
    const issues = runStructuralExportValidations(stmts);
    const niCheck = issues.filter((i) => i.check.includes("Net income vs EBT"));
    expect(niCheck.length).toBe(1);
  });
});

describe("buildBsCfStructuralDiagnosticsForShapeIssues", () => {
  it("emits balance-sheet diagnostic with reconciliation when totals exist", () => {
    const pk = "2025-03-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Assets", values: { [pk]: 100e6 } },
          { concept: "us-gaap:LiabilitiesAndStockholdersEquity", values: { [pk]: 100e6 } },
        ],
      },
    ];
    const diag = buildBsCfStructuralDiagnosticsForShapeIssues(stmts, { balanceSheet: true, cashFlow: false }, []);
    expect(diag.length).toBe(1);
    expect(diag[0]!.check).toContain("Balance sheet");
    expect(diag[0]!.reconciliation?.lines.length).toBeGreaterThanOrEqual(3);
  });

  it("skips periods already in structural failures", () => {
    const pk = "2025-03-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Assets", values: { [pk]: 100e6 } },
          { concept: "us-gaap:LiabilitiesAndStockholdersEquity", values: { [pk]: 90e6 } },
        ],
      },
    ];
    const existing = runStructuralExportValidations(stmts);
    expect(existing.length).toBe(1);
    const diag = buildBsCfStructuralDiagnosticsForShapeIssues(stmts, { balanceSheet: true, cashFlow: false }, existing);
    expect(diag.length).toBe(0);
  });

  it("omits diagnostics for columns with no numeric data (e.g. FY year-end header with no facts in a 10-Q)", () => {
    const pkEmpty = "2024-12-31";
    const pkData = "2024-03-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [
          { key: pkEmpty, label: "FY24", shortLabel: "FY24" },
          { key: pkData, label: "Mar 2024", shortLabel: "1Q24" },
        ],
        rows: [
          {
            concept: "us-gaap:Assets",
            values: { [pkEmpty]: null, [pkData]: 100e6 },
          },
          {
            concept: "us-gaap:LiabilitiesAndStockholdersEquity",
            values: { [pkEmpty]: null, [pkData]: 100e6 },
          },
        ],
      },
    ];
    const diag = buildBsCfStructuralDiagnosticsForShapeIssues(stmts, { balanceSheet: true, cashFlow: false }, []);
    expect(diag.every((d) => d.periodKey !== pkEmpty)).toBe(true);
    expect(diag.some((d) => d.periodKey === pkData)).toBe(true);
  });
});

describe("balance sheet total resolution (concepts and labels)", () => {
  const pk = "2025-03-31";

  it("matches TotalAssets QName, not only elements ending in :Assets", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:TotalAssets", values: { [pk]: 100e6 } },
          { concept: "us-gaap:LiabilitiesAndStockholdersEquity", values: { [pk]: 100e6 } },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.statement === "balance_sheet")).toHaveLength(0);
  });

  it("falls back to presentation labels like “Assets” when QNames are non-standard", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "foo:SomeExtensionLine", values: { [pk]: 100e6 }, label: "Assets" },
          {
            concept: "bar:OtherExtensionLine",
            values: { [pk]: 100e6 },
            label: "Liabilities and stockholders' equity",
          },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.statement === "balance_sheet")).toHaveLength(0);
  });

  it("runs L+E vs assets when totals use presentation labels only", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "ext:AssetsTotal", values: { [pk]: 500e6 }, label: "Total assets" },
          { concept: "ext:LiabilitiesTotal", values: { [pk]: 300e6 }, label: "Total liabilities" },
          { concept: "ext:EquityTotal", values: { [pk]: 200e6 }, label: "Total shareholders' equity" },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.check.includes("Total liabilities + total equity"))).toHaveLength(0);
  });

  it("infers total equity from L+E combined minus total liabilities", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Assets", values: { [pk]: 1_000e6 } },
          { concept: "us-gaap:Liabilities", values: { [pk]: 600e6 }, label: "Total liabilities" },
          { concept: "us-gaap:LiabilitiesAndStockholdersEquity", values: { [pk]: 1_000e6 } },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.check.includes("Total liabilities + total equity"))).toHaveLength(0);
  });

  it("accepts EquityAndLiabilities (IFRS-style local name) as L+E total", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Assets", values: { [pk]: 100e6 } },
          { concept: "ifrs-full:EquityAndLiabilities", values: { [pk]: 100e6 } },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.statement === "balance_sheet")).toHaveLength(0);
  });
});

describe("calculation rollup duplicate QName children (e.g. MarketableSecurities)", () => {
  const faceRole =
    "http://fasb.org/us-gaap/role/statement/CondensedConsolidatedBalanceSheets";

  it("marks shorter QName for exclusion when weighted values match and names are strict prefix", () => {
    const ex = calcChildIndicesExcludedAsDuplicatePrefixArcs([
      { childConcept: "us-gaap:MarketableSecurities", weight: 1, value: 20e6 },
      { childConcept: "us-gaap:MarketableSecuritiesNoncurrent", weight: 1, value: 20e6 },
      { childConcept: "us-gaap:Cash", weight: 1, value: 50e6 },
    ]);
    expect(ex.has(0)).toBe(true);
    expect(ex.has(1)).toBe(false);
    expect(ex.has(2)).toBe(false);
  });

  it("passes Assets rollup when _cal.xml lists duplicate prefix arcs for the same fact", () => {
    const pk = "2024-03-31";
    const arcs: CalculationArcRow[] = [
      { role: faceRole, parentConcept: "us-gaap:Assets", childConcept: "us-gaap:Cash", weight: 1, order: 0 },
      {
        role: faceRole,
        parentConcept: "us-gaap:Assets",
        childConcept: "us-gaap:MarketableSecurities",
        weight: 1,
        order: 1,
      },
      {
        role: faceRole,
        parentConcept: "us-gaap:Assets",
        childConcept: "us-gaap:MarketableSecuritiesNoncurrent",
        weight: 1,
        order: 2,
      },
    ];
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Assets", values: { [pk]: 75e6 } },
          { concept: "us-gaap:Cash", values: { [pk]: 50e6 } },
          { concept: "us-gaap:MarketableSecurities", values: { [pk]: 25e6 } },
          { concept: "us-gaap:MarketableSecuritiesNoncurrent", values: { [pk]: 25e6 } },
        ],
      },
    ];
    const resolve = (concept: string, periodKey: string, _kind: "is" | "bs" | "cf") => {
      const row = stmts[0]!.rows.find((r) => r.concept === concept);
      const v = row?.values[periodKey];
      return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
    };
    const issues = runCalculationRollupValidations(arcs, stmts, resolve);
    expect(issues.filter((i) => i.check.includes("Calculation rollup: Assets"))).toHaveLength(0);
  });
});

describe("hasBlockingXbrlExportFailures", () => {
  it("is true only for severity fail", () => {
    expect(hasBlockingXbrlExportFailures(undefined)).toBe(false);
    expect(hasBlockingXbrlExportFailures([])).toBe(false);
    expect(
      hasBlockingXbrlExportFailures([
        {
          statement: "balance_sheet",
          periodKey: "p",
          periodLabel: "p",
          severity: "warn",
          check: "x",
          detail: "y",
        },
      ])
    ).toBe(false);
    expect(
      hasBlockingXbrlExportFailures([
        {
          statement: "balance_sheet",
          periodKey: "p",
          periodLabel: "p",
          severity: "fail",
          check: "x",
          detail: "y",
        },
      ])
    ).toBe(true);
  });
});

describe("toleranceUsd", () => {
  it("uses 0.1% of the largest reference amount", () => {
    expect(toleranceUsd(304.866e6, 308.748e6)).toBeCloseTo(308.748e6 * 0.001, 0);
    expect(toleranceUsd(100e6)).toBe(100_000);
  });
});

describe("runPresentationExtendedTieOutValidations", () => {
  const pk = "2025-03-31";

  it("passes when revenue, costs, and operating income tie (display)", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Revenues", values: { [pk]: 1_000e6 } },
          { concept: "us-gaap:CostsAndExpenses", values: { [pk]: 700e6 } },
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 300e6 } },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Operating income vs revenue"))).toHaveLength(0);
  });

  it("fails when operating walk does not tie", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Revenues", values: { [pk]: 1_000e6 } },
          { concept: "us-gaap:CostsAndExpenses", values: { [pk]: 700e6 } },
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 100e6 } },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.some((i) => i.severity === "fail" && i.check.includes("Operating income vs revenue"))).toBe(true);
  });

  it("runs pretax (EBT) bridge when operating, nonoperating, and EBT are present", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 1_000e6 }, depth: 0 },
          { concept: "us-gaap:NonoperatingIncomeExpense", values: { [pk]: -100e6 }, depth: 1 },
          {
            concept: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
            values: { [pk]: 900e6 },
            depth: 0,
          },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Pretax income bridge"))).toHaveLength(0);
  });

  it("subtracts interest expense when the face statement shows it as a positive amount", () => {
    expect(
      pretaxBridgeLineContribution(15.97e6, "Interest expense", "us-gaap:InterestExpense")
    ).toBe(-15.97e6);
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "6M12" }],
        rows: [
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 90.27e6 }, depth: 0, label: "Operating income" },
          { concept: "us-gaap:InterestIncome", values: { [pk]: 0.19e6 }, depth: 1, label: "Unallocated interest income" },
          { concept: "us-gaap:InterestExpense", values: { [pk]: 15.97e6 }, depth: 1, label: "Interest expense" },
          {
            concept: "us-gaap:OtherNonoperatingIncomeExpense",
            values: { [pk]: -1.18e6 },
            depth: 1,
            label: "Unallocated other expense, net",
          },
          {
            concept: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
            values: { [pk]: 73.31e6 },
            depth: 0,
            label: "Income before income taxes",
          },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Pretax income bridge"))).toHaveLength(0);
  });

  it("fails pretax bridge when operating and EBT do not reconcile", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:OperatingIncomeLoss", values: { [pk]: 1_000e6 }, depth: 0 },
          { concept: "us-gaap:InterestExpense", values: { [pk]: -50e6 }, depth: 1, label: "Interest expense" },
          {
            concept: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
            values: { [pk]: 800e6 },
            depth: 0,
            label: "Income before income taxes",
          },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.some((i) => i.severity === "fail" && i.check.includes("Pretax income bridge"))).toBe(true);
  });

  it("trusts face sign for Marketable Security Gain (Loss) captions", () => {
    expect(
      cashFlowSectionLineContribution(
        3.17e6,
        "Marketable Security, Gain (Loss)",
        "us-gaap:DebtSecuritiesGainLoss"
      )
    ).toBe(3.17e6);
    expect(
      cashFlowSectionLineContribution(
        3.17e6,
        "Unrealized gain (loss) on marketable securities",
        "us-gaap:MarketableSecuritiesGainLoss"
      )
    ).toBe(3.17e6);
  });

  it("still subtracts extension / product-line sale gains shown positive", () => {
    expect(
      cashFlowSectionLineContribution(
        1.941e6,
        "Gain (Loss) On Product Line Asset Sale",
        "fico:GainLossOnProductLineAssetSale"
      )
    ).toBe(-1.941e6);
  });

  it("trusts face sign for PP&E Gain (Loss) on disposition", () => {
    expect(
      cashFlowSectionLineContribution(
        0.4e6,
        "Gain (Loss) on Disposition of Property Plant Equipment",
        "us-gaap:GainLossOnSaleOfPropertyPlantEquipment"
      )
    ).toBe(0.4e6);
    expect(
      cashFlowSectionLineContribution(
        0.555e6,
        "Gain (Loss) on Disposition of Property Plant Equipment",
        "us-gaap:GainLossOnSaleOfPropertyPlantEquipment"
      )
    ).toBe(0.555e6);
  });

  it("subtracts plain gain-on-sale captions without Gain (Loss)", () => {
    expect(
      cashFlowSectionLineContribution(1.5e6, "Gain on sale of equipment", "us-gaap:GainLossOnSaleOfPropertyPlantEquipment")
    ).toBe(-1.5e6);
  });

  it("rolls up CF sections by face row order without presentation depth", () => {
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
          { concept: "us-gaap:PaymentsToAcquireProperty", values: { [pk]: -20 }, label: "Capex" },
          {
            concept: "us-gaap:NetCashProvidedByUsedInInvestingActivities",
            values: { [pk]: -20 },
            label: "Net cash provided by investing activities",
          },
          {
            concept: "us-gaap:RepaymentsOfDebt",
            values: { [pk]: -5 },
            label: "Debt repayment",
          },
          {
            concept: "us-gaap:NetCashProvidedByUsedInFinancingActivities",
            values: { [pk]: -5 },
            label: "Net cash provided by financing activities",
          },
        ],
      },
    ];
    const ext = runPresentationChildrenRollupValidations(stmts);
    expect(ext.filter((i) => i.severity === "fail")).toHaveLength(0);
  });

  it("sums cash flow operating section lines above the subtotal (not below it)", () => {
    const pk = "2023-09-30";
    const scale = 1e6;
    const rows: ExportValidationStatement["rows"] = [
      { concept: "us-gaap:NetIncomeLoss", values: { [pk]: 327.951 * scale }, depth: 2, label: "Net income" },
      {
        concept: "us-gaap:DepreciationDepletionAndAmortization",
        values: { [pk]: 11.642 * scale },
        depth: 3,
        label: "Depreciation",
      },
      {
        concept: "us-gaap:GainLossOnSaleOfPropertyPlantEquipment",
        values: { [pk]: 0.555 * scale },
        depth: 3,
        label: "Gain (Loss) on Disposition of Property Plant",
      },
      {
        concept: "us-gaap:IncreaseDecreaseInAccountsReceivable",
        values: { [pk]: -65.005 * scale },
        depth: 4,
        label: "Increase (Decrease) in Accounts Receivable",
      },
      {
        concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
        values: { [pk]: 304.866 * scale },
        depth: 2,
        label: "Net cash provided by operating activities",
      },
      {
        concept: "us-gaap:NetCashProvidedByUsedInInvestingActivities",
        values: { [pk]: -12.974 * scale },
        depth: 2,
        label: "Net cash provided by investing activities",
      },
    ];
    const stmts: ExportValidationStatement[] = [{ kind: "cf", periods: [{ key: pk, label: "9M23" }], rows }];
    const ext = runPresentationChildrenRollupValidations(stmts);
    const opFail = ext.find((i) => i.check.includes("Operating cash flow") && i.periodKey === pk);
    expect(opFail).toBeDefined();
    const reconLabels = opFail?.reconciliation?.lines.map((l) => l.label).join(" ") ?? "";
    expect(reconLabels).toMatch(/net income/i);
  });

  it("includes net income when it shares depth with the operating subtotal (indirect CF)", () => {
    const pk = "2025-06-30";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "cf",
        periods: [{ key: pk, label: "6M25" }],
        rows: [
          { concept: "us-gaap:NetIncomeLoss", values: { [pk]: 328.69e6 }, depth: 2, label: "Net income" },
          { concept: "us-gaap:Depreciation", values: { [pk]: 6.95e6 }, depth: 3, label: "Depreciation" },
          { concept: "us-gaap:IncreaseDecreaseInAccountsReceivable", values: { [pk]: -66.72e6 }, depth: 4 },
          {
            concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
            values: { [pk]: 268.92e6 },
            depth: 2,
            label: "Net cash provided by operating activities",
          },
        ],
      },
    ];
    const roll = runPresentationChildrenRollupValidations(stmts);
    expect(roll.filter((i) => i.check.includes("Operating cash flow"))).toHaveLength(0);
  });

  it("sums balance sheet current asset lines above the subtotal without presentation depth", () => {
    const pk = "2024-12-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "FY24" }],
        rows: [
          { concept: "us-gaap:CashAndCashEquivalents", values: { [pk]: 50e6 }, label: "Cash" },
          { concept: "us-gaap:AccountsReceivableNetCurrent", values: { [pk]: 30e6 }, label: "Receivables" },
          { concept: "us-gaap:InventoryNet", values: { [pk]: 20e6 }, label: "Inventory" },
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 100e6 }, label: "Total current assets" },
          { concept: "us-gaap:AssetsNoncurrent", values: { [pk]: 200e6 }, label: "Total noncurrent assets" },
          { concept: "us-gaap:Assets", values: { [pk]: 300e6 }, label: "Total assets" },
        ],
      },
    ];
    const roll = runPresentationChildrenRollupValidations(stmts);
    expect(roll.filter((i) => i.check.includes("Current asset components"))).toHaveLength(0);
  });

  it("sums current liability lines between total assets and total current liabilities", () => {
    const pk = "2024-12-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "FY24" }],
        rows: [
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 100e6 }, label: "Total current assets" },
          { concept: "us-gaap:Assets", values: { [pk]: 500e6 }, label: "Total assets" },
          { concept: "us-gaap:AccountsPayableCurrent", values: { [pk]: 50e6 }, label: "Accounts payable" },
          { concept: "us-gaap:AccruedLiabilitiesCurrent", values: { [pk]: 30e6 }, label: "Accrued liabilities" },
          { concept: "us-gaap:LiabilitiesCurrent", values: { [pk]: 80e6 }, label: "Total current liabilities" },
        ],
      },
    ];
    const roll = runPresentationChildrenRollupValidations(stmts);
    expect(roll.filter((i) => i.check.includes("Current liability components"))).toHaveLength(0);
  });

  it("fails current asset rollup when lines above subtotal do not foot", () => {
    const pk = "2024-12-31";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "FY24" }],
        rows: [
          { concept: "us-gaap:CashAndCashEquivalents", values: { [pk]: 50e6 }, label: "Cash" },
          { concept: "us-gaap:AccountsReceivableNetCurrent", values: { [pk]: 30e6 }, label: "Receivables" },
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 100e6 }, label: "Total current assets" },
        ],
      },
    ];
    const roll = runPresentationChildrenRollupValidations(stmts);
    expect(roll.some((i) => i.check.includes("Current asset components") && i.severity === "fail")).toBe(true);
  });

  it("sums presentation children under Revenues", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "is",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:Revenues", values: { [pk]: 300e6 }, depth: 0 },
          { concept: "us-gaap:ProductRevenue", values: { [pk]: 200e6 }, depth: 1, label: "Products" },
          { concept: "us-gaap:ServiceRevenue", values: { [pk]: 100e6 }, depth: 1, label: "Services" },
        ],
      },
    ];
    const roll = runPresentationChildrenRollupValidations(stmts);
    expect(roll.filter((i) => i.check.includes("Revenue components"))).toHaveLength(0);
  });

  it("equity rollup includes common stock par and extension lines above total equity", () => {
    const pk = "fy";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "FY" }],
        rows: [
          { concept: "us-gaap:Liabilities", values: { [pk]: 500e6 }, label: "Total liabilities" },
          { concept: "us-gaap:CommonStocksValue", values: { [pk]: 290_000 }, label: "Common stock" },
          { concept: "us-gaap:AdditionalPaidInCapital", values: { [pk]: 1_000e6 } },
          { concept: "us-gaap:RetainedEarnings", values: { [pk]: 2_000e6 } },
          { concept: "us-gaap:StockholdersEquity", values: { [pk]: 3_000_290_000 }, label: "Total stockholders equity" },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Equity components"))).toHaveLength(0);
  });

  it("subtracts treasury stock when the face balance sheet shows it as positive", () => {
    expect(equityComponentContribution(1_718.57e6, "Treasury stock", "us-gaap:TreasuryStock")).toBe(-1_718.57e6);
    const pk = "2013-06-30";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "2Q13" }],
        rows: [
          { concept: "us-gaap:AdditionalPaidInCapital", values: { [pk]: 1_103.61e6 } },
          { concept: "us-gaap:RetainedEarnings", values: { [pk]: 1_104.83e6 } },
          { concept: "us-gaap:AccumulatedOtherComprehensiveIncome", values: { [pk]: -15.81e6 } },
          { concept: "us-gaap:TreasuryStock", values: { [pk]: 1_718.57e6 }, label: "Treasury stock" },
          { concept: "us-gaap:StockholdersEquity", values: { [pk]: 474.41e6 } },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Equity components"))).toHaveLength(0);
  });

  it("checks total current assets plus lines between current and total assets", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 400e6 }, label: "Total current assets" },
          { concept: "us-gaap:PropertyPlantAndEquipmentNet", values: { [pk]: 500e6 }, label: "PP&E" },
          { concept: "us-gaap:Goodwill", values: { [pk]: 100e6 }, label: "Goodwill" },
          { concept: "us-gaap:Assets", values: { [pk]: 1_000e6 }, label: "Total assets" },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Assets: current + noncurrent"))).toHaveLength(0);
  });

  it("includes FX in Op+Inv+Fin bridge when net change tag includes exchange-rate effect", () => {
    const pk = "2025-06-30";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "cf",
        periods: [{ key: pk, label: "6M25" }],
        rows: [
          {
            concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
            values: { [pk]: 100e6 },
            label: "Net cash provided by operating activities",
          },
          {
            concept: "us-gaap:NetCashProvidedByUsedInInvestingActivities",
            values: { [pk]: -10e6 },
            label: "Net cash used in investing activities",
          },
          {
            concept: "us-gaap:NetCashProvidedByUsedInFinancingActivities",
            values: { [pk]: -80e6 },
            label: "Net cash used in financing activities",
          },
          {
            concept: "us-gaap:EffectOfExchangeRateOnCashAndCashEquivalents",
            values: { [pk]: -5e6 },
            label: "Effect of exchange rate on cash",
          },
          {
            concept:
              "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
            values: { [pk]: 5e6 },
            label: "Net increase in cash",
          },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.check.includes("Operating + investing + financing"))).toHaveLength(0);
  });

  it("runs Op+Inv+Fin vs net change using presentation labels only", () => {
    const pk = "2025-06-30";
    const stmts: ExportValidationStatement[] = [
      {
        kind: "cf",
        periods: [{ key: pk, label: "2Q25" }],
        rows: [
          {
            concept: "ext:Cfo",
            values: { [pk]: 100e6 },
            label: "Net cash provided by operating activities",
          },
          {
            concept: "ext:Cfi",
            values: { [pk]: -30e6 },
            label: "Net cash used in investing activities",
          },
          {
            concept: "ext:Cff",
            values: { [pk]: -20e6 },
            label: "Net cash used in financing activities",
          },
          {
            concept: "ext:NetChange",
            values: { [pk]: 50e6 },
            label: "Net increase in cash and cash equivalents",
          },
        ],
      },
    ];
    const issues = runStructuralExportValidations(stmts);
    expect(issues.filter((i) => i.check.includes("Operating + investing + financing"))).toHaveLength(0);
  });

  it("checks total current liabilities plus lines between current and total liabilities", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:LiabilitiesCurrent", values: { [pk]: 200e6 }, label: "Total current liabilities" },
          { concept: "us-gaap:LongTermDebtNoncurrent", values: { [pk]: 500e6 }, label: "Long-term debt" },
          { concept: "us-gaap:OtherLiabilitiesNoncurrent", values: { [pk]: 100e6 }, label: "Other noncurrent" },
          { concept: "us-gaap:Liabilities", values: { [pk]: 800e6 }, label: "Total liabilities" },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Liabilities: current + noncurrent"))).toHaveLength(0);
  });

  it("checks current + noncurrent assets vs total when noncurrent subtotal is tagged", () => {
    const stmts: ExportValidationStatement[] = [
      {
        kind: "bs",
        periods: [{ key: pk, label: "1Q25" }],
        rows: [
          { concept: "us-gaap:AssetsCurrent", values: { [pk]: 400e6 } },
          { concept: "us-gaap:AssetsNoncurrent", values: { [pk]: 600e6 } },
          { concept: "us-gaap:Assets", values: { [pk]: 1_000e6 } },
        ],
      },
    ];
    const ext = runPresentationExtendedTieOutValidations(stmts);
    expect(ext.filter((i) => i.check.includes("Assets: current + noncurrent"))).toHaveLength(0);
  });
});
