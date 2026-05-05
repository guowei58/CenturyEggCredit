import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../_helpers";
import type { CreditDocRelationshipType, CreditDocRelationshipConfidence } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const rels = await prisma.creditDocumentEntityRelationship.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ updatedAt: "desc" }],
  });
  const docIds = [...new Set(rels.map((r) => r.creditDocumentSourceId))];
  const titles =
    docIds.length > 0
      ? await prisma.creditDocumentSource.findMany({
          where: { id: { in: docIds } },
          select: { id: true, documentTitle: true },
        })
      : [];
  const tm = Object.fromEntries(titles.map((t) => [t.id, t.documentTitle]));
  return NextResponse.json({
    relationships: rels.map((r) => ({
      ...serCreditRow(r as unknown as Record<string, unknown>),
      sourceDocumentTitle: tm[r.creditDocumentSourceId] ?? null,
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
  const creditDocumentSourceId =
    typeof body.creditDocumentSourceId === "string" ? body.creditDocumentSourceId.trim() : "";
  const parentEntityName = typeof body.parentEntityName === "string" ? body.parentEntityName.trim() : "";
  const childEntityName = typeof body.childEntityName === "string" ? body.childEntityName.trim() : "";
  if (!creditDocumentSourceId || !parentEntityName || !childEntityName)
    return NextResponse.json({ error: "creditDocumentSourceId, parentEntityName, childEntityName required" }, { status: 400 });

  const src = await prisma.creditDocumentSource.findFirst({
    where: { id: creditDocumentSourceId, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (!src) return NextResponse.json({ error: "Source document not found" }, { status: 404 });

  const relationshipType = (typeof body.relationshipType === "string"
    ? body.relationshipType
    : "parent_subsidiary") as CreditDocRelationshipType;

  const row = await prisma.creditDocumentEntityRelationship.create({
    data: {
      userId: ctx.userId,
      ticker: ctx.ticker,
      creditDocumentSourceId,
      parentEntityName,
      childEntityName,
      relationshipType,
      sourceSection: typeof body.sourceSection === "string" ? body.sourceSection : null,
      sourceSchedule: typeof body.sourceSchedule === "string" ? body.sourceSchedule : null,
      excerpt: typeof body.excerpt === "string" ? body.excerpt : null,
      confidence: (typeof body.confidence === "string" ? body.confidence : "medium") as CreditDocRelationshipConfidence,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });
  return NextResponse.json({ relationship: serCreditRow(row as unknown as Record<string, unknown>) });
}
