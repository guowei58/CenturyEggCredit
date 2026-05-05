import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../_helpers";
import { normalizeEntityName } from "@/lib/entityNormalize";
import type {
  CreditDocDetailedReviewStatus,
  CreditDocWorkflowEntityRole,
  CreditDocExtractionMethod,
  CreditDocExtractionConfidence,
} from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const extractions = await prisma.creditDocumentEntityExtraction.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ updatedAt: "desc" }],
  });
  const docIds = [...new Set(extractions.map((e) => e.creditDocumentSourceId))];
  const sources =
    docIds.length > 0
      ? await prisma.creditDocumentSource.findMany({
          where: { id: { in: docIds } },
          select: { id: true, documentTitle: true },
        })
      : [];
  const titleMap = Object.fromEntries(sources.map((s) => [s.id, s.documentTitle]));
  return NextResponse.json({
    extractions: extractions.map((e) => ({
      ...serCreditRow(e as unknown as Record<string, unknown>),
      sourceDocumentTitle: titleMap[e.creditDocumentSourceId] ?? null,
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const entityName = typeof body.entityName === "string" ? body.entityName.trim() : "";
  const creditDocumentSourceId =
    typeof body.creditDocumentSourceId === "string" ? body.creditDocumentSourceId.trim() : "";
  if (!entityName || !creditDocumentSourceId)
    return NextResponse.json({ error: "entityName and creditDocumentSourceId required" }, { status: 400 });

  const src = await prisma.creditDocumentSource.findFirst({
    where: { id: creditDocumentSourceId, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (!src) return NextResponse.json({ error: "Source document not found" }, { status: 404 });

  const { normalized } = normalizeEntityName(entityName);
  const entityRole = (typeof body.entityRole === "string" ? body.entityRole : "other") as CreditDocWorkflowEntityRole;
  const reviewStatus = (typeof body.reviewStatus === "string" ? body.reviewStatus : "unreviewed") as CreditDocDetailedReviewStatus;
  const extractionMethod = (typeof body.extractionMethod === "string" ? body.extractionMethod : "manual") as CreditDocExtractionMethod;

  const row = await prisma.creditDocumentEntityExtraction.create({
    data: {
      userId: ctx.userId,
      ticker: ctx.ticker,
      creditDocumentSourceId,
      entityName,
      normalizedEntityName: normalized,
      entityRole,
      roleConfidence:
        typeof body.roleConfidence === "string"
          ? (body.roleConfidence as CreditDocExtractionConfidence)
          : "high",
      sourceSection: typeof body.sourceSection === "string" ? body.sourceSection : null,
      sourceSchedule: typeof body.sourceSchedule === "string" ? body.sourceSchedule : null,
      sourceDefinition: typeof body.sourceDefinition === "string" ? body.sourceDefinition : null,
      sourceExhibit: typeof body.sourceExhibit === "string" ? body.sourceExhibit : null,
      pageNumber: typeof body.pageNumber === "string" ? body.pageNumber : null,
      excerpt: typeof body.excerpt === "string" ? body.excerpt : null,
      extractionMethod,
      listedInExhibit21: typeof body.listedInExhibit21 === "boolean" ? body.listedInExhibit21 : false,
      alreadyInEntityUniverse: typeof body.alreadyInEntityUniverse === "boolean" ? body.alreadyInEntityUniverse : false,
      relevanceScore: typeof body.relevanceScore === "number" ? body.relevanceScore : 0,
      reviewStatus,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });
  return NextResponse.json({ extraction: serCreditRow(row as unknown as Record<string, unknown>) });
}
