import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  deleteCreditMemoTemplate,
  listCreditMemoTemplates,
  saveCreditMemoTemplateDocx,
  setActiveCreditMemoTemplate,
} from "@/lib/creditMemo/templateStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idx = await listCreditMemoTemplates(userId);
  return NextResponse.json({ index: idx });
}

/**
 * POST multipart/form-data with field `file` (docx).
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const action = (url.searchParams.get("action") || "").toLowerCase();
  if (action === "select") {
    let body: { templateId?: string };
    try {
      body = (await req.json()) as { templateId?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const id = typeof body.templateId === "string" ? body.templateId.trim() : "";
    if (!id) return NextResponse.json({ error: "templateId required" }, { status: 400 });
    const idx = await setActiveCreditMemoTemplate(userId, id);
    return NextResponse.json({ ok: true, index: idx });
  }
  if (action === "delete") {
    let body: { templateId?: string };
    try {
      body = (await req.json()) as { templateId?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const id = typeof body.templateId === "string" ? body.templateId.trim() : "";
    if (!id) return NextResponse.json({ error: "templateId required" }, { status: 400 });
    const idx = await deleteCreditMemoTemplate(userId, id);
    return NextResponse.json({ ok: true, index: idx });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ error: "Template must be a .docx file" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 1000) {
    return NextResponse.json({ error: "Template file too small" }, { status: 400 });
  }

  const tpl = await saveCreditMemoTemplateDocx(userId, { filename: file.name, bytes });
  const idx = await listCreditMemoTemplates(userId);
  return NextResponse.json({ ok: true, template: tpl, index: idx });
}
