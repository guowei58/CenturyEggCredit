/**
 * Browser-only helpers for SEC as-presented workbook export (shared by SEC XBRL tab and Historical → The BAD).
 */

import { incomeStatementCellNumeric } from "@/lib/sec-xbrl-income-statement-numeric";
import { buildAsPresentedStatementsWorkbook, workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";
import { hasBlockingXbrlExportFailures, type XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

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
  selfDiagnosticChecklist?: import("@/lib/sec-self-diagnostic-checklist").SelfDiagnosticCheckResult[];
  calculationLinkbaseLoaded?: boolean;
};

export function normalizeAccessionKey(a: string): string {
  return (a ?? "").replace(/-/g, "").trim().toLowerCase();
}

/** Match accession with or without dashes (bulk ?acc= must resolve the same row as the filings list). */
export function findPresentedFilingByAccession<T extends { accessionNumber: string }>(
  filings: T[],
  acc: string
): T | undefined {
  const key = normalizeAccessionKey(acc);
  if (!key) return undefined;
  return filings.find((f) => normalizeAccessionKey(f.accessionNumber) === key);
}

export function buildTestAsPresentedFilingUrl(ticker: string, filing: PresentedFiling, opts?: { skipSubmissions?: boolean }): string {
  const params = new URLSearchParams({
    acc: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    _: String(Date.now()),
  });
  if (opts?.skipSubmissions) params.set("skipSubmissions", "1");
  return `/api/sec/xbrl/test-as-presented/${encodeURIComponent(ticker)}?${params.toString()}`;
}

export function buildAsPresentedFilingUrl(ticker: string, filing: PresentedFiling, opts?: { skipSubmissions?: boolean }): string {
  const params = new URLSearchParams({
    acc: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    _: String(Date.now()),
  });
  if (opts?.skipSubmissions) params.set("skipSubmissions", "1");
  return `/api/sec/xbrl/as-presented/${encodeURIComponent(ticker)}?${params.toString()}`;
}

/** Newest SEC filing date first; same-day 10-K before 10-Q so the annual is not queued behind a same-day quarter. */
export function sortPresentedFilingsNewestFirst<T extends { form: string; filingDate: string }>(
  filings: T[]
): T[] {
  return [...filings].sort((a, b) => {
    const byDate = (b.filingDate || "").localeCompare(a.filingDate || "");
    if (byDate !== 0) return byDate;
    const rank = (form: string) => (form.toUpperCase().includes("10-K") ? 0 : 1);
    return rank(a.form) - rank(b.form);
  });
}

/** Earliest calendar filing-date year for HTML-face bulk save (2019+ for comparatives / master build). */
export const FACE_BULK_MIN_FILING_YEAR = 2019;

/** Compiled IS/BS/CF columns start at this fiscal year (1Q20 onward). Workbooks still saved from 2019. */
export const COMPILE_DISPLAY_MIN_FISCAL_YEAR = 2020;

/**
 * Period Financials filing picker — long SEC history, no inline-XBRL-era floor.
 * (Bulk save still uses {@link FACE_BULK_MIN_FILING_YEAR}.)
 */
export const PERIOD_FINANCIALS_FILING_LOOKBACK_YEARS = 50;

/** 10-K / 10-Q, newest first (bulk save / list APIs). */
export function prepareBulkPresentedFilings<
  T extends { form: string; filingDate: string; accessionNumber: string; primaryDocument: string },
>(filings: T[], opts?: { lookbackYears?: number; maxCount?: number; minFilingYear?: number }): T[] {
  const lookbackYears = opts?.lookbackYears ?? 20;
  const maxCount = opts?.maxCount ?? 600;
  const lookbackCutoff = new Date().getFullYear() - lookbackYears;
  const minYear = opts?.minFilingYear ?? lookbackCutoff;
  const cutoffYear = Math.max(lookbackCutoff, minYear);
  return sortPresentedFilingsNewestFirst(
    filings
      .filter((f) => f.form === "10-K" || f.form === "10-Q")
      .filter((f) => {
        const y = parseInt((f.filingDate ?? "").slice(0, 4), 10);
        return Number.isFinite(y) ? y >= cutoffYear : true;
      })
  ).slice(0, maxCount);
}

/** Drop period columns where only a tiny fraction of lines have facts (one-off tags); used for Excel export. */
const SPARSE_PERIOD_MIN_LINE_FILL_RATIO = 0.05;

/**
 * Stricter rule than default export pruning: hides near-empty XBRL period columns on the SEC XBRL Financials tab.
 * With `includeAllRowsWithFacts: true`, grids still list every workbook line tag (facts in any filing period) while omitting sparse columns.
 */
export const SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY = 0.35;

export type VisiblePeriodsOptions = {
  /** Fraction of rows that must have a numeric fact in the period (exclusive bound uses `>`). Default: export ratio (~5%). */
  minLineFillRatio?: number;
  /** When true, keep every filing period even if the column is sparse. */
  includeAllPeriods?: boolean;
  /**
   * When true, row visibility ignores sparse column masking: keep any row with a numeric fact under **any**
   * `stmt.periods` key—same row set as as-presented workbooks (`includeAllPeriods` only widens columns, not rows).
   */
  includeAllRowsWithFacts?: boolean;
  /**
   * When true, treat the income statement like the “XBRL raw” grid: use instance `rawValues` (pre–negated-label)
   * when present for sparse filters and row visibility, matching the on-screen IS table.
   */
  incomeStatementUseInstanceRaw?: boolean;
};

/** Re-export for call sites that already import from this module. */
export { incomeStatementCellNumeric } from "@/lib/sec-xbrl-income-statement-numeric";

export function visiblePeriodsForAsPresentedStatement(
  stmt: PresentedStatementForSave,
  opts?: VisiblePeriodsOptions
): PresentedStatementForSave["periods"] {
  const { periods, rows } = stmt;
  const n = rows.length;
  if (n === 0 || periods.length === 0) return periods;
  if (opts?.includeAllPeriods) return periods;

  const minRatio = opts?.minLineFillRatio ?? SPARSE_PERIOD_MIN_LINE_FILL_RATIO;

  const kept = periods.filter((p) => {
    let withValue = 0;
    for (const r of rows) {
      const v = opts?.incomeStatementUseInstanceRaw ? incomeStatementCellNumeric(r, p.key) : r.values[p.key];
      if (v !== null && Number.isFinite(v)) withValue++;
    }
    return withValue / n > minRatio;
  });

  return kept.length > 0 ? kept : periods;
}

function rowHasDataInPeriods(
  row: PresentedStatementForSave["rows"][number],
  periodKeys: string[],
  incomeStatementUseInstanceRaw?: boolean
): boolean {
  for (const key of periodKeys) {
    const v = incomeStatementUseInstanceRaw ? incomeStatementCellNumeric(row, key) : row.values[key];
    if (v !== null && v !== undefined && Number.isFinite(v)) return true;
  }
  return false;
}

/** Visible period columns plus rows that have data in at least one of those columns (single pass). */
export function visiblePeriodsAndRowsForStatement(
  stmt: PresentedStatementForSave,
  opts?: VisiblePeriodsOptions
): {
  periods: PresentedStatementForSave["periods"];
  rows: PresentedStatementForSave["rows"];
} {
  const periods = visiblePeriodsForAsPresentedStatement(stmt, opts);
  const keys = periods.map((p) => p.key);
  const rowKeys = opts?.includeAllRowsWithFacts ? stmt.periods.map((p) => p.key) : keys;
  const useRaw = opts?.incomeStatementUseInstanceRaw === true;
  const rows =
    rowKeys.length === 0 ? [] : stmt.rows.filter((r) => rowHasDataInPeriods(r, rowKeys, useRaw));
  return { periods, rows };
}

export type PresentedWorkbookColumnMode = "all_filing_periods" | "match_sec_tab";

export type BuildPresentedStatementsWorkbookOptions = {
  /** Default `all_filing_periods`: every XBRL period column (Historical bulk-save shape). `match_sec_tab`: sparse-period trimming identical to SEC XBRL Financials tables. */
  columnMode?: PresentedWorkbookColumnMode;
};

export function buildWorkbookParamsFromPresentedStatements(
  tk: string,
  companyName: string | undefined,
  cik: string | undefined,
  filing: { form: string; filingDate: string; accessionNumber: string },
  statements: PresentedStatementForSave[],
  validation?: XbrlExportValidationIssue[],
  calculationLinkbaseLoaded?: boolean,
  workbookOpts?: BuildPresentedStatementsWorkbookOptions
) {
  const columnMode = workbookOpts?.columnMode ?? "all_filing_periods";
  const workbookGridCaption =
    columnMode === "match_sec_tab"
      ? `Sparse periods omitted unless more than ~${Math.round(SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY * 100)}% of lines have a numeric fact (same trimming as SEC XBRL Financials on-screen grids). Rows still retain every XBRL line tag keyed to any filing period.`
      : "All XBRL period columns from JSON are retained (including sparse/low-fill columns), aligned with Historical → bulk-save workbooks.";
  return {
    ticker: tk,
    companyName,
    cik,
    filing,
    validation,
    calculationLinkbaseLoaded: calculationLinkbaseLoaded ?? false,
    workbookGridCaption,
    statements: statements.map((s) => {
      const visOpts =
        columnMode === "match_sec_tab"
          ? {
              minLineFillRatio: SPARSE_PERIOD_MIN_LINE_FILL_RATIO_DISPLAY,
              incomeStatementUseInstanceRaw: s.id === "primary-is",
              includeAllRowsWithFacts: true,
            }
          : {
              includeAllPeriods: true,
              includeAllRowsWithFacts: true,
              incomeStatementUseInstanceRaw: s.id === "primary-is",
            };
      const { periods, rows: visRows } = visiblePeriodsAndRowsForStatement(s, visOpts);
      return {
        title: s.title,
        role: s.role,
        primaryGridUsesRaw: s.id === "primary-is",
        periods: periods.map((p) => ({
          key: p.key,
          label: p.label,
          shortLabel: p.shortLabel,
          start: p.start,
          end: p.end,
        })),
        rows: visRows.map((r) => ({
          concept: r.concept,
          label: r.label,
          depth: r.depth,
          preferredLabelRole: r.preferredLabelRole,
          values: r.values,
          rawValues: r.rawValues ?? r.values,
        })),
      };
    }),
  };
}

function safeWorkbookSlug(s: string): string {
  return (s ?? "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "xbrl";
}

/**
 * Builds `SEC-XBRL-financials_as-presented_*.xlsx` in-browser (Meta, Validation, primary statements + companions)
 * and triggers a browser download using the selected column mode.
 *
 * Unlike {@link savePresentedStatementsXlsxToServer}, this succeeds even when validation has blocking failures.
 */
export function triggerBrowserDownloadPresentedStatementsWorkbook(opts: {
  ticker: string;
  companyName?: string;
  cik?: string;
  filing: { form: string; filingDate: string; accessionNumber: string };
  statements: PresentedStatementForSave[];
  validation?: XbrlExportValidationIssue[];
  calculationLinkbaseLoaded?: boolean;
  columnMode: PresentedWorkbookColumnMode;
}): boolean {
  if (!opts.statements.length) return false;

  const params = buildWorkbookParamsFromPresentedStatements(
    opts.ticker,
    opts.companyName,
    opts.cik,
    opts.filing,
    opts.statements,
    opts.validation,
    opts.calculationLinkbaseLoaded,
    { columnMode: opts.columnMode }
  );

  const wb = buildAsPresentedStatementsWorkbook(params);
  const u8 = workbookToXlsxUint8Array(wb);
  const blob = new Blob([new Uint8Array(u8)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);

  try {
    const tk = safeWorkbookSlug(opts.ticker);
    const acc = safeWorkbookSlug(opts.filing.accessionNumber);
    const shape = opts.columnMode === "match_sec_tab" ? "sparse-periods" : "all-periods";
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tk}_SEC-XBRL-financials_as-presented_${shape}_${acc}.xlsx`;
    a.rel = "noopener noreferrer";
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }

  return true;
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
  if (hasBlockingXbrlExportFailures(validation)) {
    return {
      ok: false,
      error:
        "Statement tie-outs failed validation (see SEC XBRL Financials tab — failures must be resolved before save).",
    };
  }
  try {
    const params = buildWorkbookParamsFromPresentedStatements(
      tk,
      companyName,
      cik,
      filing,
      statements,
      validation,
      calculationLinkbaseLoaded,
      { columnMode: "all_filing_periods" }
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
