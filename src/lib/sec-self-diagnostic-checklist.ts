import type { CalculationArcRow } from "@/lib/sec-xbrl-calculation";
import {
  balanceSheetHasAssetsWalk,
  balanceSheetHasLiabilitiesWalk,
  balanceSheetTotalAssets,
  balanceSheetTotalEquity,
  balanceSheetTotalLiabilities,
  cashFlowCanRollupSection,
  cashFlowNetChangeRow,
  cashFlowNetFinancing,
  cashFlowNetInvesting,
  cashFlowNetOperating,
  resolveCashFlowActivityBridgeParts,
  type CalculationRollupResolver,
  type ExportValidationStatement,
  type XbrlExportValidationIssue,
  matchLineValue,
  runAllXbrlExportValidations,
} from "@/lib/sec-xbrl-export-validation";

export type SelfDiagnosticCheckStatus = "pass" | "fail" | "skipped";

export type SelfDiagnosticCheckDefinition = {
  id: number;
  name: string;
  statement: "income_statement" | "balance_sheet" | "cash_flow";
};

/** The 15 tie-out checks requested for Run self-diagnostic. */
export const FIFTEEN_SELF_DIAGNOSTIC_CHECKS: readonly SelfDiagnosticCheckDefinition[] = [
  { id: 1, name: "Revenue components → total revenue", statement: "income_statement" },
  { id: 2, name: "Expense components → total expenses", statement: "income_statement" },
  { id: 3, name: "Total revenue − total expenses = operating income", statement: "income_statement" },
  { id: 4, name: "Operating income − nonoperating = pretax income", statement: "income_statement" },
  { id: 5, name: "Pretax income − taxes = net income", statement: "income_statement" },
  { id: 6, name: "Current asset components → total current assets", statement: "balance_sheet" },
  { id: 7, name: "Current + noncurrent assets = total assets", statement: "balance_sheet" },
  { id: 8, name: "Current liability components → total current liabilities", statement: "balance_sheet" },
  { id: 9, name: "Current + noncurrent liabilities = total liabilities", statement: "balance_sheet" },
  { id: 10, name: "Equity components → total equity", statement: "balance_sheet" },
  { id: 11, name: "Total liabilities + total equity = total assets", statement: "balance_sheet" },
  { id: 12, name: "Operating CF components → net cash from operations", statement: "cash_flow" },
  { id: 13, name: "Investing CF components → net cash from investing", statement: "cash_flow" },
  { id: 14, name: "Financing CF components → net cash from financing", statement: "cash_flow" },
  {
    id: 15,
    name: "Operating + investing + financing (+ FX) = net change in cash",
    statement: "cash_flow",
  },
] as const;

export type SelfDiagnosticCheckResult = SelfDiagnosticCheckDefinition & {
  status: SelfDiagnosticCheckStatus;
  /** Why the check did not run (missing tags / lines on the grid). */
  skipReason?: string;
  periodsChecked: number;
  periodsFailed: number;
};

const CHECK_ISSUE_PATTERNS: Record<number, RegExp[]> = {
  1: [/Revenue components vs total revenue/i, /Calculation rollup:\s*Revenues/i],
  2: [/Expense components vs total expenses/i, /Calculation rollup:\s*CostsAndExpenses/i, /Calculation rollup:\s*OperatingExpenses/i],
  3: [/Operating income vs revenue and expenses/i],
  4: [/Pretax income bridge/i],
  5: [/Net income vs EBT/i],
  6: [/Current asset components vs total current assets/i, /Calculation rollup:\s*AssetsCurrent/i],
  7: [/Assets: current \+ noncurrent vs total/i, /Calculation rollup:\s*Assets$/i],
  8: [/Current liability components vs total current liabilities/i, /Calculation rollup:\s*LiabilitiesCurrent/i],
  9: [/Liabilities: current \+ noncurrent vs total/i, /Calculation rollup:\s*Liabilities$/i],
  10: [/Equity components vs total equity/i, /Calculation rollup:\s*StockholdersEquity/i],
  11: [/Total liabilities \+ total equity vs assets/i, /Assets vs liabilities \+ equity/i],
  12: [/Operating cash flow components vs total/i, /Calculation rollup:\s*NetCashProvidedByUsedInOperatingActivities/i],
  13: [/Investing cash flow components vs total/i, /Calculation rollup:\s*NetCashProvidedByUsedInInvestingActivities/i],
  14: [/Financing cash flow components vs total/i, /Calculation rollup:\s*NetCashProvidedByUsedInFinancingActivities/i],
  15: [/Operating \+ investing \+ financing/i],
};

function stmtByKind(stmts: ExportValidationStatement[], k: "is" | "bs" | "cf") {
  return stmts.find((s) => s.kind === k) ?? null;
}

function periodKeysWithData(stmt: ExportValidationStatement): string[] {
  return stmt.periods
    .map((p) => p.key)
    .filter((pk) => stmt.rows.some((r) => Number.isFinite(r.values[pk] ?? NaN)));
}

function calcHasParent(arcs: CalculationArcRow[], localName: string): boolean {
  const want = localName.toLowerCase();
  return arcs.some((a) => {
    const tail = a.parentConcept.split(":").pop() ?? a.parentConcept;
    return tail.replace(/_/g, "").toLowerCase() === want;
  });
}

function rowsHavePresentationDepth(stmt: ExportValidationStatement | null): boolean {
  if (!stmt) return false;
  return stmt.rows.some((r) => r.depth !== undefined && Number.isFinite(r.depth));
}

function firstPeriodKey(stmt: ExportValidationStatement | null): string {
  return stmt?.periods[0]?.key ?? "";
}

/** First period column that has any finite balance-sheet amount (not always periods[0]). */
function firstBalanceSheetPeriodKey(bs: ExportValidationStatement): string {
  const withData = periodKeysWithData(bs);
  return withData[0] ?? firstPeriodKey(bs);
}

function anyBalanceSheetPeriod(bs: ExportValidationStatement, fn: (pk: string) => boolean): boolean {
  return periodKeysWithData(bs).some(fn);
}

function firstCashFlowPeriodKey(cf: ExportValidationStatement): string {
  const withData = periodKeysWithData(cf);
  return withData[0] ?? firstPeriodKey(cf);
}

function anyCashFlowPeriod(cf: ExportValidationStatement, fn: (pk: string) => boolean): boolean {
  return periodKeysWithData(cf).some(fn);
}

function probeCanRunCheck(
  checkId: number,
  stmts: ExportValidationStatement[],
  calcArcs: CalculationArcRow[]
): { canRun: boolean; skipReason?: string } {
  const is = stmtByKind(stmts, "is");
  const bs = stmtByKind(stmts, "bs");
  const cf = stmtByKind(stmts, "cf");

  switch (checkId) {
    case 1: {
      if (!is) return { canRun: false, skipReason: "No income statement on grid" };
      const pk = firstPeriodKey(is);
      const hasLine =
        matchLineValue(is.rows, pk, {
          normalizedLocals: new Set([
            "revenues",
            "salesrevenuenet",
            "revenuefromcontractwithcustomerexcludingassessedtax",
          ]),
        }) !== null ||
        matchLineValue(is.rows, pk, {
          label: (t) => /^total\s+revenues?$/i.test(t) || /^net\s+sales$/i.test(t),
        }) !== null;
      if (hasLine && (rowsHavePresentationDepth(is) || calcHasParent(calcArcs, "Revenues"))) return { canRun: true };
      if (!hasLine && !calcHasParent(calcArcs, "Revenues")) {
        return { canRun: false, skipReason: "No total revenue line and no _cal.xml Revenues parent" };
      }
      if (!rowsHavePresentationDepth(is) && !calcHasParent(calcArcs, "Revenues")) {
        return {
          canRun: false,
          skipReason: "Revenue line found but no presentation depth and no _cal.xml — use XBRL as-presented or load _cal.xml",
        };
      }
      return { canRun: true };
    }
    case 2: {
      if (!is) return { canRun: false, skipReason: "No income statement on grid" };
      const pk = firstPeriodKey(is);
      const hasLine =
        matchLineValue(is.rows, pk, {
          normalizedLocals: new Set(["costsandexpenses", "operatingexpenses", "costsanddirectoperatingexpenses"]),
        }) !== null ||
        matchLineValue(is.rows, pk, { label: (t) => /^total\s+costs and expenses$/i.test(t) }) !== null;
      if (hasLine && (rowsHavePresentationDepth(is) || calcHasParent(calcArcs, "CostsAndExpenses"))) return { canRun: true };
      if (!hasLine && !calcHasParent(calcArcs, "CostsAndExpenses")) {
        return { canRun: false, skipReason: "No total expenses line and no _cal.xml CostsAndExpenses parent" };
      }
      if (!rowsHavePresentationDepth(is) && !calcHasParent(calcArcs, "CostsAndExpenses")) {
        return {
          canRun: false,
          skipReason: "Expense subtotal found but no presentation depth and no _cal.xml",
        };
      }
      return { canRun: true };
    }
    case 3:
      if (!is) return { canRun: false, skipReason: "No income statement on grid" };
      if (
        matchLineValue(is.rows, is.periods[0]?.key ?? "", { conceptRegex: /OperatingIncomeLoss/i }) === null ||
        (matchLineValue(is.rows, is.periods[0]?.key ?? "", { conceptRegex: /Revenues$/i }) === null &&
          matchLineValue(is.rows, is.periods[0]?.key ?? "", { conceptRegex: /CostsAndExpenses/i }) === null)
      ) {
        return { canRun: false, skipReason: "Need operating income plus revenue or costs subtotal on the income statement" };
      }
      return { canRun: true };
    case 4:
      if (!is) return { canRun: false, skipReason: "No income statement on grid" };
      if (
        matchLineValue(is.rows, is.periods[0]?.key ?? "", { conceptRegex: /OperatingIncomeLoss/i }) === null ||
        matchLineValue(is.rows, is.periods[0]?.key ?? "", {
          conceptRegex: /IncomeLossFromContinuingOperationsBeforeIncomeTaxes/i,
        }) === null
      ) {
        return { canRun: false, skipReason: "Need operating income and income before income taxes on the income statement" };
      }
      return { canRun: true };
    case 5:
      if (!is) return { canRun: false, skipReason: "No income statement on grid" };
      if (
        matchLineValue(is.rows, is.periods[0]?.key ?? "", { conceptRegex: /NetIncomeLoss/i }) === null ||
        matchLineValue(is.rows, is.periods[0]?.key ?? "", {
          conceptRegex: /IncomeLossFromContinuingOperationsBeforeIncomeTaxes/i,
        }) === null ||
        matchLineValue(is.rows, is.periods[0]?.key ?? "", { conceptRegex: /IncomeTaxExpenseBenefit/i }) === null
      ) {
        return { canRun: false, skipReason: "Need net income, pretax income, and income tax lines" };
      }
      return { canRun: true };
    case 6: {
      if (!bs) return { canRun: false, skipReason: "No balance sheet on grid" };
      const pk = firstPeriodKey(bs);
      const hasLine =
        matchLineValue(bs.rows, pk, { conceptRegex: /AssetsCurrent$/i }) !== null ||
        matchLineValue(bs.rows, pk, { label: (t) => /^total\s+current\s+assets$/i.test(t) }) !== null;
      if (hasLine || calcHasParent(calcArcs, "AssetsCurrent")) return { canRun: true };
      return { canRun: false, skipReason: "No total current assets line and no _cal.xml AssetsCurrent parent" };
    }
    case 7: {
      if (!bs) return { canRun: false, skipReason: "No balance sheet on grid" };
      if (anyBalanceSheetPeriod(bs, (pk) => balanceSheetHasAssetsWalk(bs.rows, pk))) {
        return { canRun: true };
      }
      if (calcHasParent(calcArcs, "Assets")) return { canRun: true };
      const pk = firstBalanceSheetPeriodKey(bs);
      const hasCur =
        matchLineValue(bs.rows, pk, { conceptRegex: /AssetsCurrent$/i }) !== null ||
        matchLineValue(bs.rows, pk, { label: (t) => /^total\s+current\s+assets$/i.test(t) }) !== null ||
        calcHasParent(calcArcs, "AssetsCurrent");
      const hasTotal = balanceSheetTotalAssets(bs.rows, pk) !== null;
      if (hasCur && hasTotal) return { canRun: true };
      return {
        canRun: false,
        skipReason:
          "Need total current assets and total assets on the balance sheet (tag, “Assets” / “Total assets” label, or rows between them)",
      };
    }
    case 8: {
      if (!bs) return { canRun: false, skipReason: "No balance sheet on grid" };
      const pk = firstPeriodKey(bs);
      const hasCurLiab =
        matchLineValue(bs.rows, pk, { conceptRegex: /LiabilitiesCurrent$/i }) !== null ||
        matchLineValue(bs.rows, pk, { label: (t) => /^total\s+current\s+liabilities$/i.test(t) }) !== null;
      if (!hasCurLiab && !calcHasParent(calcArcs, "LiabilitiesCurrent")) {
        return { canRun: false, skipReason: "No total current liabilities and no _cal.xml LiabilitiesCurrent parent" };
      }
      return { canRun: true };
    }
    case 9: {
      if (!bs) return { canRun: false, skipReason: "No balance sheet on grid" };
      if (anyBalanceSheetPeriod(bs, (pk) => balanceSheetHasLiabilitiesWalk(bs.rows, pk))) {
        return { canRun: true };
      }
      if (calcHasParent(calcArcs, "Liabilities")) return { canRun: true };
      const pk = firstBalanceSheetPeriodKey(bs);
      const hasCur =
        matchLineValue(bs.rows, pk, { conceptRegex: /LiabilitiesCurrent$/i }) !== null ||
        matchLineValue(bs.rows, pk, { label: (t) => /^total\s+current\s+liabilities$/i.test(t) }) !== null ||
        calcHasParent(calcArcs, "LiabilitiesCurrent");
      const hasTotal = balanceSheetTotalLiabilities(bs.rows, pk) !== null;
      if (hasCur && hasTotal) return { canRun: true };
      return {
        canRun: false,
        skipReason:
          "Need total current liabilities and total liabilities on the balance sheet (tag, “Liabilities” label, or rows between them)",
      };
    }
    case 10: {
      if (!bs) return { canRun: false, skipReason: "No balance sheet on grid" };
      const pk = firstPeriodKey(bs);
      const hasLine =
        matchLineValue(bs.rows, pk, { conceptRegex: /StockholdersEquity$/i }) !== null ||
        matchLineValue(bs.rows, pk, { label: (t) => /total\s+(?:stockholders|shareholders).? equity/i.test(t) }) !== null;
      if (hasLine && rowsHavePresentationDepth(bs)) return { canRun: true };
      if (calcHasParent(calcArcs, "StockholdersEquity")) return { canRun: true };
      if (!hasLine) return { canRun: false, skipReason: "No total equity line on balance sheet" };
      return { canRun: false, skipReason: "Equity total found but presentation depth missing (need ≥2 components under equity)" };
    }
    case 11: {
      if (!bs) return { canRun: false, skipReason: "No balance sheet on grid" };
      const canIdentity = anyBalanceSheetPeriod(bs, (pk) => {
        const assets = balanceSheetTotalAssets(bs.rows, pk);
        const liabilities = balanceSheetTotalLiabilities(bs.rows, pk);
        const equity = balanceSheetTotalEquity(bs.rows, pk);
        return assets !== null && liabilities !== null && equity !== null;
      });
      if (canIdentity) return { canRun: true };
      const pk = firstBalanceSheetPeriodKey(bs);
      const assets = balanceSheetTotalAssets(bs.rows, pk);
      const liabilities = balanceSheetTotalLiabilities(bs.rows, pk);
      const equity = balanceSheetTotalEquity(bs.rows, pk);
      const missing: string[] = [];
      if (assets === null) missing.push("total assets");
      if (liabilities === null) missing.push("total liabilities");
      if (equity === null) missing.push("total equity");
      return { canRun: false, skipReason: `Need ${missing.join(", ")} on the balance sheet` };
    }
    case 12:
    case 13:
    case 14: {
      if (!cf) return { canRun: false, skipReason: "No cash flow statement on grid" };
      const section =
        checkId === 12 ? ("operating" as const) : checkId === 13 ? ("investing" as const) : ("financing" as const);
      const spec =
        checkId === 12
          ? {
              local: /NetCashProvidedByUsedInOperatingActivities/i,
              calc: "NetCashProvidedByUsedInOperatingActivities",
              label: /net cash (?:provided by|used in|from) operating activities/i,
              name: "operating",
            }
          : checkId === 13
            ? {
                local: /NetCashProvidedByUsedInInvestingActivities/i,
                calc: "NetCashProvidedByUsedInInvestingActivities",
                label: /net cash (?:provided by|used in|from) investing activities/i,
                name: "investing",
              }
            : {
                local: /NetCashProvidedByUsedInFinancingActivities/i,
                calc: "NetCashProvidedByUsedInFinancingActivities",
                label: /net cash (?:provided by|used in|from) financing activities/i,
                name: "financing",
              };
      const hasLineAnyPeriod = anyCashFlowPeriod(
        cf,
        (pk) =>
          matchLineValue(cf.rows, pk, { conceptRegex: spec.local }) !== null ||
          matchLineValue(cf.rows, pk, { label: (t) => spec.label.test(t) }) !== null
      );
      if (
        anyCashFlowPeriod(cf, (pk) => cashFlowCanRollupSection(cf.rows, pk, section)) ||
        (hasLineAnyPeriod && rowsHavePresentationDepth(cf)) ||
        calcHasParent(calcArcs, spec.calc)
      ) {
        return { canRun: true };
      }
      if (!hasLineAnyPeriod && !calcHasParent(calcArcs, spec.calc)) {
        return { canRun: false, skipReason: `No ${spec.name} activities total on cash flow statement` };
      }
      return {
        canRun: false,
        skipReason: `${spec.name} total found but not enough numeric lines above/between section totals on the face`,
      };
    }
    case 15: {
      if (!cf) return { canRun: false, skipReason: "No cash flow statement on grid" };
      if (anyCashFlowPeriod(cf, (pk) => resolveCashFlowActivityBridgeParts(cf.rows, pk) !== null)) {
        return { canRun: true };
      }
      const pk = firstCashFlowPeriodKey(cf);
      const missing: string[] = [];
      if (cashFlowNetOperating(cf.rows, pk) === null) missing.push("operating activities total");
      if (cashFlowNetInvesting(cf.rows, pk) === null) missing.push("investing activities total");
      if (cashFlowNetFinancing(cf.rows, pk) === null) missing.push("financing activities total");
      if (cashFlowNetChangeRow(cf.rows, pk) === null) missing.push("net change in cash");
      return {
        canRun: false,
        skipReason: `Need ${missing.join(", ")} (by XBRL tag or face label)`,
      };
    }
    default:
      return { canRun: false, skipReason: "Unknown check" };
  }
}

function issueMatchesCheck(checkId: number, issue: XbrlExportValidationIssue): boolean {
  const patterns = CHECK_ISSUE_PATTERNS[checkId] ?? [];
  return patterns.some((re) => re.test(issue.check));
}

function countPeriodsForCheck(
  checkId: number,
  stmts: ExportValidationStatement[],
  issues: XbrlExportValidationIssue[]
): { periodsChecked: number; periodsFailed: number } {
  const def = FIFTEEN_SELF_DIAGNOSTIC_CHECKS.find((c) => c.id === checkId)!;
  const stmt = stmtByKind(stmts, def.statement === "income_statement" ? "is" : def.statement === "balance_sheet" ? "bs" : "cf");
  const periodsChecked = stmt ? periodKeysWithData(stmt).length : 0;
  const failPeriods = new Set(
    issues.filter((i) => i.severity === "fail" && issueMatchesCheck(checkId, i)).map((i) => i.periodKey)
  );
  return { periodsChecked, periodsFailed: failPeriods.size };
}

/**
 * Build pass/fail/skipped status for all 15 canonical self-diagnostic tie-outs after validations run.
 */
export function buildSelfDiagnosticChecklist(
  stmts: ExportValidationStatement[],
  calcArcs: CalculationArcRow[],
  issues: XbrlExportValidationIssue[]
): SelfDiagnosticCheckResult[] {
  const failIssues = issues.filter((i) => i.severity === "fail");

  return FIFTEEN_SELF_DIAGNOSTIC_CHECKS.map((def) => {
    const probe = probeCanRunCheck(def.id, stmts, calcArcs);
    if (!probe.canRun) {
      return {
        ...def,
        status: "skipped" as const,
        skipReason: probe.skipReason,
        periodsChecked: 0,
        periodsFailed: 0,
      };
    }
    const { periodsChecked, periodsFailed } = countPeriodsForCheck(def.id, stmts, failIssues);
    const status: SelfDiagnosticCheckStatus = periodsFailed > 0 ? "fail" : "pass";
    return {
      ...def,
      status,
      periodsChecked,
      periodsFailed,
    };
  });
}

/** Run all validation suites, build the 15-check checklist, and warn on any check that could not run. */
export function runSelfDiagnosticValidations(
  stmts: ExportValidationStatement[],
  calcArcs: CalculationArcRow[],
  resolveValue: (concept: string, periodKey: string, kind: "is" | "bs" | "cf") => number | null,
  resolveCalculationRollupValue?: CalculationRollupResolver
): { validation: XbrlExportValidationIssue[]; checklist: SelfDiagnosticCheckResult[] } {
  const issues = runAllXbrlExportValidations(stmts, calcArcs, resolveValue, resolveCalculationRollupValue);
  const checklist = buildSelfDiagnosticChecklist(stmts, calcArcs, issues);
  return { validation: appendSkippedSelfDiagnosticWarnings(issues, checklist), checklist };
}

/** Attach warn issues for any of the 15 checks that could not run on this filing. */
export function appendSkippedSelfDiagnosticWarnings(
  issues: XbrlExportValidationIssue[],
  checklist: SelfDiagnosticCheckResult[]
): XbrlExportValidationIssue[] {
  const out = [...issues];
  for (const s of checklist.filter((c) => c.status === "skipped")) {
    out.push({
      statement: s.statement,
      periodKey: "_checklist",
      periodLabel: "All periods",
      severity: "warn",
      check: `Self-diagnostic #${s.id} not run: ${s.name}`,
      detail: s.skipReason ?? "Required tags or section lines missing on this filing.",
    });
  }
  return out;
}
