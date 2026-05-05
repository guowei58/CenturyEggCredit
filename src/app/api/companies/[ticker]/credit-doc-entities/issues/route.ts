import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../_helpers";
import type {
  CreditDocWorkflowIssueSeverity,
  CreditDocWorkflowIssueWorkflowStatus,
} from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const issues = await prisma.creditDocWorkflowIssue.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({
    issues: issues.map((i) => serCreditRow(i as unknown as Record<string, unknown>)),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const issueType = typeof body.issueType === "string" ? body.issueType.trim() : "";
  const issueTitle = typeof body.issueTitle === "string" ? body.issueTitle.trim() : "";
  const issueDescription = typeof body.issueDescription === "string" ? body.issueDescription.trim() : "";
  const severity = (typeof body.severity === "string" ? body.severity : "medium") as CreditDocWorkflowIssueSeverity;
  if (!issueType || !issueTitle || !issueDescription)
    return NextResponse.json({ error: "issueType, issueTitle, issueDescription required" }, { status: 400 });

  const row = await prisma.creditDocWorkflowIssue.create({
    data: {
      userId: ctx.userId,
      ticker: ctx.ticker,
      issueType,
      issueTitle,
      issueDescription,
      entityName: typeof body.entityName === "string" ? body.entityName : null,
      severity,
      excerpt: typeof body.excerpt === "string" ? body.excerpt : null,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      suggestedFollowUp: typeof body.suggestedFollowUp === "string" ? body.suggestedFollowUp : null,
      status: (typeof body.status === "string" ? body.status : "open") as CreditDocWorkflowIssueWorkflowStatus,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });
  return NextResponse.json({ issue: serCreditRow(row as unknown as Record<string, unknown>) });
}
