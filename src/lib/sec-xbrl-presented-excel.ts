import * as XLSX from "xlsx";

import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

const INVALID_SHEET_NAME = /[:\\/?*[\]]/g;

function sheetName(base: string): string {
  let s = base.replace(INVALID_SHEET_NAME, "_").trim();
  if (!s) s = "Sheet";
  return s.length > 31 ? s.slice(0, 31) : s;
}

export type AsPresentedStatementForExcel = {
  title: string;
  role: string;
  periods: Array<{ key: string; label: string; shortLabel?: string }>;
  rows: Array<{
    concept: string;
    label: string;
    depth: number;
    values: Record<string, number | null>;
    rawValues: Record<string, number | null>;
  }>;
};

export type AsPresentedExcelParams = {
  ticker: string;
  companyName?: string;
  cik?: string;
  filing: { form: string; filingDate: string; accessionNumber: string };
  statements: AsPresentedStatementForExcel[];
  /** Structural + calculation rollup failures (empty = all checks within tolerance). */
  validation?: XbrlExportValidationIssue[];
  calculationLinkbaseLoaded?: boolean;
};

/** Build workbook (client or server). */
export function buildAsPresentedStatementsWorkbook(params: AsPresentedExcelParams): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const meta: (string | number)[][] = [
    ["Ticker", params.ticker],
    ["Company", params.companyName ?? ""],
    ["CIK", params.cik ?? ""],
    ["Form", params.filing.form],
    ["Filing date", params.filing.filingDate],
    ["Accession", params.filing.accessionNumber],
    ["", ""],
    ["Note", "Numeric columns are USD $ millions (XBRL ÷ 1,000,000)."],
    ["Source", "SEC XBRL as-presented — primary income statement, balance sheet, cash flow."],
    [
      "Display values",
      "Statement grids match SEC-style XBRL display: instance numeric (including inline sign) plus negated presentation label roles only. Paired '(XBRL raw)' sheets are pre-flip instance picks (divide by 1e6).",
    ],
    [
      "API / JSON",
      "Each row: values = display (SEC-style), rawValues = instance pick before negated-label flip, normalizationByPeriod.rule tags sec_negated_label:* or sec_instance:*.",
    ],
    [
      "Calculation linkbase",
      params.calculationLinkbaseLoaded
        ? "Loaded _cal.xml — rollup checks on Validation sheet (face-statement roles only)."
        : "No _cal.xml in package or fetch failed — rollup checks skipped.",
    ],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), sheetName("Meta"));

  const valHeader: (string | number)[][] = [
    ["Statement", "Period", "Severity", "Check", "Detail", "Abs delta ($M)"],
  ];
  const valBody: (string | number)[][] =
    params.validation && params.validation.length > 0
      ? params.validation.map((v) => [
          v.statement,
          v.periodLabel,
          v.severity,
          v.check,
          v.detail,
          v.absDeltaUsd != null ? Math.round((v.absDeltaUsd / 1e6) * 100) / 100 : "",
        ])
      : [
          [
            "—",
            "—",
            "ok",
            "Structural + rollup checks",
            "No failures within configured tolerances (or required anchor tags missing).",
            "",
          ],
        ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([...valHeader, ...valBody]),
    sheetName("Validation")
  );

  for (const stmt of params.statements) {
    const periodHeaders = stmt.periods.map((p) => (p.shortLabel?.trim() ? p.shortLabel : p.label));
    const header: (string | number)[] = ["Line", "Concept", "Depth", ...periodHeaders];
    const aoa: (string | number)[][] = [header];
    for (const row of stmt.rows) {
      aoa.push([
        row.label,
        row.concept,
        row.depth,
        ...stmt.periods.map((p) => {
          const v = row.values[p.key];
          if (v === null || !Number.isFinite(v)) return "";
          return v / 1_000_000;
        }),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(stmt.title));

    const rawTitle = `${stmt.title} (XBRL raw)`;
    const rawAoa: (string | number)[][] = [header];
    for (const row of stmt.rows) {
      rawAoa.push([
        row.label,
        row.concept,
        row.depth,
        ...stmt.periods.map((p) => {
          const v = row.rawValues[p.key];
          if (v === null || !Number.isFinite(v)) return "";
          return v / 1_000_000;
        }),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawAoa), sheetName(rawTitle));
  }

  return wb;
}

/** Serialize workbook to .xlsx bytes (browser or Node). */
export function workbookToXlsxUint8Array(wb: XLSX.WorkBook): Uint8Array {
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
}

/**
 * One workbook: Meta + one sheet per primary statement. Numeric cells are USD **millions** (raw ÷ 1e6).
 * @deprecated Prefer `buildAsPresentedStatementsWorkbook` + `workbookToXlsxUint8Array` + save/upload.
 */
export function downloadAsPresentedStatementsExcel(params: AsPresentedExcelParams): void {
  const wb = buildAsPresentedStatementsWorkbook(params);
  const acc = params.filing.accessionNumber.replace(/[^\w-]+/g, "_");
  const tk = params.ticker.replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `${tk}_SEC-XBRL-financials_as-presented_${acc}.xlsx`);
}
