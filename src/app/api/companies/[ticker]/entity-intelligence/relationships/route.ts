import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type { EntityRelationshipType, EntityConfidenceLevel } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const rows = await prisma.entityRelationship.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parentEntityName = typeof b.parentEntityName === "string" ? b.parentEntityName.trim() : "";
  const childEntityName = typeof b.childEntityName === "string" ? b.childEntityName.trim() : "";
  const relationshipType = b.relationshipType as EntityRelationshipType | undefined;
  if (!parentEntityName || !childEntityName || !relationshipType) {
    return NextResponse.json({ error: "parentEntityName, childEntityName, relationshipType required" }, { status: 400 });
  }

  const row = await prisma.entityRelationship.create({
    data: {
      userId,
      ticker,
      parentVerifiedId: typeof b.parentVerifiedId === "string" ? b.parentVerifiedId : null,
      childVerifiedId: typeof b.childVerifiedId === "string" ? b.childVerifiedId : null,
      parentEntityName,
      childEntityName,
      relationshipType,
      evidenceSource: typeof b.evidenceSource === "string" ? b.evidenceSource : null,
      evidenceUrl: typeof b.evidenceUrl === "string" ? b.evidenceUrl : null,
      confidence: (b.confidence as EntityConfidenceLevel | undefined) ?? "medium",
      notes: typeof b.notes === "string" ? b.notes : null,
    },
  });

  return NextResponse.json({ item: row });
}
