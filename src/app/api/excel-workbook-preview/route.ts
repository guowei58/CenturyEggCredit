import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  excelWorkbookPreviewJson,
  parsePreviewMaxParam,
} from "@/lib/excel-workbook-preview-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** POST raw .xlsx bytes and receive styled preview JSON (avoids re-downloading saved files). */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  if (!arrayBuffer.byteLength) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  return excelWorkbookPreviewJson(Buffer.from(arrayBuffer), {
    sheet: url.searchParams.get("sheet"),
    maxRows: parsePreviewMaxParam(url.searchParams.get("maxRows")),
    maxCols: parsePreviewMaxParam(url.searchParams.get("maxCols")),
  });
}
