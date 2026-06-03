import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import {
  fetchFacePresentedStatements,
  type FacePresentedStatement,
  type FaceStatementExtractionQa,
} from "@/lib/sec-ixbrl-face-extract";
import {
  validateStatementShape,
  type FinancialStatementDiagnosticShape,
} from "@/lib/sec-filing-financials-diagnostics";
import {
  updatePrimaryFaceShapeTemplatesFromStatements,
  type PrimaryFaceShapeTemplates,
} from "@/lib/sec-filing-financials-shape-templates";

const REQUIRED_STATEMENT_IDS = ["income-statement", "balance-sheet", "cash-flow"] as const;

export type TestFaceDiagnosticFailure = {
  accessionNumber: string;
  filingDate: string;
  form: string;
  isInlineXbrl: boolean;
  issues: string[];
  summaries: Array<{ id: string; periods: string[]; firstRows: string[] }>;
  extractionQa?: FaceStatementExtractionQa[];
};

export type TestFaceDiagnosticsResult = {
  ticker: string;
  checked: number;
  suspicious: number;
  minFilingYear?: number;
  maxFilingsRequested?: number;
  /** Earliest 10-Q in the sweep whose primary HTML contains inline XBRL tags. */
  firstInlineXbrlQuarter: {
    filingDate: string;
    form: string;
    accessionNumber: string;
  } | null;
  failures: TestFaceDiagnosticFailure[];
};

export type RunTestFaceDiagnosticsOptions = {
  maxFilings?: number;
  /** Inclusive lower bound on `filingDate` calendar year (e.g. current year − 20). */
  minFilingYear?: number;
};

function normalizeDiagnosticsArgs(
  maxFilingsOrOpts: number | RunTestFaceDiagnosticsOptions
): { maxFilings: number; minFilingYear?: number } {
  if (typeof maxFilingsOrOpts === "number") {
    return { maxFilings: maxFilingsOrOpts };
  }
  return {
    maxFilings: maxFilingsOrOpts.maxFilings ?? 30,
    minFilingYear: maxFilingsOrOpts.minFilingYear,
  };
}

function faceToDiagnosticShape(stmt: FacePresentedStatement): FinancialStatementDiagnosticShape {
  return {
    id: stmt.id,
    rows: stmt.rows.map((r) => ({ label: r.label })),
    periods: stmt.periods,
  };
}

function rowLabels(stmt: FacePresentedStatement, count = 6): string[] {
  return stmt.rows.slice(0, count).map((r) => r.label);
}

function isPlaintextPrimaryFiling(primaryDocument: string): boolean {
  return /\.txt$/i.test((primaryDocument ?? "").trim());
}

function validateInlineIxTagCoverage(extractionQa: FaceStatementExtractionQa[]): string[] {
  const issues: string[] = [];
  for (const qa of extractionQa) {
    if (qa.numericCells === 0) continue;
    if (qa.untaggedNumericCells > 0) {
      issues.push(
        `${qa.statementId}: ${qa.untaggedNumericCells} numeric cell(s) missing inline XBRL tags (${qa.taggedCells}/${qa.numericCells} tagged)`
      );
    }
  }
  const totalNumeric = extractionQa.reduce((sum, qa) => sum + qa.numericCells, 0);
  const totalUntagged = extractionQa.reduce((sum, qa) => sum + qa.untaggedNumericCells, 0);
  if (totalNumeric > 0 && totalUntagged > 0) {
    issues.push(
      `inline XBRL filing: ${totalUntagged} untagged numeric cell(s) across primary statements (${totalNumeric - totalUntagged}/${totalNumeric} tagged)`
    );
  }
  return issues;
}

function pickEarliestQuarter(
  candidates: Array<{ filingDate: string; form: string; accessionNumber: string }>
): TestFaceDiagnosticsResult["firstInlineXbrlQuarter"] {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => a.filingDate.localeCompare(b.filingDate))[0] ?? null;
}

/**
 * TEST tab batch self-check: HTML-face primary statements (IS / BS / CF), inline XBRL tag coverage,
 * and earliest 10-Q with inline XBRL in the filing window.
 */
export async function runTestFaceDiagnostics(
  ticker: string,
  maxFilingsOrOpts: number | RunTestFaceDiagnosticsOptions = 30
): Promise<TestFaceDiagnosticsResult> {
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

  /** Newest-first so trusted row-shape templates bootstrap from the latest clean filing. */
  filings = [...filings].sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  const failures: TestFaceDiagnosticFailure[] = [];
  const inlineXbrlQuarters: Array<{ filingDate: string; form: string; accessionNumber: string }> = [];
  const shapeTemplates: PrimaryFaceShapeTemplates = {};

  for (const filing of filings) {
    try {
      if (isPlaintextPrimaryFiling(filing.primaryDocument)) continue;

      const payload = await fetchFacePresentedStatements({
        cik: res.cik,
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        filingDate: filing.filingDate,
        primaryDocument: filing.primaryDocument,
        docUrl: filing.docUrl,
        shapeTemplates,
      });

      const { statements, extractionQa, inlineIxDetected } = payload;
      const issues: string[] = [];

      const ids = new Set(statements.map((s) => s.id));
      for (const id of REQUIRED_STATEMENT_IDS) {
        if (!ids.has(id)) issues.push(`missing ${id.replace(/-/g, " ")}`);
      }
      if (statements.length !== 3) {
        issues.push(`expected 3 primary statements (IS / BS / CF), got ${statements.length}`);
      }

      for (const stmt of statements) {
        issues.push(...validateStatementShape(faceToDiagnosticShape(stmt), filing.form));
      }

      if (inlineIxDetected) {
        issues.push(...validateInlineIxTagCoverage(extractionQa));
        if (filing.form === "10-Q") {
          inlineXbrlQuarters.push({
            filingDate: filing.filingDate,
            form: filing.form,
            accessionNumber: filing.accessionNumber,
          });
        }
      }

      if (issues.length > 0) {
        failures.push({
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          form: filing.form,
          isInlineXbrl: inlineIxDetected,
          issues,
          summaries: statements.map((stmt) => ({
            id: stmt.id,
            periods: stmt.periods.map((p) => p.label),
            firstRows: rowLabels(stmt, 6),
          })),
          extractionQa: inlineIxDetected ? extractionQa : undefined,
        });
      } else if (statements.length === 3) {
        Object.assign(
          shapeTemplates,
          updatePrimaryFaceShapeTemplatesFromStatements(statements, shapeTemplates, filing.filingDate)
        );
      }
    } catch (error) {
      failures.push({
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        isInlineXbrl: false,
        issues: [error instanceof Error ? error.message : "unknown extraction error"],
        summaries: [],
      });
    }
  }

  return {
    ticker: sym,
    checked: filings.length,
    suspicious: failures.length,
    minFilingYear,
    maxFilingsRequested: maxFilings,
    firstInlineXbrlQuarter: pickEarliestQuarter(inlineXbrlQuarters),
    failures,
  };
}

export function __test_validateInlineIxTagCoverage(qa: FaceStatementExtractionQa[]): string[] {
  return validateInlineIxTagCoverage(qa);
}
