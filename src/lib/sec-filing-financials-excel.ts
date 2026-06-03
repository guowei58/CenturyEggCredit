import * as XLSX from "xlsx";

const INVALID_SHEET_NAME = /[:\\/?*[\]]/g;

function sheetName(base: string): string {
  let s = base.replace(INVALID_SHEET_NAME, "_").trim();
  if (!s) s = "Sheet";
  return s.length > 31 ? s.slice(0, 31) : s;
}

export type FilingHtmlStatementForExcel = {
  title: string;
  role: string;
  units?: string;
  periods: Array<{ key: string; label: string; shortLabel?: string }>;
  rows: Array<{
    concept: string;
    label: string;
    depth: number;
    rowKind?: "data" | "heading" | "total";
    valueFormat?: "usd_millions" | "native";
    values: Record<string, number | null>;
    displayValues?: Record<string, string>;
  }>;
};

export type FilingHtmlExcelParams = {
  ticker: string;
  companyName?: string;
  cik?: string;
  filing: { form: string; filingDate: string; accessionNumber: string };
  statements: FilingHtmlStatementForExcel[];
};

export function buildFilingHtmlStatementsWorkbook(params: FilingHtmlExcelParams): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const meta: (string | number)[][] = [
    ["Ticker", params.ticker],
    ["Company", params.companyName ?? ""],
    ["CIK", params.cik ?? ""],
    ["Form", params.filing.form],
    ["Filing date", params.filing.filingDate],
    ["Accession", params.filing.accessionNumber],
    ["", ""],
    ["Source", "SEC filing primary HTML statement tables."],
    ["Value scale", "Dollar rows are normalized to $ millions when filing units indicate thousands/millions/billions; share/per-share rows keep native units."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), sheetName("Meta"));

  for (const stmt of params.statements) {
    const periodHeaders = stmt.periods.map((p) => (p.shortLabel?.trim() ? p.shortLabel : p.label));
    const aoa: (string | number)[][] = [
      ["Units", stmt.units ?? "No filing unit header detected"],
      [],
      ["Line", "Concept", "Depth", "Row Type", ...periodHeaders],
    ];
    for (const row of stmt.rows) {
      aoa.push([
        row.label,
        row.concept,
        row.depth,
        row.rowKind ?? "data",
        ...stmt.periods.map((p) => {
          const v = row.values[p.key];
          if (row.valueFormat === "native") {
            return v === null || !Number.isFinite(v) ? row.displayValues?.[p.key] ?? "" : v;
          }
          if (v === null || !Number.isFinite(v)) return row.displayValues?.[p.key] ?? "";
          return v;
        }),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(stmt.title));
  }

  return wb;
}

export function workbookToFilingHtmlXlsxUint8Array(wb: XLSX.WorkBook): Uint8Array {
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
}

export function downloadFilingHtmlStatementsExcel(params: FilingHtmlExcelParams): void {
  const wb = buildFilingHtmlStatementsWorkbook(params);
  const acc = params.filing.accessionNumber.replace(/[^\w-]+/g, "_");
  const tk = params.ticker.replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `${tk}_SEC-filing-financials_${acc}.xlsx`);
}
