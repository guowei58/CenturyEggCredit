import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { generateEntityDiligenceIssues } from "@/lib/generateEntityDiligenceIssues";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const [known, verified, candidates] = await Promise.all([
    prisma.knownEntityInput.findMany({ where: { userId, ticker } }),
    prisma.verifiedEntityRecord.findMany({ where: { userId, ticker } }),
    prisma.candidateAffiliateEntity.findMany({ where: { userId, ticker } }),
  ]);

  await prisma.entityDiligenceIssue.deleteMany({ where: { userId, ticker, isSystemGenerated: true } });

  const drafts = generateEntityDiligenceIssues(known, verified, candidates);
  const createdRows = [];
  for (const d of drafts) {
    const row = await prisma.entityDiligenceIssue.create({
      data: {
        userId,
        ticker,
        issueType: d.issueType,
        issueTitle: d.issueTitle,
        issueDescription: d.issueDescription,
        relatedEntityName: d.relatedEntityName,
        relatedEntityId: d.relatedEntityId,
        relatedCandidateId: d.relatedCandidateId,
        severity: d.severity,
        status: "open",
        evidenceJson: (d.evidenceJson ?? {}) as object,
        sourceUrl: d.sourceUrl ?? null,
        isSystemGenerated: true,
      },
    });
    createdRows.push(row);
  }

  return NextResponse.json({ created: createdRows.length });
}
