import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getSharedHistoricalFinancialsTemplateBuffer,
  getSharedHistoricalFinancialsTemplateMeta,
  upsertSharedHistoricalFinancialsTemplate,
} from "@/lib/app-shared-historical-financials-template";
import { canUploadSharedHistoricalFinancialsTemplate } from "@/lib/historical-financials-shared-template-admin";
import {
  getHistoricalFinancialsPersonalTemplateBuffer,
  listHistoricalFinancialsPersonalTemplates,
} from "@/lib/historical-financials-personal-templates";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function asciiFilename(name: string): string {
  const s = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return s.length > 0 ? s : "historical-financials-template.xlsx";
}

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  if (url.searchParams.get("download") === "1") {
    const buf = await getSharedHistoricalFinancialsTemplateBuffer();
    if (!buf?.length) return NextResponse.json({ error: "No shared template uploaded yet" }, { status: 404 });
    const meta = await getSharedHistoricalFinancialsTemplateMeta();
    const fn = asciiFilename(meta?.filename ?? "historical-financials-template.xlsx");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fn}"`,
      },
    });
  }

  const meta = await getSharedHistoricalFinancialsTemplateMeta();
  return NextResponse.json({
    exists: Boolean(meta),
    meta,
    canUpload: canUploadSharedHistoricalFinancialsTemplate(userId),
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUploadSharedHistoricalFinancialsTemplate(userId)) {
    return NextResponse.json(
      {
        error:
          "Shared template upload is restricted. Set HISTORICAL_FINANCIALS_SHARED_TEMPLATE_ADMIN_USER_IDS to a comma-separated list of your user id(s).",
      },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const promoteKey = (formData.get("promoteFromPersonalFilename") as string | null)?.trim();
  if (promoteKey) {
    const buf = await getHistoricalFinancialsPersonalTemplateBuffer(userId, promoteKey);
    if (!buf?.length) {
      return NextResponse.json({ error: "Private template not found or empty" }, { status: 404 });
    }
    if (buf.length > 16_000_000) {
      return NextResponse.json({ error: "File too large (max 16MB)." }, { status: 400 });
    }
    const personal = await listHistoricalFinancialsPersonalTemplates(userId);
    const row = personal.find((p) => p.filename === promoteKey);
    const displayName = row?.originalName?.trim() || "historical-financials-template.xlsx";
    if (!displayName.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Private template must be .xlsx" }, { status: 400 });
    }
    await upsertSharedHistoricalFinancialsTemplate({
      filename: displayName,
      body: buf,
      updatedByUserId: userId,
    });
    const meta = await getSharedHistoricalFinancialsTemplateMeta();
    return NextResponse.json({ ok: true, meta });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing file. Upload a .xlsx, or promote a private template with promoteFromPersonalFilename." },
      { status: 400 }
    );
  }

  const originalName = (formData.get("filename") as string | null) ?? "historical-financials-template.xlsx";
  if (!originalName.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "Please upload a .xlsx file." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (!buf.length) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  if (buf.length > 16_000_000) {
    return NextResponse.json({ error: "File too large (max 16MB)." }, { status: 400 });
  }

  await upsertSharedHistoricalFinancialsTemplate({
    filename: originalName.trim() || "historical-financials-template.xlsx",
    body: buf,
    updatedByUserId: userId,
  });

  const meta = await getSharedHistoricalFinancialsTemplateMeta();
  return NextResponse.json({ ok: true, meta });
}
