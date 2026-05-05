import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateEntityUniverseIssuesFromLayers } from "@/lib/generateEntityUniverseIssues";
import { requireUserTicker } from "../_helpers";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/** Recomputes diligence flags from captured layers & master snapshot (destructive refresh). */
export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const cd = await prisma.creditDocumentEntity.findMany({
    where: { userId, ticker },
    select: { entityName: true, listedInExhibit21: true, entityRole: true },
  });
  const ucc = await prisma.uccDebtorCandidate.findMany({
    where: { userId, ticker },
    select: {
      debtorName: true,
      listedInExhibit21: true,
      appearsInCreditDocs: true,
      collateralDescription: true,
      confidence: true,
      relevanceScore: true,
    },
  });
  const sos = await prisma.sosNameFamilyCandidate.findMany({
    where: { userId, ticker },
    select: {
      candidateEntityName: true,
      listedInExhibit21: true,
      confidence: true,
      relevanceScore: true,
      status: true,
    },
  });
  const addr = await prisma.addressClusterCandidate.findMany({
    where: { userId, ticker },
    select: {
      candidateEntityName: true,
      listedInExhibit21: true,
      confidence: true,
      relevanceScore: true,
      appearsInCreditDocs: true,
    },
  });
  const master = await prisma.entityUniverseItem.findMany({
    where: { userId, ticker },
    select: {
      id: true,
      entityName: true,
      entityRole: true,
      listedInExhibit21: true,
      relevanceScore: true,
      status: true,
      appearsInCreditDocs: true,
      appearsInUccSearch: true,
    },
  });

  const drafts = generateEntityUniverseIssuesFromLayers({
    creditDocs: cd,
    uccCandidates: ucc,
    sosCandidates: sos,
    addressCandidates: addr,
    masterItems: master,
  });

  await prisma.$transaction(async (tx) => {
    await tx.entityUniverseIssue.deleteMany({ where: { userId, ticker } });
    if (drafts.length === 0) return;
    await tx.entityUniverseIssue.createMany({
      data: drafts.map((d) => ({
        userId,
        ticker,
        relatedEntityUniverseItemId: d.relatedEntityUniverseItemId ?? null,
        relatedEntityName: d.relatedEntityName,
        issueType: d.issueType,
        severity: d.severity,
        issueTitle: d.issueTitle,
        issueDescription: d.issueDescription,
        evidenceJson: (d.evidenceJson ?? undefined) as Prisma.InputJsonValue | undefined,
        sourceUrl: d.sourceUrl ?? null,
      })),
    });
  });

  const count = await prisma.entityUniverseIssue.count({ where: { userId, ticker } });
  return NextResponse.json({ ok: true, created: count });
}
