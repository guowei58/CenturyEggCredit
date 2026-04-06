import * as XLSX from "xlsx";

const INVALID_SHEET_NAME = /[:\\/?*[\]]/g;

function sheetName(base: string): string {
  let s = base.replace(INVALID_SHEET_NAME, "_").trim();
  if (!s) s = "Sheet";
  return s.length > 31 ? s.slice(0, 31) : s;
}

export type AsPresentedStatementForExcel = {
  title: string;
  role: string;
  periods: Array<{ key: string; label: string }>;
  rows: Array<{ concept: string; label: string; depth: number; values: Record<string, number | null> }>;
};

export type AsPresentedExcelParams = {
  ticker: string;
  companyName?: string;
  cik?: string;
  filing: { form: string; filingDate: string; accessionNumber: string };
  statements: AsPresentedStatementForExcel[];
};

/**
 * One workbook: Meta + one sheet per primary statement. Numeric cells are USD **millions** (raw ÷ 1e6).
 */
export function downloadAsPresentedStatementsExcel(params: AsPresentedExcelParams): void {
  const wb = XLSX.utils.book_new();

  const meta: (string | number)[][] = [
    ["Ticker", params.ticker],
    ["Company", params.companyName ?? ""],
    ["CIK", params.cik ?? ""],
    ["Form", params.filing.form],
    ["Filing date", params.filing.filingDate],
    ["Accession", params.filing.accessionNumber],
    ["", ""],
    ["Note", "Numeric columns are USD $ millions (raw XBRL dollars ÷ 1,000,000)."],
    ["Source", "SEC XBRL as-presented — primary income statement, balance sheet, cash flow."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), sheetName("Meta"));

  for (const stmt of params.statements) {
    const header: (string | number)[] = ["Line", "Concept", "Depth", ...stmt.periods.map((p) => p.label)];
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
  }

  const acc = params.filing.accessionNumber.replace(/[^\w-]+/g, "_");
  const tk = params.ticker.replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `${tk}_SEC_XBRL_as_presented_${acc}.xlsx`);
}
