import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { generateCreditDocEntityIssues } from "@/lib/creditDocs/generateCreditDocEntityIssues";
import type { RoleFlagTriState } from "@/lib/creditDocs/matrixRoleKeys";
import type { CreditDocWorkflowIssueWorkflowStatus } from "@/generated/prisma/client";

const REGEN_ISSUE_TYPES = ["borrower_not_in_exhibit_21", "guarantor_not_in_exhibit_21", "entity_role_unclear"] as const;

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const rows = await prisma.creditDocumentEntityRoleMatrixRow.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
  });

  await prisma.creditDocWorkflowIssue.deleteMany({
    where: {
      userId: ctx.userId,
      ticker: ctx.ticker,
      issueType: { in: [...REGEN_ISSUE_TYPES] },
      status: "open",
    },
  });

  const drafts = generateCreditDocEntityIssues(
    rows.map((r) => ({
      entityName: r.entityName,
      reconciliationFlagsJson: (r.reconciliationFlagsJson as Record<string, boolean> | null) ?? {},
      roleFlagsJson: (r.roleFlagsJson as Record<string, RoleFlagTriState | string> | null) ?? {},
      keyEvidence: r.keyEvidence,
    }))
  );

  const created = await prisma.$transaction(
    drafts.map((d) =>
      prisma.creditDocWorkflowIssue.create({
        data: {
          userId: ctx.userId,
          ticker: ctx.ticker,
          issueType: d.issueType,
          issueTitle: d.issueTitle,
          issueDescription: d.issueDescription,
          entityName: d.entityName,
          severity: d.severity,
          excerpt: d.excerpt,
          suggestedFollowUp: d.suggestedFollowUp,
          status: "open" satisfies CreditDocWorkflowIssueWorkflowStatus,
        },
      })
    )
  );

  return NextResponse.json({ created: created.length });
}
