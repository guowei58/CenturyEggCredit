import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../../_helpers";
import type {
  CreditDocWorkflowIssueSeverity,
  CreditDocWorkflowIssueWorkflowStatus,
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

  const exists = await prisma.creditDocWorkflowIssue.findFirst({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.creditDocWorkflowIssue.update({
    where: { id },
    data: {
      status:
        typeof body.status === "string" ? (body.status as CreditDocWorkflowIssueWorkflowStatus) : undefined,
      severity: typeof body.severity === "string" ? (body.severity as CreditDocWorkflowIssueSeverity) : undefined,
      notes: typeof body.notes === "string" || body.notes === null ? (body.notes as string | null) : undefined,
      issueTitle: typeof body.issueTitle === "string" ? body.issueTitle : undefined,
      issueDescription: typeof body.issueDescription === "string" ? body.issueDescription : undefined,
    },
  });
  return NextResponse.json({ issue: serCreditRow(updated as unknown as Record<string, unknown>) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const del = await prisma.creditDocWorkflowIssue.deleteMany({
    where: { id, userId: ctx.userId, ticker: ctx.ticker },
  });
  if (del.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
