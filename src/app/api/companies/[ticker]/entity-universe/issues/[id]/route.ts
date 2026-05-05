import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type { EntityUniverseIssueWorkflowStatus } from "@/generated/prisma/client";

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

  const existing = await prisma.entityUniverseIssue.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.entityUniverseIssue.update({
    where: { id },
    data: {
      status: (body.status as EntityUniverseIssueWorkflowStatus | undefined) ?? undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      issueTitle: typeof body.issueTitle === "string" ? body.issueTitle : undefined,
      issueDescription: typeof body.issueDescription === "string" ? body.issueDescription : undefined,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.entityUniverseIssue.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entityUniverseIssue.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
