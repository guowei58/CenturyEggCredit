import * as XLSX from "xlsx";

import { resolvePreviewCellStyle } from "@/lib/xlsx-cell-style-resolver";
import type { XlsxBorderDef } from "@/lib/xlsx-styles-xml";

export type ExcelUploadItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

export type ExcelWorkbookPreviewResult = {
  sheetNames: string[];
  activeSheet: string;
  grid: string[][];
  styledPreview: StyledSheetPreview | null;
};

export type PreviewBorderSide = {
  widthPx: number;
  lineStyle: "solid" | "double" | "dashed" | "dotted";
  color: string;
};

export type PreviewCellBorders = {
  top?: PreviewBorderSide;
  right?: PreviewBorderSide;
  bottom?: PreviewBorderSide;
  left?: PreviewBorderSide;
};

export type PreviewCell = {
  value: string;
  bgColor?: string;
  fillCss?: string;
  textColor: string;
  hasBg: boolean;
  wrapText?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  indent?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  fontSize?: number;
  fontFamily?: string;
  borders?: PreviewCellBorders;
  hasAnyBorder?: boolean;
  hidden?: boolean;
};

export type StyledSheetPreview = {
  rowsCount: number;
  colsCount: number;
  colWidthsPx: number[];
  rowHeightsPx: number[];
  totalWidthPx: number;
  cells: PreviewCell[][];
  occupied: boolean[][];
  mergeStarts: Array<Array<{ rowSpan: number; colSpan: number; cell: PreviewCell } | null>>;
  truncated: boolean;
};

/** Excel default column width (~8.43 characters at Calibri 11). */
export const EXCEL_DEFAULT_COL_PX = 64;

/** Max digit width for Calibri 11 — matches SheetJS column math. */
const EXCEL_MDW = 7;

export function safeSheetPreviewGrid(grid: unknown[][]): string[][] {
  return grid.map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

/** SheetJS / MS-OI29500 column width → pixels. */
export function excelWidthToPx(width: number): number {
  return Math.floor((width + Math.round(128 / EXCEL_MDW) / 256) * EXCEL_MDW);
}

export function excelCharWidthToPx(wch: number): number {
  const width = Math.round(((wch * EXCEL_MDW + 5) / EXCEL_MDW) * 256) / 256;
  return excelWidthToPx(width);
}

export function resolveColWidthPx(colMeta: XLSX.ColInfo | undefined): number | null {
  if (!colMeta) return null;
  if (colMeta.hidden) return 0;
  if (typeof colMeta.wpx === "number" && colMeta.wpx > 0) return colMeta.wpx;
  if (typeof colMeta.wch === "number" && colMeta.wch > 0) return excelCharWidthToPx(colMeta.wch);
  if (typeof colMeta.width === "number" && colMeta.width > 0) return excelWidthToPx(colMeta.width);
  return null;
}

export function resolveRowHeightPx(rowMeta: XLSX.RowInfo | undefined): number {
  if (!rowMeta) return 20;
  if (rowMeta.hidden) return 0;
  if (typeof rowMeta.hpx === "number" && rowMeta.hpx > 0) return rowMeta.hpx;
  if (typeof rowMeta.hpt === "number" && rowMeta.hpt > 0) return Math.round((rowMeta.hpt * 96) / 72);
  return 20;
}

/** Rough Calibri-11 text width for columns missing explicit width metadata. */
export function estimateTextWidthPx(text: string): number {
  let px = 0;
  for (const ch of text) {
    if (ch === " ") px += 4;
    else if (/[iIl1|!.:,;'"`]/.test(ch)) px += 4;
    else if (/[MWwm@%#&]/.test(ch)) px += 10;
    else px += 7;
  }
  return px;
}

export function inferColWidthsFromContent(
  cells: PreviewCell[][],
  rowsCount: number,
  colsCount: number
): number[] {
  return Array.from({ length: colsCount }, (_, c) => {
    let maxPx = 0;
    for (let r = 0; r < rowsCount; r++) {
      const text = cells[r][c]?.value ?? "";
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        maxPx = Math.max(maxPx, estimateTextWidthPx(line));
      }
    }
    if (maxPx <= 0) return EXCEL_DEFAULT_COL_PX;
    return Math.min(560, Math.max(EXCEL_DEFAULT_COL_PX, maxPx + 16));
  });
}

function formatCellDisplayValue(cell?: XLSX.CellObject): string {
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim() !== "") return String(cell.w);
  const raw = cell.v;
  if (raw == null) return "";
  if (raw instanceof Date) {
    return raw.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  }
  return String(raw);
}

function getCellPreviewFromXlsxCell(
  cell?: XLSX.CellObject,
  addr?: string,
  wb?: PreviewWorkbookContext,
  cellStyleIndexes?: Map<string, number>,
  borderDefs?: XlsxBorderDef[]
): PreviewCell {
  const value = formatCellDisplayValue(cell);
  const xfIndex = addr ? cellStyleIndexes?.get(addr.toUpperCase()) : undefined;

  const themePalette = extractThemePalette(wb);
  const styling = resolvePreviewCellStyle(wb?.Styles, xfIndex, cell?.s, {
    themePalette,
    borderDefs,
  });

  const isNumber = typeof cell?.v === "number";
  const textAlign = styling.textAlign ?? (isNumber ? "right" : "left");

  return {
    value,
    ...styling,
    textAlign,
    verticalAlign: styling.verticalAlign ?? "top",
  };
}

export type PreviewWorkbookContext = {
  Styles?: Parameters<typeof resolvePreviewCellStyle>[0];
  Themes?: {
    themeElements?: {
      clrScheme?: Array<{ rgb?: string }>;
    };
  };
};

export function extractThemePalette(wb?: PreviewWorkbookContext): string[] | undefined {
  const scheme = wb?.Themes?.themeElements?.clrScheme;
  if (!Array.isArray(scheme) || scheme.length === 0) return undefined;
  return scheme.map((entry) => {
    const rgb = entry?.rgb?.trim();
    if (!rgb) return "#000000";
    return rgb.startsWith("#") ? rgb : `#${rgb}`;
  });
}

function cellHasVisibleStyle(cell: PreviewCell): boolean {
  return (
    cell.hasBg ||
    cell.bold === true ||
    cell.italic === true ||
    cell.wrapText === true ||
    cell.hasAnyBorder === true ||
    cell.underline === true ||
    cell.strikethrough === true
  );
}

function computeUsedBounds(
  cells: PreviewCell[][],
  occupied: boolean[][],
  mergeStarts: StyledSheetPreview["mergeStarts"],
  rowsCount: number,
  colsCount: number
): { rowsCount: number; colsCount: number } {
  let maxRow = 0;
  let maxCol = 0;

  for (let r = 0; r < rowsCount; r++) {
    for (let c = 0; c < colsCount; c++) {
      const cell = cells[r][c];
      const merge = mergeStarts[r][c];
      const hasContent = Boolean(cell.value.trim());
      const hasStyle = cellHasVisibleStyle(cell);
      if (!hasContent && !hasStyle && !merge) continue;

      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
      if (merge) {
        maxRow = Math.max(maxRow, r + merge.rowSpan - 1);
        maxCol = Math.max(maxCol, c + merge.colSpan - 1);
      }
    }
  }

  return {
    rowsCount: Math.max(1, maxRow + 1),
    colsCount: Math.max(1, maxCol + 1),
  };
}

function trimStyledPreview(preview: StyledSheetPreview): StyledSheetPreview {
  const { rowsCount, colsCount } = computeUsedBounds(
    preview.cells,
    preview.occupied,
    preview.mergeStarts,
    preview.rowsCount,
    preview.colsCount
  );
  if (rowsCount === preview.rowsCount && colsCount === preview.colsCount) return preview;

  const cells = preview.cells.slice(0, rowsCount).map((row) => row.slice(0, colsCount));
  const occupied = preview.occupied.slice(0, rowsCount).map((row) => row.slice(0, colsCount));
  const mergeStarts = preview.mergeStarts.slice(0, rowsCount).map((row) => row.slice(0, colsCount));
  const colWidthsPx = preview.colWidthsPx.slice(0, colsCount);
  const rowHeightsPx = preview.rowHeightsPx.slice(0, rowsCount);
  const totalWidthPx = colWidthsPx.reduce((sum, w) => sum + w, 0);

  return {
    ...preview,
    rowsCount,
    colsCount,
    cells,
    occupied,
    mergeStarts,
    colWidthsPx,
    rowHeightsPx,
    totalWidthPx,
  };
}

export type BuildStyledSheetPreviewOptions = {
  wb?: PreviewWorkbookContext;
  cellStyleIndexes?: Map<string, number>;
  borderDefs?: XlsxBorderDef[];
};

function expandRowHeightsForWrap(
  cells: PreviewCell[][],
  colWidthsPx: number[],
  rowHeightsPx: number[],
  rowsCount: number,
  colsCount: number
): number[] {
  const heights = [...rowHeightsPx];
  for (let r = 0; r < rowsCount; r++) {
    let needed = heights[r] ?? 20;
    for (let c = 0; c < colsCount; c++) {
      const cell = cells[r][c];
      if (!cell.wrapText || !cell.value) continue;
      const colW = Math.max(40, colWidthsPx[c] ?? EXCEL_DEFAULT_COL_PX);
      const fontSize = cell.fontSize ?? 11;
      const linePx = Math.ceil(fontSize * 1.35);
      const lines = cell.value.split(/\r?\n/);
      let totalLines = 0;
      for (const line of lines) {
        const estCharsPerLine = Math.max(8, Math.floor((colW - 12) / (fontSize * 0.55)));
        totalLines += Math.max(1, Math.ceil(line.length / estCharsPerLine));
      }
      needed = Math.max(needed, totalLines * linePx + 6);
    }
    heights[r] = needed;
  }
  return heights;
}

export function buildStyledSheetPreview(
  ws: XLSX.WorkSheet,
  maxRows: number | null,
  maxCols: number | null,
  options?: BuildStyledSheetPreviewOptions
): StyledSheetPreview {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const startR = range.s.r;
  const startC = range.s.c;
  const fullRows = Math.max(0, range.e.r - startR + 1);
  const fullCols = Math.max(0, range.e.c - startC + 1);
  const rowsCount = maxRows == null ? fullRows : Math.max(0, Math.min(maxRows, fullRows));
  const colsCount = maxCols == null ? fullCols : Math.max(0, Math.min(maxCols, fullCols));
  const truncated = rowsCount < fullRows || colsCount < fullCols;

  const cells: PreviewCell[][] = Array.from({ length: rowsCount }, () =>
    Array.from({ length: colsCount }, () => ({ value: "", textColor: "#0b0e14", hasBg: false }))
  );

  const borderDefs = options?.borderDefs;

  for (let r = 0; r < rowsCount; r++) {
    for (let c = 0; c < colsCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: startR + r, c: startC + c });
      cells[r][c] = getCellPreviewFromXlsxCell(
        ws[addr] as XLSX.CellObject | undefined,
        addr,
        options?.wb,
        options?.cellStyleIndexes,
        borderDefs
      );
    }
  }

  const metaWidths = Array.from({ length: colsCount }, (_, i) =>
    resolveColWidthPx(ws["!cols"]?.[startC + i])
  );
  const inferred = inferColWidthsFromContent(cells, rowsCount, colsCount);
  const colWidthsPx = metaWidths.map((w, i) => {
    const inferredW = inferred[i] ?? EXCEL_DEFAULT_COL_PX;
    if (w != null && w > 0) return Math.max(w, inferredW);
    return inferredW;
  });

  const rowHeightsPx = expandRowHeightsForWrap(
    cells,
    colWidthsPx,
    Array.from({ length: rowsCount }, (_, i) => resolveRowHeightPx(ws["!rows"]?.[startR + i])),
    rowsCount,
    colsCount
  );

  const occupied: boolean[][] = Array.from({ length: rowsCount }, () => Array.from({ length: colsCount }, () => false));
  const mergeStarts: StyledSheetPreview["mergeStarts"] = Array.from({ length: rowsCount }, () =>
    Array.from({ length: colsCount }, () => null)
  );

  const merges = Array.isArray(ws["!merges"]) ? ws["!merges"] : [];
  for (const m of merges) {
    const mergeR0 = m.s.r;
    const mergeC0 = m.s.c;
    const mergeR1 = m.e.r;
    const mergeC1 = m.e.c;

    const r0 = Math.max(mergeR0, startR);
    const c0 = Math.max(mergeC0, startC);
    const r1 = Math.min(mergeR1, startR + rowsCount - 1);
    const c1 = Math.min(mergeC1, startC + colsCount - 1);

    if (r0 > r1 || c0 > c1) continue;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        occupied[r - startR][c - startC] = true;
      }
    }

    const localR0 = r0 - startR;
    const localC0 = c0 - startC;
    const topLeftAddr = XLSX.utils.encode_cell({ r: mergeR0, c: mergeC0 });
    const topLeftCell = getCellPreviewFromXlsxCell(
      ws[topLeftAddr] as XLSX.CellObject | undefined,
      topLeftAddr,
      options?.wb,
      options?.cellStyleIndexes,
      borderDefs
    );

    mergeStarts[localR0][localC0] = {
      rowSpan: r1 - r0 + 1,
      colSpan: c1 - c0 + 1,
      cell: topLeftCell,
    };
  }

  const totalWidthPx = colWidthsPx.reduce((sum, w) => sum + w, 0);

  const fullPreview = {
    rowsCount,
    colsCount,
    colWidthsPx,
    rowHeightsPx,
    totalWidthPx,
    cells,
    occupied,
    mergeStarts,
    truncated,
  };

  return trimStyledPreview(fullPreview);
}

export function parseWorkbookSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  maxRows: number | null,
  maxCols: number | null
) {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { grid: [] as string[][], styledPreview: null as StyledSheetPreview | null };
  }
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
  return {
    grid: safeSheetPreviewGrid(raw),
    styledPreview: buildStyledSheetPreview(ws, maxRows, maxCols),
  };
}
