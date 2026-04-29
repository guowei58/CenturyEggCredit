import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { extractPublicRecordFieldsFromPdf } from "@/lib/extractPublicRecordDocument";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  let body: { documentId?: string; base64?: string };
  try {
    body = (await request.json()) as { documentId?: string; base64?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let buffer: Buffer | null = null;

  if (body.documentId) {
    const doc = await prisma.publicRecordsDocument.findFirst({
      where: { id: body.documentId, userId, ticker },
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    buffer = Buffer.from(doc.body);
  } else if (body.base64) {
    buffer = Buffer.from(body.base64, "base64");
  } else {
    return NextResponse.json({ error: "documentId or base64 required" }, { status: 400 });
  }

  const isPdf =
    buffer!.slice(0, 5).toString("ascii") === "%PDF-" ||
    buffer!.slice(0, 4).toString("ascii") === "%PDF";

  if (!isPdf) {
    return NextResponse.json({
      ok: false,
      message: "Only PDF extraction is supported in MVP; paste fields manually for images.",
      suggestions: {},
      rawTextPreview: "",
    });
  }

  const { rawText, suggestions } = await extractPublicRecordFieldsFromPdf(buffer!);

  if (body.documentId) {
    await prisma.publicRecordsDocument.update({
      where: { id: body.documentId },
      data: { extractedText: rawText.slice(0, 50_000) },
    });
  }

  return NextResponse.json({
    ok: true,
    suggestions,
    rawTextPreview: rawText.slice(0, 8000),
    confirmRequired: true,
  });
}
