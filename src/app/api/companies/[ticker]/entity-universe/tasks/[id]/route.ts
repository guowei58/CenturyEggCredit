import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type { EntityUniverseDiscoveryTaskWorkflowStatus } from "@/generated/prisma/client";

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

  const existing = await prisma.entityUniverseDiscoveryTask.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.entityUniverseDiscoveryTask.update({
    where: { id },
    data: {
      status: (body.status as EntityUniverseDiscoveryTaskWorkflowStatus | undefined) ?? undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      searchTerm: typeof body.searchTerm === "string" ? body.searchTerm : undefined,
      state: typeof body.state === "string" ? body.state : undefined,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      instructions: typeof body.instructions === "string" ? body.instructions : undefined,
      checkedAt: body.checkedAt === null ? null : typeof body.checkedAt === "string" ? new Date(body.checkedAt) : undefined,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.entityUniverseDiscoveryTask.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entityUniverseDiscoveryTask.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
