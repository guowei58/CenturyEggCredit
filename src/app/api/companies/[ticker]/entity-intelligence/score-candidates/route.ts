import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { scoreCandidateAffiliate, type AffiliateEvidenceSignals } from "@/lib/scoreCandidateAffiliate";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const candidates = await prisma.candidateAffiliateEntity.findMany({ where: { userId, ticker } });
  let updated = 0;

  for (const c of candidates) {
    const rawSig = (
      typeof c.evidenceJson === "object" && c.evidenceJson !== null
        ? (c.evidenceJson as { signals?: AffiliateEvidenceSignals })
        : {}
    ).signals;

    const { score, confidence } = scoreCandidateAffiliate({
      ...(rawSig ?? {}),
      lacksOfficialLink: !c.sourceUrl?.trim(),
      onlySimilarNameEvidence: c.discoveryMethod === "name_similarity",
    });

    await prisma.candidateAffiliateEntity.update({
      where: { id: c.id },
      data: { affiliationScore: score, confidence },
    });
    updated++;
  }

  return NextResponse.json({ updated });
}
