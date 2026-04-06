import * as XLSX from "xlsx";

const INVALID_SHEET_NAME = /[:\\/?*[\]]/g;

export type EdgarXbrlExcelInput = {
  ticker: string;
  accessionNumber?: string;
  form?: string;
  filingDate?: string;
  company?: string;
  secHomeUrl?: string | null;
  xbrl?: {
    available: boolean;
    facts: Record<string, unknown>[];
    factsTruncated: boolean;
    statements: Record<string, string>;
    /** Row-level financials from the bridge (preferred over markdown for Excel). */
    statementRecords?: Record<string, Record<string, unknown>[]>;
  } | null;
};

function sheetName(base: string): string {
  let s = base.replace(INVALID_SHEET_NAME, "_").trim();
  if (!s) s = "Sheet";
  return s.length > 31 ? s.slice(0, 31) : s;
}

/** Skip markdown separator rows like | --- | :---: | */
function isPipeTableSeparatorRow(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  const inner = t
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim().replace(/\s/g, ""));
  if (inner.length === 0) return false;
  return inner.every((cell) => /^:?-+:?$/i.test(cell));
}

/**
 * Parse GitHub / pandas-style markdown tables (| a | b |) into rows for Excel.
 */
export function parseMarkdownPipeTable(md: string): string[][] {
  const rows: string[][] = [];
  const lines = md.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    if (isPipeTableSeparatorRow(line)) continue;
    const parts = line.split("|");
    const inner = parts.slice(1, parts.length - 1).map((c) => c.trim());
    if (inner.length > 0) rows.push(inner);
  }
  return rows;
}

function flattenRowForExcel(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const o: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) {
      o[k] = null;
    } else if (typeof v === "number" && Number.isNaN(v)) {
      o[k] = null;
    } else if (typeof v === "object" && !(v instanceof Date)) {
      o[k] = JSON.stringify(v);
    } else {
      o[k] = v as string | number | boolean;
    }
  }
  return o;
}

function sheetFromFactRecords(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(rows.map((r) => flattenRowForExcel(r)));
}

function filenamePart(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80);
}

export function downloadEdgarXbrlExcel(input: EdgarXbrlExcelInput): { ok: true } | { ok: false; reason: string } {
  const xbrl = input.xbrl;
  if (!xbrl) {
    return { ok: false, reason: "No XBRL data in this filing bundle." };
  }
  const hasFacts = (xbrl.facts?.length ?? 0) > 0;
  const hasStmtRecs = Object.values(xbrl.statementRecords ?? {}).some((a) => (a?.length ?? 0) > 0);
  const hasStmts = hasStmtRecs || Object.values(xbrl.statements ?? {}).some((v) => (v ?? "").trim().length > 0);
  if (!hasFacts && !hasStmts) {
    return {
      ok: false,
      reason:
        "No fact rows or statement tables in this response. Try the Statements tab, or increase facts_max on the Edgar bridge.",
    };
  }

  const wb = XLSX.utils.book_new();

  const metaRows: (string | number | null)[][] = [
    ["Ticker", input.ticker],
    ["Company", input.company ?? ""],
    ["Form", input.form ?? ""],
    ["Filing date", input.filingDate ?? ""],
    ["Accession", input.accessionNumber ?? ""],
    ["SEC index", input.secHomeUrl ?? ""],
    ["XBRL available", xbrl.available ? "yes" : "no"],
    ["Facts row count", xbrl.facts?.length ?? 0],
    ["Facts truncated in API", xbrl.factsTruncated ? "yes (raise facts_max on bridge for more)" : "no"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), sheetName("Meta"));

  const stmtMap = [
    { key: "incomeStatement", title: "Income_statement" },
    { key: "balanceSheet", title: "Balance_sheet" },
    { key: "cashFlowStatement", title: "Cash_flow" },
  ] as const;

  for (const { key, title } of stmtMap) {
    const recs = xbrl.statementRecords?.[key];
    if (recs && recs.length > 0) {
      XLSX.utils.book_append_sheet(wb, sheetFromFactRecords(recs), sheetName(title));
      continue;
    }
    const md = xbrl.statements[key];
    if (!md?.trim()) continue;
    const aoa = parseMarkdownPipeTable(md);
    if (aoa.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[md]]), sheetName(`${title}_raw`));
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(title));
    }
  }

  if (xbrl.facts && xbrl.facts.length > 0) {
    XLSX.utils.book_append_sheet(wb, sheetFromFactRecords(xbrl.facts), sheetName("XBRL_facts"));
  }

  const acc = filenamePart(input.accessionNumber ?? "filing");
  const tk = filenamePart(input.ticker || "ticker");
  const fm = filenamePart(input.form ?? "SEC");
  XLSX.writeFile(wb, `${tk}_${fm}_${acc}.xlsx`);

  return { ok: true };
}
