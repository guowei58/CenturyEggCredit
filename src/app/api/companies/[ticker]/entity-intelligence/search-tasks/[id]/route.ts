import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";
import type { EntitySearchTaskWorkflowStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ex = await prisma.entitySearchTask.findFirst({ where: { id, userId, ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.entitySearchTask.update({
    where: { id },
    data: {
      searchStatus: (b.searchStatus as EntitySearchTaskWorkflowStatus | undefined) ?? undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
      resultEntityRecordId:
        typeof b.resultEntityRecordId === "string"
          ? b.resultEntityRecordId
          : b.resultEntityRecordId === null
            ? null
            : undefined,
      checkedAt:
        typeof b.checkedAt === "string"
          ? b.checkedAt
            ? new Date(String(b.checkedAt))
            : null
          : undefined,
    },
  });

  return NextResponse.json({ item: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const ex = await prisma.entitySearchTask.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entitySearchTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
