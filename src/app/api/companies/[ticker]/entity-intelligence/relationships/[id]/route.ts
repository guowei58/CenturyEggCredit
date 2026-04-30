import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ex = await prisma.entityRelationship.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.entityRelationship.update({
    where: { id },
    data: {
      parentEntityName: typeof b.parentEntityName === "string" ? b.parentEntityName : undefined,
      childEntityName: typeof b.childEntityName === "string" ? b.childEntityName : undefined,
      relationshipType: typeof b.relationshipType === "string" ? (b.relationshipType as never) : undefined,
      confidence: typeof b.confidence === "string" ? (b.confidence as never) : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    },
  });
  return NextResponse.json({ item: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const ex = await prisma.entityRelationship.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entityRelationship.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
