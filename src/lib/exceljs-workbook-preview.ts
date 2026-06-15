import type { Cell, Column, Row, Workbook, Worksheet } from "exceljs";
import {
  EXCEL_DEFAULT_COL_PX,
  type PreviewCell,
  type StyledSheetPreview,
  excelCharWidthToPx,
  safeSheetPreviewGrid,
} from "@/lib/excel-workbook-preview";

const EXCEL_DEFAULT_COL_WCH = 8.43;
const EXCEL_DEFAULT_ROW_PT = 15;

function parseA1(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!m) return { row: 1, col: 1 };
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2], 10), col };
}

function parseMergeRange(range: string): { top: number; left: number; bottom: number; right: number } {
  const [tl, br] = range.split(":");
  const a = parseA1(tl);
  const b = br ? parseA1(br) : a;
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

function argbToHex(argb: string | undefined): string | undefined {
  if (!argb) return undefined;
  const hex = argb.replace(/^#/, "").trim().toUpperCase();
  if (/^[0-9A-F]{8}$/.test(hex)) return `#${hex.slice(2)}`;
  if (/^[0-9A-F]{6}$/.test(hex)) return `#${hex}`;
  return undefined;
}

function hexToTextColor(bgHex: string): string {
  const hex = bgHex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#0b0e14";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0b0e14" : "#ffffff";
}

function resolveExcelJsColWidthPx(col: Column | undefined, defaultColWidth: number): number {
  if (!col || col.hidden) return 0;
  const wch = typeof col.width === "number" && col.width > 0 ? col.width : defaultColWidth;
  return excelCharWidthToPx(wch);
}

function resolveExcelJsRowHeightPx(row: Row | undefined, defaultRowHeight: number): number {
  const hpt = typeof row?.height === "number" && row.height > 0 ? row.height : defaultRowHeight;
  return Math.round((hpt * 96) / 72);
}

function effectiveCell(cell: Cell): Cell {
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) {
    return cell.master;
  }
  return cell;
}

function formatRawValue(value: Cell["value"]): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return value.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text ?? "").join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result != null) return String(value.result);
    if ("formula" in value && "result" in value && value.result != null) return String(value.result);
  }
  return String(value);
}

function getCellPreviewFromExcelJsCell(cell: Cell | undefined): PreviewCell {
  if (!cell) return { value: "", textColor: "#0b0e14", hasBg: false };

  const src = effectiveCell(cell);
  const style = src.style ?? {};
  const font = style.font ?? {};
  const fill = style.fill;
  const alignment = style.alignment ?? {};

  let bgColor: string | undefined;
  if (fill && fill.type === "pattern" && fill.pattern !== "none") {
    bgColor = argbToHex(fill.fgColor?.argb ?? fill.bgColor?.argb);
  }

  const fontColor = argbToHex(font.color?.argb);
  const hasBg = Boolean(bgColor);
  const textColor = fontColor ?? (bgColor ? hexToTextColor(bgColor) : "#0b0e14");

  const value = src.text?.trim() !== "" ? src.text : formatRawValue(src.value);

  const isNumber = typeof src.value === "number";
  const h = alignment.horizontal;
  const textAlign =
    h === "center" ? "center" : h === "right" ? "right" : h === "left" ? "left" : isNumber ? "right" : "left";

  const v = alignment.vertical;
  const verticalAlign =
    v === "middle" ? "middle" : v === "bottom" ? "bottom" : v === "top" ? "top" : "top";

  return {
    value,
    bgColor,
    textColor,
    hasBg,
    wrapText: alignment.wrapText === true,
    textAlign,
    verticalAlign,
    bold: font.bold === true,
    italic: font.italic === true,
    fontSize: typeof font.size === "number" && font.size > 0 ? font.size : 11,
    fontFamily: font.name?.trim() || "Calibri",
  };
}

function sheetBounds(ws: Worksheet): { startR: number; startC: number; endR: number; endC: number } {
  const dim = ws.dimensions;
  let startR = dim.top > 0 ? dim.top : 1;
  let startC = dim.left > 0 ? dim.left : 1;
  let endR = dim.bottom > 0 ? dim.bottom : startR;
  let endC = dim.right > 0 ? dim.right : startC;

  if (endR < startR || endC < startC) {
    startR = 1;
    startC = 1;
    endR = Math.max(1, ws.actualRowCount);
    endC = Math.max(1, ws.actualColumnCount);
  }

  return { startR, startC, endR, endC };
}

export function buildStyledSheetPreviewFromExcelJs(
  ws: Worksheet,
  maxRows: number | null,
  maxCols: number | null
): StyledSheetPreview {
  const { startR, startC, endR, endC } = sheetBounds(ws);
  const fullRows = Math.max(0, endR - startR + 1);
  const fullCols = Math.max(0, endC - startC + 1);
  const rowsCount = maxRows == null ? fullRows : Math.max(0, Math.min(maxRows, fullRows));
  const colsCount = maxCols == null ? fullCols : Math.max(0, Math.min(maxCols, fullCols));
  const truncated = rowsCount < fullRows || colsCount < fullCols;

  const defaultColWidth = ws.properties.defaultColWidth ?? EXCEL_DEFAULT_COL_WCH;
  const defaultRowHeight = ws.properties.defaultRowHeight ?? EXCEL_DEFAULT_ROW_PT;

  const cells: PreviewCell[][] = Array.from({ length: rowsCount }, () =>
    Array.from({ length: colsCount }, () => ({ value: "", textColor: "#0b0e14", hasBg: false }))
  );

  for (let r = 0; r < rowsCount; r++) {
    const row = ws.getRow(startR + r);
    for (let c = 0; c < colsCount; c++) {
      cells[r][c] = getCellPreviewFromExcelJsCell(row.getCell(startC + c));
    }
  }

  const colWidthsPx = Array.from({ length: colsCount }, (_, i) =>
    resolveExcelJsColWidthPx(ws.getColumn(startC + i), defaultColWidth)
  );

  const rowHeightsPx = Array.from({ length: rowsCount }, (_, i) =>
    resolveExcelJsRowHeightPx(ws.getRow(startR + i), defaultRowHeight)
  );

  const occupied: boolean[][] = Array.from({ length: rowsCount }, () =>
    Array.from({ length: colsCount }, () => false)
  );
  const mergeStarts: StyledSheetPreview["mergeStarts"] = Array.from({ length: rowsCount }, () =>
    Array.from({ length: colsCount }, () => null)
  );

  const merges = ws.model.merges ?? [];
  for (const mergeRange of merges) {
    const { top, left, bottom, right } = parseMergeRange(mergeRange);

    const r0 = Math.max(top, startR);
    const c0 = Math.max(left, startC);
    const r1 = Math.min(bottom, startR + rowsCount - 1);
    const c1 = Math.min(right, startC + colsCount - 1);
    if (r0 > r1 || c0 > c1) continue;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        occupied[r - startR][c - startC] = true;
      }
    }

    const localR0 = r0 - startR;
    const localC0 = c0 - startC;
    const topLeft = ws.getRow(top).getCell(left);
    mergeStarts[localR0][localC0] = {
      rowSpan: r1 - r0 + 1,
      colSpan: c1 - c0 + 1,
      cell: getCellPreviewFromExcelJsCell(topLeft),
    };
  }

  const totalWidthPx = colWidthsPx.reduce((sum, w) => sum + w, 0) || colsCount * EXCEL_DEFAULT_COL_PX;

  return { rowsCount, colsCount, colWidthsPx, rowHeightsPx, totalWidthPx, cells, occupied, mergeStarts, truncated };
}

export function parseExcelJsWorkbookSheet(
  wb: Workbook,
  sheetName: string,
  maxRows: number | null,
  maxCols: number | null
) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    return { grid: [] as string[][], styledPreview: null as StyledSheetPreview | null };
  }

  const styledPreview = buildStyledSheetPreviewFromExcelJs(ws, maxRows, maxCols);
  const grid = safeSheetPreviewGrid(styledPreview.cells.map((row) => row.map((cell) => cell.value)));
  return { grid, styledPreview };
}

export function excelJsSheetNames(wb: Workbook): string[] {
  return wb.worksheets.map((ws) => ws.name);
}
