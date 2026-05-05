import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";
import { processCreditDocumentSource } from "@/lib/creditDocs/processCreditDocumentSource";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string; documentId: string }> }) {
  const { ticker: raw, documentId } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  try {
    const result = await processCreditDocumentSource(prisma, {
      userId: ctx.userId,
      ticker: ctx.ticker,
      documentId,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Process failed";
    if (msg === "Document not found") return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
