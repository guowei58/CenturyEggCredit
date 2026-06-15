"use client";

import type { PreviewBorderSide, PreviewCell, StyledSheetPreview } from "@/lib/excel-workbook-preview";

function rowSpanHeight(preview: StyledSheetPreview, row: number, rowSpan: number): number {
  let h = 0;
  for (let i = 0; i < rowSpan; i++) {
    h += preview.rowHeightsPx[row + i] ?? 20;
  }
  return h;
}

function borderSideCss(side: PreviewBorderSide | undefined, fallback: string): string {
  if (!side) return fallback;
  return `${side.widthPx}px ${side.lineStyle} ${side.color}`;
}

function cellTdStyle(cell: PreviewCell, heightPx: number) {
  const wrap = cell.wrapText === true;
  const fontSize = cell.fontSize ?? 11;
  const fontFamily = cell.fontFamily ?? "Calibri, Arial, sans-serif";
  const verticalAlign =
    cell.verticalAlign === "middle" ? "middle" : cell.verticalAlign === "bottom" ? "bottom" : "top";

  const decorations: string[] = [];
  if (cell.underline) decorations.push("underline");
  if (cell.strikethrough) decorations.push("line-through");

  const indentPx = (cell.indent ?? 0) * 10;
  const padLeft = 3 + indentPx;
  const padRight = 3;

  const background = cell.fillCss ?? cell.bgColor ?? "transparent";
  const gridLine = cell.hasBg ? "rgba(0,0,0,0.12)" : "#d4d4d4";

  return {
    height: `${heightPx}px`,
    minHeight: `${heightPx}px`,
    maxHeight: wrap ? undefined : `${heightPx}px`,
    background,
    color: cell.textColor,
    borderTop: borderSideCss(cell.borders?.top, `1px solid ${gridLine}`),
    borderRight: borderSideCss(cell.borders?.right, `1px solid ${gridLine}`),
    borderBottom: borderSideCss(cell.borders?.bottom, `1px solid ${gridLine}`),
    borderLeft: borderSideCss(cell.borders?.left, `1px solid ${gridLine}`),
    padding: `2px ${padRight}px 2px ${padLeft}px`,
    verticalAlign: verticalAlign as "top" | "middle" | "bottom",
    textAlign: cell.textAlign ?? "left",
    fontWeight: cell.bold ? ("700" as const) : ("400" as const),
    fontStyle: cell.italic ? ("italic" as const) : ("normal" as const),
    textDecoration: decorations.length > 0 ? decorations.join(" ") : undefined,
    whiteSpace: wrap ? ("pre-wrap" as const) : ("nowrap" as const),
    overflow: wrap ? ("visible" as const) : ("hidden" as const),
    textOverflow: wrap ? undefined : ("clip" as const),
    wordBreak: wrap ? ("break-word" as const) : ("normal" as const),
    fontSize: `${fontSize}pt`,
    lineHeight: 1.15,
    fontFamily,
    boxSizing: "border-box" as const,
  };
}

export function ExcelStyledSheetPreview({
  preview,
  className = "",
  maxHeight,
}: {
  preview: StyledSheetPreview;
  className?: string;
  maxHeight?: number;
}) {
  return (
    <div
      className={`org-chart-excel-preview overflow-auto rounded border ${className}`.trim()}
      style={{
        borderColor: "var(--border2)",
        background: "white",
        overflowX: "auto",
        color: "#0b0e14",
        ...(maxHeight != null ? { maxHeight } : {}),
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          tableLayout: "fixed",
          width: `${preview.totalWidthPx}px`,
          minWidth: `${preview.totalWidthPx}px`,
          background: "white",
        }}
      >
        <colgroup>
          {preview.colWidthsPx.map((w, i) => (
            <col
              key={i}
              style={{
                width: `${w}px`,
                minWidth: `${w}px`,
                maxWidth: `${w}px`,
                ...(w <= 0 ? { display: "none" } : {}),
              }}
            />
          ))}
        </colgroup>
        <tbody>
          {Array.from({ length: preview.rowsCount }, (_, r) => {
            const rowHidden = preview.rowHeightsPx[r] <= 0;
            if (rowHidden) return null;

            return (
              <tr key={r} style={{ height: `${preview.rowHeightsPx[r]}px` }}>
                {Array.from({ length: preview.colsCount }, (_, c) => {
                  if ((preview.colWidthsPx[c] ?? 0) <= 0) return null;

                  if (preview.occupied[r][c]) {
                    const start = preview.mergeStarts[r][c];
                    if (!start) return null;
                    const cell = start.cell;
                    const h = rowSpanHeight(preview, r, start.rowSpan);
                    return (
                      <td
                        key={`m-${r}-${c}`}
                        colSpan={start.colSpan}
                        rowSpan={start.rowSpan}
                        style={cellTdStyle(cell, h)}
                      >
                        {cell.value}
                      </td>
                    );
                  }

                  const cell = preview.cells[r][c];
                  return (
                    <td key={`c-${r}-${c}`} style={cellTdStyle(cell, preview.rowHeightsPx[r])}>
                      {cell.value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
