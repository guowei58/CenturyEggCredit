import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getHistoricalFinancialsPersonalTemplateBuffer,
  listHistoricalFinancialsPersonalTemplates,
  saveHistoricalFinancialsPersonalTemplateFile,
} from "@/lib/historical-financials-personal-templates";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function asciiFilename(name: string): string {
  const s = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return s.length > 0 ? s : "template.xlsx";
}

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const file = url.searchParams.get("file");

  if (file) {
    const buf = await getHistoricalFinancialsPersonalTemplateBuffer(userId, file);
    if (!buf) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const items = await listHistoricalFinancialsPersonalTemplates(userId);
    const match = items.find((it) => it.filename === file);
    const disp = asciiFilename(match?.originalName ?? file);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${disp}"`,
      },
    });
  }

  const items = await listHistoricalFinancialsPersonalTemplates(userId);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const originalName = (formData.get("filename") as string | null) ?? "historical-financials-template.xlsx";
  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  const result = await saveHistoricalFinancialsPersonalTemplateFile({
    userId,
    fileBuffer: buf,
    originalName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: result.item });
}
