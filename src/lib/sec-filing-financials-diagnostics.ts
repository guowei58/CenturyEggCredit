import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import type { FilingHtmlStatement } from "@/lib/sec-filing-financials";
import { fetchHtmlFilingStatements, isLikelyCashRollupCrossReferenceToCashFlowStatement } from "@/lib/sec-filing-financials";
import {
  runSelfDiagnosticValidations,
  type SelfDiagnosticCheckResult,
} from "@/lib/sec-self-diagnostic-checklist";
import {
  buildBsCfStructuralDiagnosticsForShapeIssues,
  type ExportValidationStatement,
  type XbrlExportValidationIssue,
} from "@/lib/sec-xbrl-export-validation";

export type FilingFinancialsDiagnosticIssue = {
  accessionNumber: string;
  filingDate: string;
  form: string;
  issues: string[];
  summaries: Array<{ id: string; periods: string[]; firstRows: string[] }>;
  /** Failed structural / rollup checks with optional reconciliation math (XBRL as-presented only). */
  validationFailures?: XbrlExportValidationIssue[];
  /** All 15 canonical tie-outs: ran (pass/fail) or skipped with reason. */
  selfDiagnosticChecklist?: SelfDiagnosticCheckResult[];
  /**
   * BS / CF structural math when only **shape** heuristics fire (so there is no row in `validationFailures`).
   * Same issue shape as rollup failures — use for reconciliation tables in the UI.
   */
  statementStructureDiagnostics?: XbrlExportValidationIssue[];
};

export type FilingFinancialsDiagnosticsResult = {
  ticker: string;
  checked: number;
  suspicious: number;
  failures: FilingFinancialsDiagnosticIssue[];
  /** When set, only filings with `filingDate` in this calendar year or later were checked. */
  minFilingYear?: number;
  /** Cap passed to SEC submissions fetch (newest-first); raise if a heavy filer truncates history. */
  maxFilingsRequested?: number;
};

/**
 * Minimal statement grid used by heuristic checks (SEC HTML tables or XBRL as-presented).
 * IDs follow the HTML extractor: `income-statement` | `balance-sheet` | `cash-flow`.
 */
export type FinancialStatementDiagnosticShape = {
  id: string;
  rows: Array<{ label: string }>;
  periods: readonly unknown[];
};

function rowLabels(stmt: FinancialStatementDiagnosticShape, count = 8): string[] {
  return stmt.rows.slice(0, count).map((row) => row.label);
}

function htmlStatementsToExport(statements: FilingHtmlStatement[]): ExportValidationStatement[] {
  return statements.map((stmt) => {
    let kind: "is" | "bs" | "cf" = "is";
    if (stmt.id === "balance-sheet") kind = "bs";
    else if (stmt.id === "cash-flow") kind = "cf";
    return {
      kind,
      periods: stmt.periods.map((p) => ({ key: p.key, shortLabel: p.shortLabel, label: p.label })),
      rows: stmt.rows.map((r) => ({
        concept: r.concept,
        values: r.values,
        label: r.label,
      })),
    };
  });
}

function hasAny(texts: string[], patterns: RegExp[]): boolean {
  return texts.some((text) => patterns.some((re) => re.test(text)));
}

function hasCoreIncomeStatementCues(stmt: FinancialStatementDiagnosticShape): boolean {
  const scanDepth = Math.min(stmt.rows.length, 48);
  const topRows = stmt.rows.slice(0, scanDepth).map((row) => row.label);
  const broadCues = [
    /\brevenues?\b/i,
    /\btotal revenues?\b/i,
    /\bnet sales\b/i,
    /\btotal net sales\b/i,
    /\bcost of revenue\b/i,
    /\bcost of sales\b/i,
    /\bcost of goods sold\b/i,
    /\bgross profit\b/i,
    /\boperating earnings?\b/i,
    /\bearnings before income tax\b/i,
    /\bincome before income taxes?\b/i,
    /\bnet earnings?\b/i,
    /\bnet income\b/i,
    /\bnet loss\b/i,
    /\bloss from operations\b/i,
    /\btotal interest income\b/i,
    /\bnet interest income\b/i,
    /\bnon-?interest income\b/i,
    /\binterest expense\b/i,
    /\bprovision(?: \(benefit\))? for credit losses?\b/i,
  ];
  if (hasAny(topRows, broadCues)) return true;

  const industrialCue =
    hasAny(topRows, [/\bproducts\b/i, /\bservices\b/i]) &&
    hasAny(topRows, [/\boperating costs? and expenses?\b/i, /\boperating earnings?\b/i, /\bnet earnings?\b/i]);
  if (industrialCue) return true;

  const bankCue =
    hasAny(topRows, [/\btotal interest income\b/i, /\binterest expense\b/i]) &&
    hasAny(topRows, [/\bnet income\b/i, /\bnet earnings?\b/i, /\bincome before income taxes?\b/i]);
  if (bankCue) return true;

  const assetManagerFeeCue =
    hasAny(topRows, [/\bmanagement fees\b/i, /\bmanagement fees?,?\s*net\b/i, /\badvisory and transaction fees\b/i, /\badvisory fees\b/i]);
  const assetManagerActivityCue = hasAny(topRows, [
    /\binvestment income \(loss\)/i,
    /\binvestment income\b/i,
    /\bperformance revenues?\b/i,
    /\bincentive fees\b/i,
    /\bretirement services\b/i,
    /\btotal revenues?,?\s*net\b/i,
    /\bproperty management\b/i,
    /\bconsolidated net income\b/i,
    /\bnet income \(loss\)/i,
  ]);
  if (assetManagerFeeCue && assetManagerActivityCue) return true;

  return false;
}

function hasCoreBalanceSheetCues(stmt: FinancialStatementDiagnosticShape): boolean {
  const scanDepth = Math.min(stmt.rows.length, 24);
  const topRows = stmt.rows.slice(0, scanDepth).map((row) => row.label);
  const broadCues = [
    /\bcash and cash equivalents\b/i,
    /\bcash and equivalents\b/i,
    /\bcurrent assets\b/i,
    /^\s*assets\s*$/i,
    /\btotal assets\b/i,
    /\baccounts receivable\b/i,
    /\breceivables?\b/i,
    /\binventory\b/i,
    /\bmarketable securities\b/i,
    /\bshort-?term investments?\b/i,
    /\bgoodwill\b/i,
    /\bright[- ]of[- ]use assets?\b/i,
    /\bproperty, plant and equipment\b/i,
    /\bproperty and equipment\b/i,
    /\breal estate held for investment\b/i,
    /\bbuildings and improvements\b/i,
    /\btenant improvements\b/i,
  ];
  if (hasAny(topRows, broadCues)) return true;

  /* Consolidated BS fragments that omit the asset block (classic multi‑column HTML chops). */
  const liabilityEquityTailCue =
    hasAny(topRows, [/\btotal liabilities\b/i, /\b(non-)?current liabilities\b/i]) &&
    hasAny(topRows, [
      /\bshareholders?'?\s+equity\b/i,
      /\bstockholders?'?\s+equity\b/i,
      /\bretained earnings\b/i,
      /\bcommitments and contingencies\b/i,
    ]);
  if (liabilityEquityTailCue) return true;

  const reitCue =
    hasAny(topRows, [/\bland\b/i, /\bbuildings and improvements\b/i]) &&
    hasAny(topRows, [/\btenant improvements\b/i, /\btotal real estate held for investment\b/i]);
  return reitCue;
}

function hasCoreCashFlowCues(stmt: FinancialStatementDiagnosticShape): boolean {
  const scanDepth = Math.min(stmt.rows.length, 48);
  const topRows = stmt.rows.slice(0, scanDepth).map((row) => row.label);
  const broadCues = [
    /\bnet income\b/i,
    /\bnet earnings?\b/i,
    /\bnet loss\b/i,
    /\boperating activities\b/i,
    /\boperating cash flow\b/i,
    /\bnet cash provided by\b/i,
    /\bnet cash used in\b/i,
    /\bnet cash\b/i,
    /\bdepreciation\b/i,
    /\binvesting activities\b/i,
    /\bfinancing activities\b/i,
  ];
  if (hasAny(topRows, broadCues)) return true;

  const operatingCashReconcileCue =
    hasAny(topRows, [/\bnet earnings?\b/i, /\bnet income\b/i, /\bnet loss\b/i]) &&
    hasAny(topRows, [/\badjustments to reconcile .* operating cash flow\b/i, /\badjustments to reconcile .* operating activities\b/i]);
  return operatingCashReconcileCue;
}

function isLikelyCondensedCashFlowSummary(stmt: FinancialStatementDiagnosticShape): boolean {
  const labels = rowLabels(stmt, 8).map((l) => l.toLowerCase());
  const activityHits = labels.filter(
    (l) =>
      /\boperating activities\b/i.test(l) ||
      /\binvesting activities\b/i.test(l) ||
      /\bfinancing activities\b/i.test(l)
  ).length;
  return activityHits >= 3;
}

function looksLikeWrongStatementDataInCashFlowRow(label: string): boolean {
  const t = label.toLowerCase();
  if (/changes?\s+in\s+current\s+assets\b/.test(t)) return false;
  if (/changes?\s+in\s+current\s+liabilit/.test(t)) return false;
  if (/changes?\s+in\s+operating\s+assets\b/.test(t)) return false;
  if (/changes?\s+in\s+operating\s+liabilit/.test(t)) return false;
  if (/\btotal assets\b/.test(t)) return true;
  if (/\bcurrent assets\b/.test(t)) return true;
  if (/\btotal revenues?\b/.test(t)) return true;
  if (/\btotal net sales\b/.test(t)) return true;
  if (/\bgross profit\b/.test(t)) return true;
  return false;
}

function looksLikeIncomeStatementInBalanceSheetRow(label: string): boolean {
  const t = label.toLowerCase();
  if (/\bgross profit\b/i.test(t) || /\bgross margin\b/i.test(t)) return true;
  if (/\bnet loss\b/i.test(t)) return true;
  if (/\b(total\s+)?revenues?\s*,?\s*net\b/i.test(t) || /\btotal\s+revenues?\b/i.test(t)) return true;
  if (/\boperating (revenue|income)\b/i.test(t)) return true;
  if (/\bcost of (goods sold|revenue)\b/i.test(t)) return true;
  return false;
}

/** Heuristic checks that the grid looks like the intended primary statement. */
export function validateStatementShape(stmt: FinancialStatementDiagnosticShape, form: string): string[] {
  const issues: string[] = [];
  const topRows = rowLabels(stmt, 8);
  const topRowsShort = rowLabels(stmt, 5);

  /* Condensed cash flows often omit a separate FX / supplemental line — three net buckets
     (operating / investing / financing) plus net change can be exactly four rows (e.g. some 10-Ks). */
  const minRows =
    stmt.id === "cash-flow" && isLikelyCondensedCashFlowSummary(stmt) ? 4 : 6;
  if (stmt.rows.length < minRows) issues.push(`${stmt.id}: too few rows (${stmt.rows.length})`);
  if (stmt.periods.length === 0) issues.push(`${stmt.id}: no periods parsed`);

  if (stmt.id === "income-statement") {
    if (!hasCoreIncomeStatementCues(stmt)) {
      issues.push(`${stmt.id}: missing core income-statement cues`);
    }
    if (hasAny(topRowsShort, [/\bworking\b/i, /\btotal assets\b/i, /\blong-term obligations\b/i])) {
      issues.push(`${stmt.id}: top rows look like balance-sheet or summary data`);
    }
    if (form === "10-K" && stmt.periods.length < 2) issues.push(`${stmt.id}: annual statement has too few periods`);
  }

  if (stmt.id === "balance-sheet") {
    if (!hasCoreBalanceSheetCues(stmt)) {
      issues.push(`${stmt.id}: missing core balance-sheet cues`);
    }
    if (topRowsShort.some((row) => looksLikeIncomeStatementInBalanceSheetRow(row))) {
      issues.push(`${stmt.id}: top rows look like income-statement data`);
    }
    if (stmt.periods.length < 2) issues.push(`${stmt.id}: balance sheet has too few periods`);
    if (isLikelyCashRollupCrossReferenceToCashFlowStatement(stmt.rows.map((r) => r.label).join("\n"))) {
      issues.push(`${stmt.id}: cash reconciliation footnote to consolidated statement of cash flows (wrong table)`);
    }
  }

  if (stmt.id === "cash-flow") {
    if (!hasCoreCashFlowCues(stmt)) {
      issues.push(`${stmt.id}: missing core cash-flow cues`);
    }
    if (isLikelyCashRollupCrossReferenceToCashFlowStatement(stmt.rows.map((r) => r.label).join("\n"))) {
      issues.push(`${stmt.id}: cash reconciliation footnote to consolidated statement of cash flows (wrong table)`);
    }
    if (topRowsShort.some((row) => looksLikeWrongStatementDataInCashFlowRow(row))) {
      issues.push(`${stmt.id}: top rows look like another statement`);
    }
    if (form === "10-K" && stmt.periods.length < 2) issues.push(`${stmt.id}: annual cash flow has too few periods`);
  }

  return issues;
}

export function __test_validateStatementShape(stmt: FilingHtmlStatement, form: string): string[] {
  return validateStatementShape(stmt, form);
}

/** Primary doc is plaintext (pre‑XBRL decade); HTML statement extraction is unsupported. */
function isPlaintextPrimaryFiling(primaryDocument: string): boolean {
  return /\.txt$/i.test((primaryDocument ?? "").trim());
}

export async function runSecFilingFinancialsDiagnostics(
  ticker: string,
  maxFilings = 30
): Promise<FilingFinancialsDiagnosticsResult> {
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) throw new Error("Ticker required");
  const res = await getAllFilingsByTicker(sym, { includeForms: ["10-K", "10-Q"], maxFilings });
  if (!res) throw new Error(`Ticker not found: ${sym}`);

  const filings = res.filings;
  const failures: FilingFinancialsDiagnosticIssue[] = [];

  for (const filing of filings) {
    try {
      const statements = await fetchHtmlFilingStatements({
        cik: res.cik,
        accessionNumber: filing.accessionNumber,
        primaryDocument: filing.primaryDocument,
        form: filing.form,
        docUrl: filing.docUrl,
      });

      const issues: string[] = [];
      if (statements.length !== 3) {
        if (statements.length === 0 && isPlaintextPrimaryFiling(filing.primaryDocument)) {
          /* Skip — not an HTML financials pick issue. */
        } else {
          issues.push(`expected 3 statements, got ${statements.length}`);
        }
      }
      for (const stmt of statements) issues.push(...validateStatementShape(stmt, filing.form));

      let validationFailures: XbrlExportValidationIssue[] | undefined;
      let selfDiagnosticChecklist: SelfDiagnosticCheckResult[] | undefined;
      let statementStructureDiagnostics: FilingFinancialsDiagnosticIssue["statementStructureDiagnostics"];
      if (statements.length) {
        const exportStmts = htmlStatementsToExport(statements);
        const { validation, checklist } = runSelfDiagnosticValidations(exportStmts, [], (concept, periodKey, kind) => {
          const stmt = exportStmts.find((s) => s.kind === kind);
          const row = stmt?.rows.find((r) => r.concept === concept);
          const v = row?.values[periodKey];
          return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
        });
        selfDiagnosticChecklist = checklist;
        const failValidations = validation.filter((v) => v.severity === "fail");
        if (failValidations.length > 0) {
          issues.push(
            `Statement tie-outs failed ${failValidations.length} structural / rollup check(s) for this filing`
          );
          validationFailures = failValidations;
        }
        const wantsBsMath = issues.some((x) => x.startsWith("balance-sheet:"));
        const wantsCfMath = issues.some((x) => x.startsWith("cash-flow:"));
        if (wantsBsMath || wantsCfMath) {
          const extra = buildBsCfStructuralDiagnosticsForShapeIssues(
            exportStmts,
            { balanceSheet: wantsBsMath, cashFlow: wantsCfMath },
            failValidations
          );
          if (extra.length) statementStructureDiagnostics = extra;
        }
      }

      if (issues.length > 0) {
        failures.push({
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          form: filing.form,
          issues,
          summaries: statements.map((stmt) => ({
            id: stmt.id,
            periods: stmt.periods.map((p) => p.label),
            firstRows: rowLabels(stmt, 6),
          })),
          validationFailures,
          selfDiagnosticChecklist,
          statementStructureDiagnostics,
        });
      }
    } catch (error) {
      failures.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        issues: [error instanceof Error ? error.message : "unknown extraction error"],
        summaries: [],
      });
    }
  }

  return {
    ticker: sym,
    checked: filings.length,
    suspicious: failures.length,
    failures,
  };
}
