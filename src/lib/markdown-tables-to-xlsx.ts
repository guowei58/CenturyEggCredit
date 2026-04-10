import type { Cell, Workbook, Worksheet } from "exceljs";

const INVALID_SHEET = /[:\\/?*[\]]/g;

/** Commas, 2 decimals, parentheses for negatives, hyphen for zero (financial model style). */
const NUM_FMT_FINANCIAL = '#,##0.00_);(#,##0.00);"-"';

const CLR_TITLE_BG = "FFFFFFCC";
const CLR_TITLE_FONT = "FF1F4E79";
const CLR_HEADER_BG = "FF4A4A4A";
const CLR_HEADER_FONT = "FFB4C7E7";
const CLR_DATA_FILL = "FFF2F2F2";
const CLR_DATA_NUM = "FF2F5597";
const CLR_LABEL = "FF000000";
const CLR_BORDER = "FF000000";

function sanitizeSheetBase(name: string): string {
  let s = name.replace(INVALID_SHEET, "_").trim();
  if (!s) s = "Sheet";
  return s.length > 31 ? s.slice(0, 31) : s;
}

function allocateSheetName(base: string, used: Set<string>): string {
  let b = sanitizeSheetBase(base);
  if (!used.has(b)) {
    used.add(b);
    return b;
  }
  for (let i = 2; i < 999; i++) {
    const suffix = ` ${i}`;
    const trimmed = b.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
    if (!used.has(trimmed)) {
      used.add(trimmed);
      return trimmed;
    }
  }
  const fallback = `T${used.size + 1}`.slice(0, 31);
  used.add(fallback);
  return fallback;
}

function excelColumnLetter(columnIndex1Based: number): string {
  let n = columnIndex1Based;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

function splitPipeRow(line: string): string[] {
  let t = line.trim();
  if (!t.startsWith("|")) return [];
  if (t.endsWith("|")) t = t.slice(0, -1);
  const inner = t.slice(1);
  return inner.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/**
 * Parse a cell that should be numeric on financial statements.
 * Handles $, commas, (123) negatives, %, trailing M/B for millions/billions, em dashes as empty.
 */
export function parseFinancialCellValue(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  const dash = /^[\u2013\u2014—\-–]+$/;
  if (dash.test(s)) return null;
  if (/^n\/?a$/i.test(s) || /^nm$/i.test(s)) return null;

  s = s.replace(/[$€£¥]/g, "").replace(/\s/g, "");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/,/g, "");

  let mult = 1;
  if (/m$/i.test(s) && /[\d.]/.test(s)) {
    s = s.slice(0, -1).trim();
    mult = 1e6;
  } else if (/b$/i.test(s) && /[\d.]/.test(s)) {
    s = s.slice(0, -1).trim();
    mult = 1e9;
  }

  if (/%$/.test(s)) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? (sign * n) / 100 : null;
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return sign * n * mult;
}

/** Remove markdown bold markers so column A shows plain text (Excel applies bold via styles). */
function stripMarkdownBoldMarkers(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

function labelIndentLevel(label: string): number {
  const m = label.match(/^(\s+)/);
  const spaces = m?.[1]?.length ?? 0;
  return Math.min(10, Math.floor(spaces / 2));
}

function labelLooksLikeTotal(label: string): boolean {
  const t = label.trim().toLowerCase();
  return /^total\b/.test(t) || /\btotal\s+(current|assets|liabilities|equity|debt|revenue)/.test(t);
}

function labelLooksLikeMajorSection(label: string): boolean {
  const t = label.trim();
  if (t.length > 48) return false;
  return /^(assets|liabilities|equity|stockholders'?\s+equity|shareholders'?\s+equity)(\s|$)/i.test(t);
}

function applyTotalRowTopBorder(cell: Cell): void {
  cell.border = { ...cell.border, top: { style: "thin", color: { argb: CLR_BORDER } } };
}

function styleTitleCell(cell: Cell, title: string): void {
  cell.value = title;
  cell.font = { bold: true, size: 14, color: { argb: CLR_TITLE_FONT }, underline: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_TITLE_BG } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function styleHeaderCell(cell: Cell, text: string, isFirstCol: boolean): void {
  cell.value = text;
  cell.font = { bold: true, color: { argb: CLR_HEADER_FONT }, size: 11 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_HEADER_BG } };
  cell.alignment = {
    vertical: "middle",
    horizontal: isFirstCol ? "left" : "right",
    wrapText: false,
  };
}

export type ParsedMdTable = { sheetTitle: string; rows: string[][] };

export function parseMarkdownTablesForExcel(markdown: string): ParsedMdTable[] {
  const lines = markdown.split(/\r?\n/);
  let recentHeading = "Consolidated";
  const tables: ParsedMdTable[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const hm = line.match(/^#{1,3}\s+(.+)/);
    if (hm) {
      recentHeading = hm[1]!.trim().replace(/[#*`]/g, "").slice(0, 80) || "Section";
      i++;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        block.push(lines[i]!);
        i++;
      }
      const rows: string[][] = [];
      for (const raw of block) {
        const cells = splitPipeRow(raw);
        if (cells.length === 0) continue;
        if (isSeparatorRow(cells)) continue;
        rows.push(cells);
      }
      if (rows.length > 0) {
        tables.push({ sheetTitle: recentHeading, rows });
      }
      continue;
    }
    i++;
  }

  return tables;
}

function padRowsToRectangular(rows: string[][]): string[][] {
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const out = [...r];
    while (out.length < w) out.push("");
    return out;
  });
}

function populateStatementWorksheet(ws: Worksheet, displayTitle: string, rect: string[][]): void {
  const ncols = Math.max(1, rect[0]?.length ?? 1);
  const nrows = rect.length;
  const headerRow = 2;
  const firstDataRow = 3;

  ws.views = [
    {
      state: "frozen",
      xSplit: 1,
      ySplit: 2,
      topLeftCell: "B3",
      rightToLeft: false,
      activeCell: "B3",
      showRuler: true,
      showRowColHeaders: true,
      showGridLines: true,
      zoomScale: 100,
      zoomScaleNormal: 100,
    },
  ];

  const lastCol = excelColumnLetter(ncols);
  if (ncols > 1) {
    ws.mergeCells(`A1:${lastCol}1`);
  }
  styleTitleCell(ws.getCell(1, 1), displayTitle);
  ws.getRow(1).height = 24;

  const header = rect[0] ?? [];
  for (let c = 0; c < ncols; c++) {
    const h = String(header[c] ?? "");
    styleHeaderCell(ws.getCell(headerRow, c + 1), c === 0 ? stripMarkdownBoldMarkers(h) : h, c === 0);
  }
  ws.getRow(headerRow).height = 20;

  for (let r = 1; r < nrows; r++) {
    const excelRow = firstDataRow + (r - 1);
    const row = ws.getRow(excelRow);
    row.height = 17;
    const labelRaw = String(rect[r]?.[0] ?? "");
    const labelPlain = stripMarkdownBoldMarkers(labelRaw);
    const indent = labelIndentLevel(labelRaw);
    const isTotal = labelLooksLikeTotal(labelPlain);
    const isSection = labelLooksLikeMajorSection(labelPlain);
    const labelBold = isTotal || isSection;

    for (let c = 0; c < ncols; c++) {
      const cell = row.getCell(c + 1);
      const raw = String(rect[r]?.[c] ?? "");

      if (c === 0) {
        cell.value = labelPlain || stripMarkdownBoldMarkers(raw);
        cell.font = { bold: labelBold, color: { argb: CLR_LABEL }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
        cell.alignment = { horizontal: "left", vertical: "middle", indent };
        if (isTotal) applyTotalRowTopBorder(cell);
        continue;
      }

      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_DATA_FILL } };
      const trimmed = raw.trim();
      const num = parseFinancialCellValue(trimmed);

      if (num !== null) {
        cell.value = num;
        cell.numFmt = NUM_FMT_FINANCIAL;
        cell.font = { color: { argb: CLR_DATA_NUM }, size: 11, bold: isTotal };
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (!trimmed || /^[\u2013\u2014—\-–]+$/.test(trimmed)) {
        cell.value = "–";
        cell.font = { color: { argb: CLR_DATA_NUM }, size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.value = raw;
        cell.font = { color: { argb: CLR_LABEL }, size: 11, bold: isTotal };
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }

      if (isTotal) applyTotalRowTopBorder(cell);
    }
  }

  ws.getColumn(1).width = 46;
  for (let c = 2; c <= ncols; c++) {
    ws.getColumn(c).width = 14;
  }
}

/** Build styled workbook (ExcelJS). */
export async function buildMarkdownConsolidationWorkbook(markdown: string): Promise<Workbook> {
  const { Workbook: WorkbookCtor } = await import("exceljs");
  const wb = new WorkbookCtor();
  wb.creator = "CenturyEggCredit";
  wb.created = new Date();

  const trimmed = markdown.trim();
  const usedNames = new Set<string>();
  const parsed = parseMarkdownTablesForExcel(trimmed);

  if (parsed.length === 0) {
    const ws = wb.addWorksheet(allocateSheetName("Document", usedNames));
    const lines = trimmed.length ? trimmed.split(/\r?\n/) : [""];
    styleTitleCell(ws.getCell(1, 1), "Notes");
    let r = 2;
    for (const line of lines) {
      const cell = ws.getCell(r, 1);
      cell.value = line;
      cell.alignment = { wrapText: true, vertical: "top" };
      r++;
    }
    ws.getColumn(1).width = 100;
    return wb;
  }

  for (const t of parsed) {
    const rect = padRowsToRectangular(t.rows);
    const name = allocateSheetName(t.sheetTitle, usedNames);
    const ws = wb.addWorksheet(name);
    populateStatementWorksheet(ws, t.sheetTitle || name, rect);
  }

  return wb;
}

/** Download .xlsx with financial-model styling (colors, freezes, number formats, borders on totals). */
export async function downloadMarkdownConsolidationAsXlsx(ticker: string, markdown: string): Promise<void> {
  const sym = (ticker ?? "").trim().toUpperCase().replace(/[^\w-]+/g, "_") || "TICKER";
  const wb = await buildMarkdownConsolidationWorkbook(markdown);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${sym}_XBRL-AI-consolidated_${stamp}.xlsx`;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
