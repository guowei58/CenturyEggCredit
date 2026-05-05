import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../../_helpers";
import { normalizeEntityName } from "@/lib/entityNormalize";
import type {
  CreditDocDetailedReviewStatus,
  CreditDocWorkflowEntityRole,
  CreditDocExtractionConfidence,
  CreditDocExtractionMethod,
} from "@/generated/prisma/client";

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

  const exists = await prisma.creditDocumentEntityExtraction.findFirst({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Parameters<typeof prisma.creditDocumentEntityExtraction.update>[0]["data"] = {};
  if (typeof body.entityName === "string" && body.entityName.trim()) {
    data.entityName = body.entityName.trim();
    data.normalizedEntityName = normalizeEntityName(body.entityName.trim()).normalized;
  }
  if (typeof body.entityRole === "string") data.entityRole = body.entityRole as CreditDocWorkflowEntityRole;
  if (typeof body.reviewStatus === "string") data.reviewStatus = body.reviewStatus as CreditDocDetailedReviewStatus;
  if (typeof body.notes === "string" || body.notes === null) data.notes = body.notes as string | null;
  if (typeof body.excerpt === "string" || body.excerpt === null) data.excerpt = body.excerpt as string | null;
  if (typeof body.sourceSection === "string" || body.sourceSection === null)
    data.sourceSection = body.sourceSection as string | null;
  if (typeof body.sourceSchedule === "string" || body.sourceSchedule === null)
    data.sourceSchedule = body.sourceSchedule as string | null;
  if (typeof body.roleConfidence === "string") data.roleConfidence = body.roleConfidence as CreditDocExtractionConfidence;
  if (typeof body.extractionMethod === "string") data.extractionMethod = body.extractionMethod as CreditDocExtractionMethod;
  if (typeof body.listedInExhibit21 === "boolean") data.listedInExhibit21 = body.listedInExhibit21;
  if (typeof body.alreadyInEntityUniverse === "boolean") data.alreadyInEntityUniverse = body.alreadyInEntityUniverse;
  if (typeof body.relevanceScore === "number") data.relevanceScore = body.relevanceScore;

  const updated = await prisma.creditDocumentEntityExtraction.update({
    where: { id },
    data,
  });
  return NextResponse.json({ extraction: serCreditRow(updated as unknown as Record<string, unknown>) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const del = await prisma.creditDocumentEntityExtraction.deleteMany({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (del.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
