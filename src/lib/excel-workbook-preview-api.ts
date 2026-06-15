import { NextResponse } from "next/server";

import { buildExcelPreviewFromBuffer } from "@/lib/exceljs-workbook-preview.server";

export function parsePreviewMaxParam(value: string | null): number | null {
  if (value == null || value === "" || value === "null") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export async function excelWorkbookPreviewJson(
  buf: Buffer,
  options: {
    sheet?: string | null;
    maxRows?: number | null;
    maxCols?: number | null;
  }
) {
  try {
    const result = await buildExcelPreviewFromBuffer(
      buf,
      options.sheet ?? undefined,
      options.maxRows ?? null,
      options.maxCols ?? null
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse Excel workbook." },
      { status: 500 }
    );
  }
}

export function isPreviewRequest(previewParam: string | null): boolean {
  return previewParam === "1" || previewParam === "true";
}
