import {
  fetchAsPresentedStatements,
  SEC_XBRL_FILING_NO_XBRL_ARTIFACTS_MESSAGE,
  type PresentedStatement,
} from "@/lib/sec-xbrl-as-presented";
import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import {
  buildBsCfStructuralDiagnosticsForShapeIssues,
  type ExportValidationStatement,
} from "@/lib/sec-xbrl-export-validation";
import { incomeStatementValuesForExport } from "@/lib/sec-xbrl-income-statement-numeric";
import {
  validateStatementShape,
  type FinancialStatementDiagnosticShape,
  type FilingFinancialsDiagnosticIssue,
  type FilingFinancialsDiagnosticsResult,
} from "@/lib/sec-filing-financials-diagnostics";

function presentedStatementsToExport(statements: PresentedStatement[]): ExportValidationStatement[] {
  return statements.map((s) => {
    let kind: "is" | "bs" | "cf" = "is";
    if (s.id === "primary-cf") kind = "cf";
    else if (s.id === "primary-bs") kind = "bs";
    const periodKeys = s.periods.map((p) => p.key);
    return {
      kind,
      periods: s.periods.map((p) => ({ key: p.key, shortLabel: p.shortLabel, label: p.label })),
      rows: s.rows.map((r) => ({
        concept: r.concept,
        values: kind === "is" ? incomeStatementValuesForExport(r, periodKeys) : r.values,
        label: r.label,
        depth: r.depth,
      })),
    };
  });
}

function presentedToDiagnosticShape(stmt: PresentedStatement): FinancialStatementDiagnosticShape {
  const id =
    stmt.id === "primary-is"
      ? "income-statement"
      : stmt.id === "primary-bs"
        ? "balance-sheet"
        : stmt.id === "primary-cf"
          ? "cash-flow"
          : stmt.id;
  return {
    id,
    rows: stmt.rows.map((r) => ({ label: r.label })),
    periods: stmt.periods,
  };
}

function diagnosticSummaries(statements: PresentedStatement[]): FilingFinancialsDiagnosticIssue["summaries"] {
  return statements.map((stmt) => ({
    id: `${stmt.id} · ${stmt.title}`,
    periods: stmt.periods.map((p) => (p.shortLabel?.trim() ? p.shortLabel : p.label)),
    firstRows: stmt.rows.slice(0, 6).map((r) => r.label),
  }));
}

export type RunSecXbrlAsPresentedDiagnosticsOptions = {
  maxFilings?: number;
  /** Inclusive lower bound on `filingDate` calendar year (e.g. current year − 20). */
  minFilingYear?: number;
};

function normalizeDiagnosticsArgs(
  maxFilingsOrOpts: number | RunSecXbrlAsPresentedDiagnosticsOptions,
): { maxFilings: number; minFilingYear?: number } {
  if (typeof maxFilingsOrOpts === "number") {
    return { maxFilings: maxFilingsOrOpts };
  }
  return {
    maxFilings: maxFilingsOrOpts.maxFilings ?? 30,
    minFilingYear: maxFilingsOrOpts.minFilingYear,
  };
}

/**
 * After this filing date, domestic accelerated issuers were generally expected to ship Interactive Data
 * (instance + linkbases / viewer) with periodic reports. Earlier filings often have no XBRL in EDGAR index —
 * not actionable for this diagnostic.
 */
const INTERACTIVE_DATA_CUSTOMARILY_EXPECTED_SINCE_FILING_DATE = "2011-06-15";

function parseFilingDateMs(filingDate: string): number | null {
  const t = (filingDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const ms = Date.parse(`${t}T12:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isNoXbrlArtifactsInIndexMessage(message: string): boolean {
  const m = (message ?? "").trim();
  if (m === SEC_XBRL_FILING_NO_XBRL_ARTIFACTS_MESSAGE) return true;
  const low = m.toLowerCase();
  return (
    low.includes("could not pick a filing artifact") &&
    low.includes("no linkbases") &&
    low.includes("instance") &&
    low.includes("xbrl") &&
    low.includes("zip")
  );
}

function shouldSkipLegacyMissingXbrlArtifactFailure(filingDate: string, message: string): boolean {
  if (!isNoXbrlArtifactsInIndexMessage(message)) return false;
  const fd = parseFilingDateMs(filingDate);
  const cutoff = parseFilingDateMs(INTERACTIVE_DATA_CUSTOMARILY_EXPECTED_SINCE_FILING_DATE);
  if (fd === null || cutoff === null) return false;
  return fd < cutoff;
}

/**
 * Batch self-check: for each filing, load primary XBRL as-presented statements and apply the same
 * shape heuristics as SEC Filing Financials (HTML), plus XBRL rollup / structural validation counts.
 *
 * @param maxFilingsOrOpts Pass a number (max filings to pull from SEC, newest-first) or an options object with
 *   {@link RunSecXbrlAsPresentedDiagnosticsOptions.maxFilings} (default 30) and optional {@link RunSecXbrlAsPresentedDiagnosticsOptions.minFilingYear}
 *   to restrict by `filingDate` calendar year (e.g. rolling 20-year window).
 */
export async function runSecXbrlAsPresentedDiagnostics(
  ticker: string,
  maxFilingsOrOpts: number | RunSecXbrlAsPresentedDiagnosticsOptions = 30,
): Promise<FilingFinancialsDiagnosticsResult> {
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) throw new Error("Ticker required");
  const { maxFilings, minFilingYear } = normalizeDiagnosticsArgs(maxFilingsOrOpts);

  const res = await getAllFilingsByTicker(sym, {
    includeForms: ["10-K", "10-Q"],
    maxFilings,
    mergePredecessorIssuers: true,
  });
  if (!res) throw new Error(`Ticker not found: ${sym}`);

  let filings = res.filings;
  if (minFilingYear != null) {
    filings = filings.filter((f) => {
      const y = parseInt((f.filingDate ?? "").slice(0, 4), 10);
      return Number.isFinite(y) && y >= minFilingYear;
    });
  }

  const failures: FilingFinancialsDiagnosticIssue[] = [];

  for (const filing of filings) {
    try {
      const payload = await fetchAsPresentedStatements({
        cik: res.cik,
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        filingDate: filing.filingDate,
      });
      const { statements, validation = [] } = payload;

      const failValidations = validation.filter((v) => v.severity === "fail");

      const issues: string[] = [];
      if (statements.length !== 3) {
        issues.push(`expected 3 primary statements (is / bs / cf), got ${statements.length}`);
      }

      for (const stmt of statements) {
        issues.push(...validateStatementShape(presentedToDiagnosticShape(stmt), filing.form));
      }

      const rollupFails = failValidations.length;
      if (rollupFails > 0) {
        issues.push(`XBRL display grid failed ${rollupFails} structural / rollup check(s) for this filing`);
      }

      if (issues.length > 0) {
        const wantsBsMath = issues.some((x) => x.startsWith("balance-sheet:"));
        const wantsCfMath = issues.some((x) => x.startsWith("cash-flow:"));
        let statementStructureDiagnostics: FilingFinancialsDiagnosticIssue["statementStructureDiagnostics"];
        if ((wantsBsMath || wantsCfMath) && statements.length) {
          const exportStmts = presentedStatementsToExport(statements);
          const extra = buildBsCfStructuralDiagnosticsForShapeIssues(
            exportStmts,
            { balanceSheet: wantsBsMath, cashFlow: wantsCfMath },
            failValidations,
          );
          if (extra.length) statementStructureDiagnostics = extra;
        }

        failures.push({
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          form: filing.form,
          issues,
          summaries: diagnosticSummaries(statements),
          validationFailures: failValidations.length ? failValidations : undefined,
          selfDiagnosticChecklist: payload.selfDiagnosticChecklist,
          statementStructureDiagnostics,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown XBRL load error";
      if (shouldSkipLegacyMissingXbrlArtifactFailure(filing.filingDate, msg)) {
        continue;
      }
      failures.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        issues: [msg],
        summaries: [],
      });
    }
  }

  return {
    ticker: sym,
    checked: filings.length,
    suspicious: failures.length,
    failures,
    ...(minFilingYear != null ? { minFilingYear } : {}),
    maxFilingsRequested: maxFilings,
  };
}
