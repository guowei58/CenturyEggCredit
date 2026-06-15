import * as XLSX from "xlsx";

import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";
import { asPresentedWorkbookNumeric, type WorkbookNumericScale } from "@/lib/sec-xbrl-as-presented-scale";
import { incomeStatementCellNumeric } from "@/lib/sec-xbrl-income-statement-numeric";

const INVALID_SHEET_NAME = /[:\\/?*[\]]/g;

function sheetName(base: string): string {
  let s = base.replace(INVALID_SHEET_NAME, "_").trim();
  if (!s) s = "Sheet";
  return s.length > 31 ? s.slice(0, 31) : s;
}

export type AsPresentedStatementForExcel = {
  title: string;
  role: string;
  /** Primary statement kind — share-count scaling applies on income statement only. */
  statementKind?: "is" | "bs" | "cf";
  /**
   * `usd_full` (default): values/raw are full USD from XBRL — Excel ÷ 1e6.
   * `face_millions`: primary `values` already in $ millions (HTML-face tab).
   */
  workbookValueScale?: WorkbookNumericScale;
  /** When true, income statement sheet uses hybrid instance/SEC-display rule (see Meta note). */
  primaryGridUsesRaw?: boolean;
  periods: Array<{
    key: string;
    label: string;
    shortLabel?: string;
    start?: string | null;
    end?: string | null;
  }>;
  rows: Array<{
    concept: string;
    label: string;
    depth: number;
    /** Presentation preferred label arc (used to pick negated‑label flip vs instance raw per line). */
    preferredLabelRole?: string | null;
    values: Record<string, number | null>;
    rawValues: Record<string, number | null>;
    /** When set, Excel writes these numbers (TEST tab grid scale, no $/M suffix). */
    workbookCells?: Record<string, number | "">;
    /** @deprecated Prefer workbookCells — formatted strings are not valid Excel numbers. */
    displayCells?: Record<string, string>;
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
  /** Shown on Meta sheet (how period columns were chosen vs the on-screen grids). */
  workbookGridCaption?: string;
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
    [
      "Note",
      "Most columns: USD $ millions (XBRL ÷ 1,000,000). Per-share rows (EPS) keep native dollars-per-share. Share-count rows are ÷ 1M shares, no $ in the UI.",
    ],
    ["Source", "SEC XBRL as-presented — primary income statement, balance sheet, cash flow."],
  ];
  const cap = params.workbookGridCaption?.trim();
  if (cap) meta.push(["Grid columns", cap]);
  meta.push(
    [
      "Display values",
      "Balance sheet & cash flow: SEC-style display. Income statement: instance raw unless the presentation arc has a negated label (then SEC display), matching SEC printed signage. ÷ 1e6 except per-share rows.",
    ],
    [
      "API / JSON",
      "Each row: values = SEC display; rawValues = instance before negated-label flip. On-screen grids mirror negated arcs from values; otherwise prefer raw.",
    ],
    [
      "Calculation linkbase",
      params.calculationLinkbaseLoaded
        ? "Loaded _cal.xml — rollup checks on Validation sheet (face-statement roles only)."
        : "No _cal.xml in package or fetch failed — rollup checks skipped.",
    ]
  );
  meta.push(["", ""]);
  meta.push(["Period columns", ""]);
  meta.push(["Sheet", "Column", "Period key", "Header", "Start", "End"]);
  for (const stmt of params.statements) {
    const tab = sheetName(stmt.title);
    stmt.periods.forEach((p, idx) => {
      const header = p.shortLabel?.trim() ? p.shortLabel : p.label;
      meta.push([tab, 4 + idx, p.key, header, p.start ?? "", p.end ?? ""]);
    });
  }
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
    const primaryRaw = stmt.primaryGridUsesRaw === true;
    const wbScale: WorkbookNumericScale = stmt.workbookValueScale ?? "usd_full";
    for (const row of stmt.rows) {
      aoa.push([
        row.label,
        row.concept,
        row.depth,
        ...stmt.periods.map((p) => {
          const wbCell = row.workbookCells?.[p.key];
          if (wbCell !== undefined) return wbCell;
          const display = row.displayCells?.[p.key];
          if (display !== undefined) return display;
          const v = primaryRaw
            ? incomeStatementCellNumeric(
                {
                  preferredLabelRole: row.preferredLabelRole,
                  rawValues: row.rawValues,
                  values: row.values,
                },
                p.key
              )
            : row.values[p.key];
          return asPresentedWorkbookNumeric(row.concept, row.label, v, wbScale, stmt.statementKind);
        }),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(stmt.title));
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
