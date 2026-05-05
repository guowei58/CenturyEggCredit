import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../../_helpers";
import type { CreditDocDetailedReviewStatus } from "@/generated/prisma/client";

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

  const row = await prisma.creditDocumentEntityRoleMatrixRow.findFirst({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: {
    reviewStatus?: CreditDocDetailedReviewStatus;
    notes?: string | null;
    keyEvidence?: string | null;
    state?: string;
    jurisdiction?: string;
    roleFlagsJson?: Record<string, unknown>;
  } = {};
  if (typeof body.reviewStatus === "string") data.reviewStatus = body.reviewStatus as CreditDocDetailedReviewStatus;
  if (typeof body.notes === "string" || body.notes === null) data.notes = body.notes as string | null;
  if (typeof body.keyEvidence === "string" || body.keyEvidence === null) data.keyEvidence = body.keyEvidence as string | null;
  if (typeof body.state === "string") data.state = body.state;
  if (typeof body.jurisdiction === "string") data.jurisdiction = body.jurisdiction;
  if (body.roleFlagsJson !== undefined && body.roleFlagsJson !== null && typeof body.roleFlagsJson === "object")
    data.roleFlagsJson = body.roleFlagsJson as Record<string, unknown>;

  const updated = await prisma.creditDocumentEntityRoleMatrixRow.update({
    where: { id },
    data: data as Parameters<typeof prisma.creditDocumentEntityRoleMatrixRow.update>[0]["data"],
  });
  return NextResponse.json({ row: serCreditRow(updated as unknown as Record<string, unknown>) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const del = await prisma.creditDocumentEntityRoleMatrixRow.deleteMany({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (del.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
