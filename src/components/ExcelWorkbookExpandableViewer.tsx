"use client";

import type { StyledSheetPreview } from "@/lib/excel-workbook-preview";
import { ExcelStyledSheetPreview } from "@/components/ExcelStyledSheetPreview";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";

export function ExcelWorkbookExpandableViewer({
  title,
  previewName,
  sheetNames,
  activeSheet,
  styledPreview,
  onSheetSelect,
  emptyMessage = "Upload an Excel file to preview all worksheets here.",
  hideTitle = false,
}: {
  title?: string;
  previewName: string;
  sheetNames: string[];
  activeSheet: string;
  styledPreview: StyledSheetPreview | null;
  onSheetSelect: (name: string) => void;
  emptyMessage?: string;
  /** Omit the workbook title row so the preview sits tighter under the card header. */
  hideTitle?: boolean;
}) {
  const hasWorkbook = sheetNames.length > 0 && styledPreview != null;
  const viewerTitle = title ?? (previewName ? previewName : "Excel workbook");

  return (
    <SavedResponseExpandableShell
      title={viewerTitle}
      hideTitle={hideTitle}
      hideHeader={hideTitle && !hasWorkbook}
      className={`min-w-0 flex-1 overflow-hidden excel-workbook-viewer-frame${hideTitle ? " excel-workbook-viewer-frame--compact" : ""}${hideTitle && !hasWorkbook ? " excel-workbook-viewer-frame--empty" : ""} ${SAVED_RESPONSE_FS_FILL_CLASS}`}
      fillViewportMinHeight
    >
      {!hasWorkbook ? (
        <div
          className={`flex min-h-[50vh] flex-1 items-center justify-center px-3 text-center text-sm lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
          style={{ color: "var(--muted2)" }}
        >
          {emptyMessage}
        </div>
      ) : (
        <>
          {sheetNames.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-1 border-b px-1.5 py-1" style={{ borderColor: "var(--border2)" }}>
              {sheetNames.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSheetSelect(n)}
                  className="rounded border px-2.5 py-1 text-[11px] font-medium"
                  style={{
                    borderColor: n === activeSheet ? "var(--accent)" : "var(--border2)",
                    color: n === activeSheet ? "var(--accent)" : "var(--muted2)",
                    background: n === activeSheet ? "rgba(0, 212, 170, 0.08)" : "transparent",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${SAVED_RESPONSE_FS_FILL_CLASS}`}>
            <ExcelStyledSheetPreview
              preview={styledPreview}
              className={`excel-workbook-sheet-preview min-h-[50vh] flex-1 overflow-auto lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
            />
          </div>

          {styledPreview.truncated && (
            <p className="shrink-0 px-1.5 py-1 text-[10px]" style={{ color: "var(--muted2)" }}>
              Large sheet — scroll to see all rows and columns. The uploaded file is preserved in full.
            </p>
          )}
        </>
      )}
    </SavedResponseExpandableShell>
  );
}
