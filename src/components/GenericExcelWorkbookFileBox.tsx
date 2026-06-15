"use client";

import { Card } from "@/components/ui";
import { ExcelStyledSheetPreview } from "@/components/ExcelStyledSheetPreview";
import { useExcelWorkbookUpload } from "@/hooks/useExcelWorkbookUpload";

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
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
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

/** Inline upload + preview for tabs that have not migrated to Provider / Viewer split. */
export function GenericExcelWorkbookFileBox({
  ticker,
  apiBasePath = "/api/org-chart-excel",
  emptyMessage = "Select a company to upload an Excel file.",
  heading = "Excel File",
  previewMaxRows: previewMaxRowsProp,
  previewMaxCols: previewMaxColsProp,
}: {
  ticker: string;
  apiBasePath?: string;
  emptyMessage?: string;
  heading?: string;
  previewMaxRows?: number;
  previewMaxCols?: number;
}) {
  const previewMaxRows = previewMaxRowsProp ?? 80;
  const previewMaxCols = previewMaxColsProp ?? 40;

  const {
    safeTicker,
    loading,
    uploading,
    status,
    previewName,
    sheetNames,
    activeSheet,
    grid,
    styledPreview,
    latestItem,
    latestOpenUrl,
    handleUpload,
    handleSheetSelect,
  } = useExcelWorkbookUpload({
    ticker,
    apiBasePath,
    previewMaxRows,
    previewMaxCols,
  });

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
                    onClick={() => void handleSheetSelect(n)}
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
                <ExcelStyledSheetPreview preview={styledPreview} maxHeight={520} />
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
