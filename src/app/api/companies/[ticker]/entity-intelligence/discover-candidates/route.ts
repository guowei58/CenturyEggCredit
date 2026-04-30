import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { discoverCandidateAffiliateDrafts } from "@/lib/discoverCandidateAffiliates";
import { scoreCandidateAffiliate, type AffiliateEvidenceSignals } from "@/lib/scoreCandidateAffiliate";
import { buildEntityIntelProfileInput } from "@/lib/entityIntelAggregateInput";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const { input } = await buildEntityIntelProfileInput(userId, ticker);
  const drafts = discoverCandidateAffiliateDrafts(input, 100);

  let created = 0;
  for (const d of drafts) {
    const dup = await prisma.candidateAffiliateEntity.findFirst({
      where: {
        userId,
        ticker,
        normalizedCandidateEntityName: d.normalizedCandidateEntityName,
        discoveryMethod: d.discoveryMethod,
      },
    });
    if (dup) continue;

    const signals: AffiliateEvidenceSignals = {
      weakNameSimilarity: d.discoveryMethod === "name_similarity",
      inCreditAgreement: d.discoveryMethod === "credit_doc_reference",
      secFilingReference: d.discoveryMethod === "sec_filing_reference",
      cityStateOnly: d.discoveryMethod === "shared_address",
      lacksOfficialLink: true,
    };

    const { score, confidence } = scoreCandidateAffiliate(signals);

    await prisma.candidateAffiliateEntity.create({
      data: {
        userId,
        ticker,
        candidateEntityName: d.candidateEntityName,
        normalizedCandidateEntityName: d.normalizedCandidateEntityName,
        state: d.state,
        jurisdiction: d.jurisdiction,
        discoveryMethod: d.discoveryMethod,
        reasonForFlag: d.reasonForFlag,
        evidenceJson: { ...d.evidenceJson, signals } as object,
        affiliationScore: score,
        confidence,
        reviewStatus: "unreviewed",
      },
    });
    created++;
  }

  return NextResponse.json({ created, totalDrafted: drafts.length });
}
