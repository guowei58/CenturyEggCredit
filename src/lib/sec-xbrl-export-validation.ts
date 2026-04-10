import type { CalculationArcRow } from "@/lib/sec-xbrl-calculation";

export type XbrlExportValidationIssue = {
  statement: "balance_sheet" | "income_statement" | "cash_flow" | "calculation";
  periodKey: string;
  periodLabel: string;
  severity: "fail" | "warn";
  check: string;
  detail: string;
  /** Absolute difference in USD (same units as raw XBRL facts). */
  absDeltaUsd?: number;
};

export type ExportValidationStatement = {
  kind: "is" | "bs" | "cf";
  periods: Array<{ key: string; shortLabel?: string; label: string }>;
  rows: Array<{ concept: string; values: Record<string, number | null> }>;
};

const STRUCT_TOL_USD = 2.5e6;
const CF_BRIDGE_TOL_USD = 5e6;

function periodLabel(periods: ExportValidationStatement["periods"], pk: string): string {
  const p = periods.find((x) => x.key === pk);
  return (p?.shortLabel?.trim() ? p.shortLabel : p?.label) ?? pk;
}

function fmtM(usd: number): string {
  return `${(usd / 1e6).toFixed(2)}M`;
}

function firstMatchValue(
  rows: ExportValidationStatement["rows"],
  pattern: RegExp,
  periodKey: string
): number | null {
  for (const r of rows) {
    if (!pattern.test(r.concept)) continue;
    const v = r.values[periodKey];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

function stmtByKind(stmts: ExportValidationStatement[], k: "is" | "bs" | "cf"): ExportValidationStatement | null {
  return stmts.find((s) => s.kind === k) ?? null;
}

function kindForConcept(stmts: ExportValidationStatement[], concept: string): "is" | "bs" | "cf" | null {
  for (const s of stmts) {
    if (s.rows.some((r) => r.concept === concept)) return s.kind;
  }
  return null;
}

export function runStructuralExportValidations(stmts: ExportValidationStatement[]): XbrlExportValidationIssue[] {
  const issues: XbrlExportValidationIssue[] = [];

  const bs = stmtByKind(stmts, "bs");
  if (bs) {
    for (const p of bs.periods) {
      const pk = p.key;
      const lab = periodLabel(bs.periods, pk);
      const assets = firstMatchValue(bs.rows, /:Assets$/i, pk);
      const leq = firstMatchValue(bs.rows, /LiabilitiesAndStockholdersEquity$/i, pk);
      if (assets !== null && leq !== null) {
        const d = Math.abs(assets - leq);
        if (d <= STRUCT_TOL_USD) continue;
        issues.push({
          statement: "balance_sheet",
          periodKey: pk,
          periodLabel: lab,
          severity: "fail",
          check: "Assets vs liabilities + equity",
          detail: `Mismatch: Assets ${fmtM(assets)} vs LiabilitiesAndStockholdersEquity ${fmtM(leq)} (Δ ${fmtM(d)}).`,
          absDeltaUsd: d,
        });
      }
    }
  }

  const is = stmtByKind(stmts, "is");
  if (is) {
    for (const p of is.periods) {
      const pk = p.key;
      const lab = periodLabel(is.periods, pk);
      const stated =
        firstMatchValue(is.rows, /:NetIncomeLoss$/i, pk) ??
        firstMatchValue(is.rows, /:ProfitLoss$/i, pk) ??
        firstMatchValue(is.rows, /NetIncomeLossAvailableToCommonStockholdersBasic/i, pk);
      const ebt =
        firstMatchValue(
          is.rows,
          /IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest$/i,
          pk
        ) ?? firstMatchValue(is.rows, /IncomeLossFromContinuingOperationsBeforeIncomeTaxes$/i, pk);
      const tax = firstMatchValue(is.rows, /:IncomeTaxExpenseBenefit$/i, pk);
      if (stated !== null && ebt !== null && tax !== null) {
        // SEC-style display: tax may appear as +expense or −expense depending on negated labels / instance.
        const dPlus = Math.abs(ebt + tax - stated);
        const dMinus = Math.abs(ebt - tax - stated);
        const d = Math.min(dPlus, dMinus);
        if (d <= STRUCT_TOL_USD) continue;
        issues.push({
          statement: "income_statement",
          periodKey: pk,
          periodLabel: lab,
          severity: "fail",
          check: "Net income vs EBT ± income tax (SEC-style display)",
          detail: `Neither EBT+tax nor EBT−tax ties NI within tolerance: EBT ${fmtM(ebt)}, tax ${fmtM(tax)}, NI ${fmtM(
            stated
          )} (best Δ ${fmtM(d)}).`,
          absDeltaUsd: d,
        });
      }
    }
  }

  const cf = stmtByKind(stmts, "cf");
  if (cf) {
    for (const p of cf.periods) {
      const pk = p.key;
      const lab = periodLabel(cf.periods, pk);
      const op = firstMatchValue(cf.rows, /NetCashProvidedByUsedInOperatingActivities/i, pk);
      const inv = firstMatchValue(cf.rows, /NetCashProvidedByUsedInInvestingActivities/i, pk);
      const fin = firstMatchValue(cf.rows, /NetCashProvidedByUsedInFinancingActivities/i, pk);
      const net =
        firstMatchValue(cf.rows, /CashCashEquivalentsPeriodIncreaseDecrease$/i, pk) ??
        firstMatchValue(cf.rows, /CashCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect$/i, pk) ??
        firstMatchValue(cf.rows, /CashAndCashEquivalentsPeriodIncreaseDecrease/i, pk);
      if (op !== null && inv !== null && fin !== null && net !== null) {
        const calc = op + inv + fin;
        const d = Math.abs(calc - net);
        if (d <= CF_BRIDGE_TOL_USD) continue;
        issues.push({
          statement: "cash_flow",
          periodKey: pk,
          periodLabel: lab,
          severity: "fail",
          check: "Operating + investing + financing vs net cash change",
          detail: `Mismatch: Op+Inv+Fin ${fmtM(calc)} vs net change ${fmtM(net)} (Δ ${fmtM(d)}; FX may explain).`,
          absDeltaUsd: d,
        });
      }
    }
  }

  return issues;
}

/**
 * Validates calculation linkbase rollups using the same numeric resolver as the exported grid
 * (SEC-style: instance + presentation negated labels).
 */
function calculationRoleLikelyFaceStatement(role: string): boolean {
  const u = role.toLowerCase();
  if (!u.trim()) return false;
  if (u.includes("disclosure") || u.includes("detail") || u.includes("documentdocument") || u.includes("schedule"))
    return false;
  return (
    u.includes("incomestatement") ||
    u.includes("statementofincome") ||
    u.includes("statementsofoperations") ||
    u.includes("statementofoperations") ||
    u.includes("balancesheet") ||
    u.includes("financialposition") ||
    u.includes("cashflow") ||
    u.includes("statementsofcashflow") ||
    u.includes("statementofcashflow")
  );
}

export function runCalculationRollupValidations(
  arcs: CalculationArcRow[],
  stmts: ExportValidationStatement[],
  resolveValue: (concept: string, periodKey: string, kind: "is" | "bs" | "cf") => number | null
): XbrlExportValidationIssue[] {
  if (!arcs.length || !stmts.length) return [];

  const faceArcs = arcs.filter((a) => calculationRoleLikelyFaceStatement(a.role));
  const useArcs = faceArcs.length > 0 ? faceArcs : arcs;

  const byParent = new Map<string, CalculationArcRow[]>();
  const seen = new Set<string>();
  for (const a of useArcs) {
    const dedupe = `${a.parentConcept}\t${a.childConcept}\t${a.weight}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const arr = byParent.get(a.parentConcept) ?? [];
    arr.push(a);
    byParent.set(a.parentConcept, arr);
  }

  const issues: XbrlExportValidationIssue[] = [];

  for (const [parent, children] of Array.from(byParent.entries())) {
    const parentKind = kindForConcept(stmts, parent);
    if (!parentKind) continue;

    const stmt = stmtByKind(stmts, parentKind);
    if (!stmt) continue;

    for (const p of stmt.periods) {
      const pk = p.key;
      const lab = periodLabel(stmt.periods, pk);
      const parentVal = resolveValue(parent, pk, parentKind);
      if (parentVal === null) continue;

      let sum = 0;
      let missingChild = false;
      for (const arc of children) {
        const ck = kindForConcept(stmts, arc.childConcept) ?? parentKind;
        const cv = resolveValue(arc.childConcept, pk, ck);
        if (cv === null) {
          missingChild = true;
          break;
        }
        sum += arc.weight * cv;
      }
      if (missingChild) continue;

      const tol = Math.max(2.5e6, Math.abs(parentVal) * 0.002);
      const d = Math.abs(sum - parentVal);
      if (d <= tol) continue;

      issues.push({
        statement: "calculation",
        periodKey: pk,
        periodLabel: lab,
        severity: "fail",
        check: `Calculation rollup: ${parent.split(":").pop() ?? parent}`,
        detail: `Σ weighted children ${fmtM(sum)} vs parent ${fmtM(parentVal)} (Δ ${fmtM(d)}; tol ${fmtM(tol)}).`,
        absDeltaUsd: d,
      });
    }
  }

  return issues;
}

export function runAllXbrlExportValidations(
  stmts: ExportValidationStatement[],
  calcArcs: CalculationArcRow[],
  resolveValue: (concept: string, periodKey: string, kind: "is" | "bs" | "cf") => number | null
): XbrlExportValidationIssue[] {
  return [...runStructuralExportValidations(stmts), ...runCalculationRollupValidations(calcArcs, stmts, resolveValue)];
}
