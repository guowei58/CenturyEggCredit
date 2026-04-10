export type StatementKind = "is" | "bs" | "cf";

export type WorkbookMeta = {
  ticker: string;
  company: string;
  cik: string;
  form: string;
  filingDate: string;
  accession: string;
  sourceFilename: string;
};

export type ParsedStatementTable = {
  kind: StatementKind;
  sheetName: string;
  /** Period column headers from the saved workbook (after Line, Concept, Depth). */
  periodLabels: string[];
  /** Index into periodLabels / row numeric slice for the chosen annual column. */
  annualColIndex: number;
  /** Fiscal period end (ISO date) inferred from the chosen column. */
  fiscalYearEnd: string;
  rows: Array<{
    line: string;
    concept: string;
    depth: number;
    valueMillions: number | null;
  }>;
};

export type ParsedSavedWorkbook = {
  meta: WorkbookMeta;
  statements: ParsedStatementTable[];
  parseNotes: string[];
};

/** One row with a value for each period column (saved SEC-XBRL grid). */
export type ParsedStatementRowFull = {
  line: string;
  concept: string;
  depth: number;
  /** Keys are exact period headers from the workbook (e.g. ISO range labels). */
  valuesByPeriod: Record<string, number | null>;
};

export type ParsedStatementTableFull = {
  kind: StatementKind;
  sheetName: string;
  periodLabels: string[];
  rows: ParsedStatementRowFull[];
};

export type ParsedSavedWorkbookFull = {
  meta: WorkbookMeta;
  statements: ParsedStatementTableFull[];
  parseNotes: string[];
};

export type FiscalYearSlot = {
  /** ISO end date e.g. 2024-09-30 — unique key for the fiscal period. */
  fyEnd: string;
  /** Human label for column header e.g. FY2024 */
  fyLabel: string;
  /** 1-based index into FY1..FY10 (1 = oldest of bundle). */
  fySlot: number;
};

export type MapRule = {
  /** Match full concept `us-gaap:Foo` or local name `Foo` (case-insensitive). */
  match: RegExp;
  standardized: string;
  statement: StatementKind;
  sortOrder: number;
  displayLabel: string;
};
