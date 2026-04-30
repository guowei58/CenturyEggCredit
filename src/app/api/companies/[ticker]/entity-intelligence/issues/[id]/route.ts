import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";
import type { EntityDiligenceWorkflowStatus } from "@/generated/prisma/client";

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

  const ex = await prisma.entityDiligenceIssue.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.entityDiligenceIssue.update({
    where: { id },
    data: {
      issueTitle: typeof b.issueTitle === "string" ? b.issueTitle : undefined,
      issueDescription: typeof b.issueDescription === "string" ? b.issueDescription : undefined,
      status: (b.status as EntityDiligenceWorkflowStatus | undefined) ?? undefined,
      severity: typeof b.severity === "string" ? (b.severity as never) : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    },
  });
  return NextResponse.json({ item: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const ex = await prisma.entityDiligenceIssue.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entityDiligenceIssue.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
