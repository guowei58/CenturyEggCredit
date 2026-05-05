import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../../_helpers";
import type {
  CreditDocRelationshipType,
  CreditDocRelationshipConfidence,
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

  const exists = await prisma.creditDocumentEntityRelationship.findFirst({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.creditDocumentEntityRelationship.update({
    where: { id },
    data: {
      parentEntityName: typeof body.parentEntityName === "string" ? body.parentEntityName.trim() : undefined,
      childEntityName: typeof body.childEntityName === "string" ? body.childEntityName.trim() : undefined,
      relationshipType:
        typeof body.relationshipType === "string" ? (body.relationshipType as CreditDocRelationshipType) : undefined,
      sourceSection: typeof body.sourceSection === "string" || body.sourceSection === null ? (body.sourceSection as string | null) : undefined,
      sourceSchedule:
        typeof body.sourceSchedule === "string" || body.sourceSchedule === null ? (body.sourceSchedule as string | null) : undefined,
      excerpt: typeof body.excerpt === "string" || body.excerpt === null ? (body.excerpt as string | null) : undefined,
      confidence:
        typeof body.confidence === "string" ? (body.confidence as CreditDocRelationshipConfidence) : undefined,
      notes: typeof body.notes === "string" || body.notes === null ? (body.notes as string | null) : undefined,
    },
  });
  return NextResponse.json({ relationship: serCreditRow(updated as unknown as Record<string, unknown>) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const del = await prisma.creditDocumentEntityRelationship.deleteMany({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (del.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
