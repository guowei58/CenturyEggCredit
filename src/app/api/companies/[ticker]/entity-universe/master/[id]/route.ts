import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type { EntityUniverseReviewStatus, Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.entityUniverseItem.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName =
    typeof body.entityName === "string" ? body.entityName.trim() : existing.entityName;
  const normalized =
    typeof body.entityName === "string" ? normalizeEntityName(nextName).normalized : existing.normalizedEntityName;

  const row = await prisma.entityUniverseItem.update({
    where: { id },
    data: {
      entityName: typeof body.entityName === "string" ? nextName : undefined,
      normalizedEntityName: typeof body.entityName === "string" ? normalized : undefined,
      reviewStatus: (body.reviewStatus as EntityUniverseReviewStatus | undefined) ?? undefined,
      relevanceScore: typeof body.relevanceScore === "number" ? body.relevanceScore : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      evidenceJson:
        body.evidenceJson !== undefined ? (body.evidenceJson as Prisma.InputJsonValue) : undefined,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.entityUniverseItem.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entityUniverseItem.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
