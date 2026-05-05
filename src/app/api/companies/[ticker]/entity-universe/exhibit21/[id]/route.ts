import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";

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

  const existing = await prisma.exhibit21Subsidiary.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName = typeof body.entityName === "string" ? body.entityName.trim() : existing.entityName;
  const normalized = normalizeEntityName(nextName).normalized;

  const row = await prisma.exhibit21Subsidiary.update({
    where: { id },
    data: {
      entityName: typeof body.entityName === "string" ? nextName : undefined,
      normalizedEntityName: typeof body.entityName === "string" ? normalized : undefined,
      jurisdiction: typeof body.jurisdiction === "string" ? body.jurisdiction : undefined,
      source10KTitle: typeof body.source10KTitle === "string" ? body.source10KTitle : undefined,
      source10KUrl: typeof body.source10KUrl === "string" ? body.source10KUrl : undefined,
      fiscalYear: typeof body.fiscalYear === "string" ? body.fiscalYear : undefined,
      listedAsSignificant: typeof body.listedAsSignificant === "boolean" ? body.listedAsSignificant : undefined,
      materialityNote: typeof body.materialityNote === "string" ? body.materialityNote : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.exhibit21Subsidiary.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.exhibit21Subsidiary.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
