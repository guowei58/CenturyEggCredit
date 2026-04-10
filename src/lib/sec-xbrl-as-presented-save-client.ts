/**
 * Browser-only helpers for SEC as-presented workbook export (shared by SEC XBRL tab and Historical → The BAD).
 */

import { buildAsPresentedStatementsWorkbook, workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

export type PresentedFiling = { form: string; filingDate: string; accessionNumber: string; primaryDocument: string };

export type PresentedStatementForSave = {
  id: string;
  title: string;
  role: string;
  periods: Array<{ key: string; label: string; shortLabel?: string; end: string; start: string | null }>;
  rows: Array<{
    concept: string;
    label: string;
    depth: number;
    preferredLabelRole: string | null;
    values: Record<string, number | null>;
    rawValues: Record<string, number | null>;
    normalizationByPeriod?: Record<string, { rule: string; confidence: string } | null>;
  }>;
};

export type SecXbrlAsPresentedApiResponse = {
  ok?: boolean;
  error?: string;
  ticker?: string;
  cik?: string;
  companyName?: string;
  filings?: PresentedFiling[];
  selected?: { form: string; filingDate: string; accessionNumber: string };
  statements?: PresentedStatementForSave[];
  validation?: XbrlExportValidationIssue[];
  calculationLinkbaseLoaded?: boolean;
};

export function normalizeAccessionKey(a: string): string {
  return (a ?? "").replace(/-/g, "").trim().toLowerCase();
}

/** Drop period columns where only a tiny fraction of lines have facts (one-off tags); keeps consolidation-focused grids readable. */
const SPARSE_PERIOD_MIN_LINE_FILL_RATIO = 0.05;

export function visiblePeriodsForAsPresentedStatement(stmt: PresentedStatementForSave): PresentedStatementForSave["periods"] {
  const { periods, rows } = stmt;
  const n = rows.length;
  if (n === 0 || periods.length === 0) return periods;

  const kept = periods.filter((p) => {
    let withValue = 0;
    for (const r of rows) {
      const v = r.values[p.key];
      if (v !== null && Number.isFinite(v)) withValue++;
    }
    return withValue / n > SPARSE_PERIOD_MIN_LINE_FILL_RATIO;
  });

  return kept.length > 0 ? kept : periods;
}

function rowHasDataInPeriods(row: PresentedStatementForSave["rows"][number], periodKeys: string[]): boolean {
  for (const key of periodKeys) {
    const v = row.values[key];
    if (v !== null && v !== undefined && Number.isFinite(v)) return true;
  }
  return false;
}

/** Visible period columns plus rows that have data in at least one of those columns (single pass). */
export function visiblePeriodsAndRowsForStatement(stmt: PresentedStatementForSave): {
  periods: PresentedStatementForSave["periods"];
  rows: PresentedStatementForSave["rows"];
} {
  const periods = visiblePeriodsForAsPresentedStatement(stmt);
  const keys = periods.map((p) => p.key);
  const rows = keys.length === 0 ? [] : stmt.rows.filter((r) => rowHasDataInPeriods(r, keys));
  return { periods, rows };
}

export function buildWorkbookParamsFromPresentedStatements(
  tk: string,
  companyName: string | undefined,
  cik: string | undefined,
  filing: { form: string; filingDate: string; accessionNumber: string },
  statements: PresentedStatementForSave[],
  validation?: XbrlExportValidationIssue[],
  calculationLinkbaseLoaded?: boolean
) {
  return {
    ticker: tk,
    companyName,
    cik,
    filing,
    validation,
    calculationLinkbaseLoaded: calculationLinkbaseLoaded ?? false,
    statements: statements.map((s) => {
      const { periods, rows: visRows } = visiblePeriodsAndRowsForStatement(s);
      return {
        title: s.title,
        role: s.role,
        periods: periods.map((p) => ({ key: p.key, label: p.label, shortLabel: p.shortLabel })),
        rows: visRows.map((r) => ({
          concept: r.concept,
          label: r.label,
          depth: r.depth,
          values: r.values,
          rawValues: r.rawValues ?? r.values,
        })),
      };
    }),
  };
}

export async function savePresentedStatementsXlsxToServer(
  tk: string,
  filing: { form: string; filingDate: string; accessionNumber: string },
  companyName: string | undefined,
  cik: string | undefined,
  statements: PresentedStatementForSave[],
  validation?: XbrlExportValidationIssue[],
  calculationLinkbaseLoaded?: boolean
): Promise<{ ok: true; filename?: string } | { ok: false; error: string }> {
  if (!statements.length) {
    return { ok: false, error: "No statements to export" };
  }
  try {
    const params = buildWorkbookParamsFromPresentedStatements(
      tk,
      companyName,
      cik,
      filing,
      statements,
      validation,
      calculationLinkbaseLoaded
    );
    const wb = buildAsPresentedStatementsWorkbook(params);
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
