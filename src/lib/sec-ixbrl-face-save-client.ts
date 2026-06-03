/**
 * Browser helpers for TEST tab — HTML-first as-presented workbooks.
 */

import { buildAsPresentedStatementsWorkbook, workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import { faceStatementCellNumeric, type FaceStatementId } from "@/lib/sec-ixbrl-face-display";
import type { FacePresentedStatement, FaceStatementExtractionQa } from "@/lib/sec-ixbrl-face-extract";

export type FacePresentedFiling = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
};

export type FacePresentedStatementForSave = FacePresentedStatement;

export type SecIxbrlFacePresentedApiResponse = {
  ok?: boolean;
  error?: string;
  ticker?: string;
  cik?: string;
  companyName?: string;
  filings?: FacePresentedFiling[];
  selected?: { form: string; filingDate: string; accessionNumber: string };
  statements?: FacePresentedStatementForSave[];
  validation?: XbrlExportValidationIssue[];
  extractionQa?: FaceStatementExtractionQa[];
  calculationLinkbaseLoaded?: boolean;
  extractionMethod?: string;
};

function faceStatementId(stmt: FacePresentedStatement): FaceStatementId {
  return stmt.id as FaceStatementId;
}

/** Workbook rows use the same numeric resolver as the on-screen grid (no formatted strings). */
export function faceStatementToWorkbookShape(stmt: FacePresentedStatement) {
  const statementId = faceStatementId(stmt);
  return {
    title: `${stmt.title} (HTML face)`,
    role: stmt.role,
    periods: stmt.periods.map((p) => ({ key: p.key, label: p.label, shortLabel: p.shortLabel })),
    rows: stmt.rows.map((r) => ({
      concept:
        stmt.periods.map((p) => r.cellIxByPeriod[p.key]?.xbrlConcept).find(Boolean) ?? r.concept,
      label: r.label,
      depth: r.depth,
      preferredLabelRole: null,
      values: { ...r.values },
      rawValues: { ...r.rawValues },
      workbookCells: Object.fromEntries(
        stmt.periods.map((p) => {
          const n = faceStatementCellNumeric(r, p.key, statementId);
          const cell: number | "" = n !== null && Number.isFinite(n) ? n : "";
          return [p.key, cell] as const;
        })
      ) as Record<string, number | "">,
    })),
  };
}

export function triggerBrowserDownloadFacePresentedWorkbook(params: {
  ticker: string;
  companyName?: string;
  cik?: string;
  filing: FacePresentedFiling;
  statements: FacePresentedStatementForSave[];
  validation?: XbrlExportValidationIssue[];
  calculationLinkbaseLoaded?: boolean;
}): void {
  const wb = buildAsPresentedStatementsWorkbook({
    ticker: params.ticker,
    companyName: params.companyName,
    cik: params.cik,
    filing: params.filing,
    statements: params.statements.map(faceStatementToWorkbookShape),
    validation: params.validation,
    calculationLinkbaseLoaded: params.calculationLinkbaseLoaded,
    workbookGridCaption:
      "HTML face extraction — numeric cells match the TEST tab grid (faceStatementCellNumeric: $ millions, native EPS, share counts in millions of shares)",
  });
  const bytes = workbookToXlsxUint8Array(wb);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${params.ticker}_TEST-HTML-face_${params.filing.accessionNumber.replace(/-/g, "")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
