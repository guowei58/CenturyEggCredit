"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui";

type ExcelUploadItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

function safeSheetPreviewGrid(grid: unknown[][]): string[][] {
  return grid.map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

type PreviewCell = {
  value: string;
  bgColor?: string;
  textColor: string;
  hasBg: boolean;
};

type StyledSheetPreview = {
  rowsCount: number;
  colsCount: number;
  // size hints (approx) to make the preview match Excel's layout more closely
  colWidthsPx: number[];
  rowHeightsPx: number[];
  // table data
  cells: PreviewCell[][];
  // merge layout
  occupied: boolean[][];
  mergeStarts: Array<Array<{ rowSpan: number; colSpan: number; cell: PreviewCell } | null>>;
};

function hexToTextColor(bgHex: string): string {
  const hex = bgHex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#0b0e14";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Bright fills (yellows) should use dark text; dark fills use white text.
  return luminance > 0.6 ? "#0b0e14" : "#ffffff";
}

function getCellPreviewFromXlsxCell(cell?: XLSX.CellObject): PreviewCell {
  const rawValue = cell?.v;
  const value = rawValue == null ? "" : String(rawValue);
  const style = cell?.s as unknown as { bgColor?: { rgb?: string }; fgColor?: { rgb?: string } } | undefined;
  const bgRgb = style?.bgColor?.rgb ?? style?.fgColor?.rgb;
  const bgColor = bgRgb ? `#${bgRgb.replace(/^#/, "")}` : undefined;

  const hasBg = Boolean(bgColor);
  const textColor = bgColor ? hexToTextColor(bgColor) : "#0b0e14";

  return { value, bgColor, textColor, hasBg };
}

function buildStyledSheetPreview(ws: XLSX.WorkSheet, maxRows: number, maxCols: number): StyledSheetPreview {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const startR = range.s.r;
  const startC = range.s.c;
  const rowsCount = Math.max(0, Math.min(maxRows, range.e.r - startR + 1));
  const colsCount = Math.max(0, Math.min(maxCols, range.e.c - startC + 1));

  const colWidthsPx = Array.from({ length: colsCount }, (_, i) => {
    const colMeta = ws["!cols"]?.[startC + i];
    // SheetJS stores widths in pixels as `wpx`; use fallback if missing.
    const wpx = typeof colMeta?.wpx === "number" ? colMeta.wpx : 70;
    return wpx;
  });

  const rowHeightsPx = Array.from({ length: rowsCount }, (_, i) => {
    const rowMeta = ws["!rows"]?.[startR + i];
    const hpx = typeof rowMeta?.hpx === "number" ? rowMeta.hpx : 22;
    return hpx;
  });

  const cells: PreviewCell[][] = Array.from({ length: rowsCount }, () =>
    Array.from({ length: colsCount }, () => ({ value: "", textColor: "#0b0e14", hasBg: false }))
  );

  for (let r = 0; r < rowsCount; r++) {
    for (let c = 0; c < colsCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: startR + r, c: startC + c });
      cells[r][c] = getCellPreviewFromXlsxCell(ws[addr] as XLSX.CellObject | undefined);
    }
  }

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

    // Intersection with preview window
    const r0 = Math.max(mergeR0, startR);
    const c0 = Math.max(mergeC0, startC);
    const r1 = Math.min(mergeR1, startR + rowsCount - 1);
    const c1 = Math.min(mergeC1, startC + colsCount - 1);

    if (r0 > r1 || c0 > c1) continue;

    // Mark occupied cells in the intersecting region.
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        occupied[r - startR][c - startC] = true;
      }
    }

    // Render only at the visible top-left of the intersection.
    const localR0 = r0 - startR;
    const localC0 = c0 - startC;

    const topLeftAddr = XLSX.utils.encode_cell({ r: mergeR0, c: mergeC0 });
    const topLeftCell = getCellPreviewFromXlsxCell(ws[topLeftAddr] as XLSX.CellObject | undefined);

    mergeStarts[localR0][localC0] = {
      rowSpan: r1 - r0 + 1,
      colSpan: c1 - c0 + 1,
      cell: topLeftCell,
    };
  }

  // Ensure unmerged cells are not marked occupied.
  // (We already initialized occupied to false and only mark intersecting merge regions.)
  return { rowsCount, colsCount, colWidthsPx, rowHeightsPx, cells, occupied, mergeStarts };
}

function renderStyledSheetPreview(preview: StyledSheetPreview) {
  return (
    <div
      className="org-chart-excel-preview overflow-auto rounded border"
      style={{
        borderColor: "var(--border2)",
        background: "white",
        maxHeight: 520,
        overflowX: "auto",
        color: "#0b0e14",
      }}
    >
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", fontFamily: "Calibri, Arial, sans-serif" }}>
        <tbody>
          {Array.from({ length: preview.rowsCount }, (_, r) => (
            <tr key={r} style={{ height: `${preview.rowHeightsPx[r]}px` }}>
              {Array.from({ length: preview.colsCount }, (_, c) => {
                if (preview.occupied[r][c]) {
                  const start = preview.mergeStarts[r][c];
                  if (!start) return null;

                  const cell = start.cell;
                  const borderColor = cell.hasBg ? "rgba(0,0,0,0.12)" : "transparent";
                  return (
                    <td
                      key={`m-${r}-${c}`}
                      colSpan={start.colSpan}
                      rowSpan={start.rowSpan}
                      style={{
                        width: `${preview.colWidthsPx[c]}px`,
                        height: `${preview.rowHeightsPx[r]}px`,
                        background: cell.bgColor ?? "transparent",
                        color: cell.textColor,
                        border: `1px solid ${borderColor}`,
                        padding: "2px 4px",
                        verticalAlign: "top",
                        whiteSpace: "pre-wrap",
                        overflow: "hidden",
                        wordBreak: "break-word",
                      }}
                    >
                      {cell.value}
                    </td>
                  );
                }

                const cell = preview.cells[r][c];
                const borderColor = cell.hasBg ? "rgba(0,0,0,0.12)" : "transparent";
                return (
                  <td
                    key={`c-${r}-${c}`}
                    style={{
                      width: `${preview.colWidthsPx[c]}px`,
                      height: `${preview.rowHeightsPx[r]}px`,
                      background: cell.bgColor ?? "transparent",
                      color: cell.textColor,
                      border: `1px solid ${borderColor}`,
                      padding: "2px 4px",
                      verticalAlign: "top",
                      whiteSpace: "pre-wrap",
                      overflow: "hidden",
                      wordBreak: "break-word",
                    }}
                  >
                    {cell.value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderGridToHtmlTable(params: { grid: string[][]; maxRows: number; maxCols: number }) {
  const { grid, maxRows, maxCols } = params;
  const rows = grid.slice(0, maxRows);
  const colCount = Math.max(0, ...rows.map((r) => r.length));
  const cols = Math.min(colCount, maxCols);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {Array.from({ length: cols }).map((_, j) => (
                <td
                  key={j}
                  style={{
                    border: "1px solid var(--border2)",
                    padding: "4px 6px",
                    whiteSpace: "nowrap",
                    color: "var(--text)",
                    background: j === 0 && i === 0 ? "rgba(0, 212, 170, 0.08)" : undefined,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                  }}
                >
                  {row[j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(grid.length > maxRows || colCount > maxCols) && (
        <div className="mt-2 text-[10px]" style={{ color: "var(--muted2)" }}>
          Preview is truncated to the first {maxRows} rows and {maxCols} columns. The uploaded file is preserved in full.
        </div>
      )}
    </div>
  );
}

export function OrgChartExcelFileBox({
  ticker,
  apiBasePath = "/api/org-chart-excel",
  emptyMessage = "Select a company to upload an org-chart Excel file.",
  heading = "Excel File",
  previewMaxRows: previewMaxRowsProp,
  previewMaxCols: previewMaxColsProp,
}: {
  ticker: string;
  apiBasePath?: string;
  emptyMessage?: string;
  /** Section heading above the upload/preview box (default "Excel File"). */
  heading?: string;
  previewMaxRows?: number;
  previewMaxCols?: number;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [items, setItems] = useState<ExcelUploadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [previewName, setPreviewName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [styledPreview, setStyledPreview] = useState<StyledSheetPreview | null>(null);

  // Org charts tend to use a wide range of merged/styled cells; financial models may need more rows.
  const previewMaxRows = previewMaxRowsProp ?? 80;
  const previewMaxCols = previewMaxColsProp ?? 40;

  const latestItem = items[0];
  const latestOpenUrl = useMemo(() => {
    if (!latestItem) return "";
    return `${apiBasePath}/${encodeURIComponent(safeTicker)}?file=${encodeURIComponent(latestItem.filename)}`;
  }, [latestItem, safeTicker, apiBasePath]);

  async function refresh() {
    if (!safeTicker) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as { items?: ExcelUploadItem[]; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Failed to load excel uploads.");
      const arr = Array.isArray(body.items) ? body.items : [];
      setItems(arr);
    } catch (e) {
      setItems([]);
      setStatus(e instanceof Error ? e.message : "Failed to load excel uploads.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAndPreviewLatest() {
    if (!latestItem) return;
    setStatus(null);
    try {
      const res = await fetch(latestOpenUrl);
      if (!res.ok) throw new Error("Could not download uploaded Excel for preview.");
      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellStyles: true, cellNF: true, cellDates: true });
      const names = wb.SheetNames;
      const first = names[0] ?? "";

      setPreviewName(latestItem.filename);
      setSheetNames(names);
      setActiveSheet(first);

      if (first) {
        const ws = wb.Sheets[first];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
        const normalized = safeSheetPreviewGrid(raw);
        setGrid(normalized);
        // Build a preview that applies the worksheet cell fills to restore the box colors.
        // Note: SheetJS CE doesn't provide full shape rendering; this focuses on cell-based rectangles.
        setStyledPreview(buildStyledSheetPreview(ws, previewMaxRows, previewMaxCols));
      } else {
        setGrid([]);
        setStyledPreview(null);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to preview Excel file.");
      setGrid([]);
      setStyledPreview(null);
      setSheetNames([]);
      setActiveSheet("");
    }
  }

  useEffect(() => {
    if (!safeTicker) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeTicker]);

  useEffect(() => {
    void loadAndPreviewLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestItem?.id]);

  useEffect(() => {
    if (!activeSheet) return;
    // If the workbook changed, we'd need to reparse. For simplicity, we only re-render from the already cached grid.
    // Sheet switching will still update the sheet name selector; preview grid is limited to the last parsed sheet.
  }, [activeSheet]);

  async function handleUpload(file: File) {
    if (!safeTicker) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setStatus("Please upload a .xlsx Excel file.");
      return;
    }

    setUploading(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("filename", file.name);

      const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; item?: ExcelUploadItem };
      if (!res.ok || body.ok !== true || !body.item) {
        throw new Error(body?.error ?? "Failed to upload Excel.");
      }

      setStatus("Excel saved.");
      await refresh();

      // Preview immediately from the local file (faster UX).
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const names = wb.SheetNames;
      const first = names[0] ?? "";
      setPreviewName(file.name);
      setSheetNames(names);
      setActiveSheet(first);
      if (first) {
        const ws = wb.Sheets[first];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
        setGrid(safeSheetPreviewGrid(raw));
        setStyledPreview(buildStyledSheetPreview(ws, previewMaxRows, previewMaxCols));
      } else {
        setGrid([]);
        setStyledPreview(null);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to upload Excel.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSheetClick(name: string) {
    if (!name) return;
    // Re-download latest file for consistent multi-sheet preview.
    if (!latestOpenUrl) return;
    try {
      setActiveSheet(name);
      const res = await fetch(latestOpenUrl);
      if (!res.ok) throw new Error("Could not download Excel for sheet preview.");
      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellStyles: true, cellNF: true, cellDates: true });
      const ws = wb.Sheets[name];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
      setGrid(safeSheetPreviewGrid(raw));
      setStyledPreview(buildStyledSheetPreview(ws, previewMaxRows, previewMaxCols));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to preview selected sheet.");
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Excel File">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          {emptyMessage}
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-3 text-sm font-semibold" style={{ color: "var(--text)" }}>
        {heading}
      </div>

      <div
        className="rounded border p-3"
        style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
              disabled={uploading || loading}
            />
            <div className="flex-1" />
            {latestItem && latestOpenUrl && (
              <a
                href={latestOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-[12px]"
                style={{ color: "var(--accent)" }}
                title="Open saved Excel file"
              >
                Open saved
              </a>
            )}
          </div>

          {status && (
            <div className="text-xs" style={{ color: "var(--muted2)" }}>
              {status}
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Preview
            </div>
            <div className="mt-2 text-[11px]" style={{ color: "var(--muted2)" }}>
              {previewName ? `File: ${previewName}` : latestItem ? `File: ${latestItem.filename}` : "No file uploaded yet."}
            </div>

            {sheetNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {sheetNames.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => void handleSheetClick(n)}
                    className="rounded border px-2 py-1 text-[11px] font-medium"
                    style={{
                      borderColor: n === activeSheet ? "var(--accent)" : "var(--border2)",
                      color: n === activeSheet ? "var(--accent)" : "var(--muted2)",
                      background: "transparent",
                    }}
                    disabled={uploading}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3">
              {styledPreview ? (
                renderStyledSheetPreview(styledPreview)
              ) : grid.length > 0 ? (
                renderGridToHtmlTable({ grid, maxRows: previewMaxRows, maxCols: previewMaxCols })
              ) : (
                <div className="text-xs" style={{ color: "var(--muted2)" }}>
                  Upload an Excel file to preview its first sheet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

