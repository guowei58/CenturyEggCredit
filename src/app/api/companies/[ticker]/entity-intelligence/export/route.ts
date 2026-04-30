import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { exportEntityIntelligenceBundle } from "@/lib/exportEntityIntelligence";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const entityProfile = await prisma.entityIntelligenceProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  const [known, verified, candidates, issues, relationships] = await Promise.all([
    prisma.knownEntityInput.findMany({ where: { userId, ticker } }),
    prisma.verifiedEntityRecord.findMany({ where: { userId, ticker } }),
    prisma.candidateAffiliateEntity.findMany({ where: { userId, ticker } }),
    prisma.entityDiligenceIssue.findMany({ where: { userId, ticker } }),
    prisma.entityRelationship.findMany({ where: { userId, ticker } }),
  ]);

  const companyLabel =
    entityProfile?.companyName ?? entityProfile?.publicRegistrantName ?? ticker;

  const bundle = exportEntityIntelligenceBundle({
    ticker,
    companyLabel,
    known,
    verified,
    candidates,
    issues,
    relationships,
  });

  return NextResponse.json(bundle);
}
