import "server-only";

import * as XLSX from "xlsx-js-style";

import {
  buildStyledSheetPreview,
  safeSheetPreviewGrid,
  type ExcelWorkbookPreviewResult,
  type PreviewWorkbookContext,
} from "@/lib/excel-workbook-preview";
import {
  parseWorksheetCellStyleIndexes,
  worksheetPathForSheetName,
} from "@/lib/xlsx-worksheet-style-indexes";
import { parseWorkbookBordersFromStylesXml } from "@/lib/xlsx-styles-xml";

export type { ExcelWorkbookPreviewResult };

export function loadXlsxStyleWorkbook(buf: Buffer | ArrayBuffer): XLSX.WorkBook {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return XLSX.read(data, { type: "buffer", cellStyles: true, cellNF: true, cellDates: true });
}

function previewWorkbookContext(wb: XLSX.WorkBook): PreviewWorkbookContext {
  const extended = wb as XLSX.WorkBook & PreviewWorkbookContext;
  return { Styles: extended.Styles, Themes: extended.Themes };
}

export async function buildExcelPreviewFromBuffer(
  buf: Buffer | ArrayBuffer,
  sheetName?: string,
  maxRows: number | null = null,
  maxCols: number | null = null
): Promise<ExcelWorkbookPreviewResult> {
  const wb = loadXlsxStyleWorkbook(buf);
  const sheetNames = wb.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return { sheetNames: [], activeSheet: "", grid: [], styledPreview: null };
  }

  const activeSheet =
    sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0] ?? "";
  const ws = wb.Sheets[activeSheet];
  if (!ws) {
    return { sheetNames, activeSheet, grid: [], styledPreview: null };
  }

  const sheetPath = worksheetPathForSheetName(wb, activeSheet);
  const [cellStyleIndexes, borderDefs] = await Promise.all([
    parseWorksheetCellStyleIndexes(buf, sheetPath),
    parseWorkbookBordersFromStylesXml(buf),
  ]);

  const styledPreview = buildStyledSheetPreview(ws, maxRows, maxCols, {
    wb: previewWorkbookContext(wb),
    cellStyleIndexes,
    borderDefs,
  });
  const grid = safeSheetPreviewGrid(styledPreview.cells.map((row) => row.map((cell) => cell.value)));
  return { sheetNames, activeSheet, grid, styledPreview };
}
