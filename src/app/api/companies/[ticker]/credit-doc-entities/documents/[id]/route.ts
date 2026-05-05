import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../../_helpers";
import type { CreditDocSourceProcessingStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Parameters<typeof prisma.creditDocumentSource.update>[0]["data"] = {};
  const str = (k: string) => (typeof body[k] === "string" ? body[k] as string : undefined);
  if (typeof body.notes === "string" || body.notes === null) data.notes = body.notes as string | null;
  if (typeof body.documentTitle === "string") data.documentTitle = body.documentTitle.trim();
  if (typeof body.candidateRelevant === "boolean" || body.candidateRelevant === null)
    data.candidateRelevant = body.candidateRelevant as boolean | null;
  if (typeof body.processingStatus === "string")
    data.processingStatus = body.processingStatus as CreditDocSourceProcessingStatus;
  const fd = str("filingDate");
  if (fd) data.filingDate = new Date(fd);
  if (typeof body.secUrl === "string") data.secUrl = body.secUrl || null;
  if (typeof body.sourceUrl === "string") data.sourceUrl = body.sourceUrl || null;
  const ex = str("exhibitNumber");
  if (ex !== undefined) data.exhibitNumber = ex || null;

  const updated = await prisma.creditDocumentSource.updateMany({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
    data,
  });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = await prisma.creditDocumentSource.findFirst({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  return NextResponse.json({ document: serCreditRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const del = await prisma.creditDocumentSource.deleteMany({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (del.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
