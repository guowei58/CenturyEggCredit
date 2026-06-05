/**
 * Browser helpers for TEST tab — HTML-first as-presented workbooks.
 */

import { compilerPeriodColumnHeader } from "@/lib/sec-xbrl-compiler-period-headers";
import { buildAsPresentedStatementsWorkbook, workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import { faceStatementCellNumeric, type FaceStatementId } from "@/lib/sec-ixbrl-face-display";
import type { FacePresentedStatement, FaceStatementExtractionQa } from "@/lib/sec-ixbrl-face-extract";

/** Short Excel tab names (31-char limit) so the Python compiler classifies sheets reliably. */
const FACE_COMPILER_SHEET_TITLE: Record<FaceStatementId, string> = {
  "income-statement": "Income Statement",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow",
};

export type FacePresentedFilingMeta = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument?: string;
};

export type FacePresentedFiling = FacePresentedFilingMeta & {
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
export function faceStatementToWorkbookShape(stmt: FacePresentedStatement, filing: FacePresentedFilingMeta) {
  const statementId = faceStatementId(stmt);
  return {
    title: FACE_COMPILER_SHEET_TITLE[statementId] ?? stmt.title,
    role: stmt.role,
    statementKind: statementId === "income-statement" ? "is" : statementId === "balance-sheet" ? "bs" : "cf",
    workbookValueScale: "face_millions" as const,
    periods: stmt.periods.map((p) => ({
      key: p.key,
      label: p.label,
      shortLabel: compilerPeriodColumnHeader(
        { label: p.label, shortLabel: p.shortLabel, end: p.end, start: p.start },
        filing.form
      ),
    })),
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

const FACE_WORKBOOK_GRID_CAPTION =
  "HTML face extraction — numeric cells match the TEST tab grid (faceStatementCellNumeric: $ millions, native EPS, share counts in millions of shares)";

export function buildFacePresentedStatementsWorkbook(params: {
  ticker: string;
  companyName?: string;
  cik?: string;
  filing: FacePresentedFilingMeta;
  statements: FacePresentedStatementForSave[];
  validation?: XbrlExportValidationIssue[];
  calculationLinkbaseLoaded?: boolean;
}) {
  return buildAsPresentedStatementsWorkbook({
    ticker: params.ticker,
    companyName: params.companyName,
    cik: params.cik,
    filing: params.filing,
    statements: params.statements.map((s) => faceStatementToWorkbookShape(s, params.filing)),
    validation: params.validation,
    calculationLinkbaseLoaded: params.calculationLinkbaseLoaded,
    workbookGridCaption: FACE_WORKBOOK_GRID_CAPTION,
  });
}

/** Save TEST-tab HTML-face workbooks to Saved Documents (compiler-ready filename slug). */
export async function saveFacePresentedStatementsXlsxToServer(
  tk: string,
  filing: { form: string; filingDate: string; accessionNumber: string },
  companyName: string | undefined,
  cik: string | undefined,
  statements: FacePresentedStatementForSave[],
  validation?: XbrlExportValidationIssue[],
  calculationLinkbaseLoaded?: boolean
): Promise<{ ok: true; filename?: string } | { ok: false; error: string }> {
  if (!statements.length) {
    return { ok: false, error: "No statements to export" };
  }
  try {
    const wb = buildFacePresentedStatementsWorkbook({
      ticker: tk,
      companyName,
      cik,
      filing,
      statements,
      validation,
      calculationLinkbaseLoaded,
    });
    const u8 = workbookToXlsxUint8Array(wb);
    const blob = new Blob([new Uint8Array(u8)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fd = new FormData();
    fd.append("action", "save-xbrl-as-presented-xlsx");
    fd.append("file", blob, "SEC-XBRL-financials.xlsx");
    fd.append("filingForm", filing.form);
    fd.append("filingDate", filing.filingDate);
    fd.append("accessionNumber", filing.accessionNumber);
    const res = await fetch(`/api/saved-documents/${encodeURIComponent(tk)}`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const j = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      item?: { filename?: string };
    } | null;
    if (!res.ok || j?.ok !== true) {
      return { ok: false, error: j?.error ?? `Save failed (HTTP ${res.status})` };
    }
    return { ok: true, filename: j.item?.filename };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
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
  const bytes = workbookToXlsxUint8Array(buildFacePresentedStatementsWorkbook(params));
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
