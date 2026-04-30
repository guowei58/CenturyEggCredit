import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type { EntityDiligenceIssueKind, EntityDiligenceSeverity, EntityDiligenceWorkflowStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const rows = await prisma.entityDiligenceIssue.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ severity: "desc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const issueType = b.issueType as EntityDiligenceIssueKind | undefined;
  const issueTitle = typeof b.issueTitle === "string" ? b.issueTitle.trim() : "";
  const issueDescription = typeof b.issueDescription === "string" ? b.issueDescription.trim() : "";
  const severity = b.severity as EntityDiligenceSeverity | undefined;
  if (!issueType || !issueTitle || !issueDescription || !severity) {
    return NextResponse.json({ error: "issueType, issueTitle, issueDescription, severity required" }, { status: 400 });
  }

  const row = await prisma.entityDiligenceIssue.create({
    data: {
      userId,
      ticker,
      issueType,
      issueTitle,
      issueDescription,
      relatedEntityName: typeof b.relatedEntityName === "string" ? b.relatedEntityName : null,
      relatedEntityId: typeof b.relatedEntityId === "string" ? b.relatedEntityId : null,
      relatedCandidateId: typeof b.relatedCandidateId === "string" ? b.relatedCandidateId : null,
      severity,
      status: (b.status as EntityDiligenceWorkflowStatus | undefined) ?? "open",
      evidenceJson: typeof b.evidenceJson === "object" && b.evidenceJson !== null ? (b.evidenceJson as object) : undefined,
      sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : null,
      notes: typeof b.notes === "string" ? b.notes : null,
      isSystemGenerated: Boolean(b.isSystemGenerated),
    },
  });

  return NextResponse.json({ item: row });
}
