import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { bootstrapKnownEntitiesFromPublicProfile } from "@/lib/bootstrapEntityIntelFromPublicRecords";

export const dynamic = "force-dynamic";

/** Seed known entities from Public Records Profile; optional merge entity-intelligence headline fields. */
export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let replace = false;
  try {
    const b = await request.json();
    replace = Boolean((b as { replace?: unknown })?.replace);
  } catch {
    replace = false;
  }

  const pub = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });
  if (!pub) return NextResponse.json({ error: "Public records profile not found" }, { status: 400 });

  if (replace) {
    await prisma.knownEntityInput.deleteMany({ where: { userId, ticker } });
  }

  const seeds = bootstrapKnownEntitiesFromPublicProfile({
    ticker: pub.ticker,
    companyName: pub.companyName,
    legalNames: pub.legalNames,
    subsidiaryNames: pub.subsidiaryNames,
    subsidiaryDomiciles: pub.subsidiaryDomiciles,
    borrowerNames: pub.borrowerNames,
    guarantorNames: pub.guarantorNames,
    issuerNames: pub.issuerNames,
    dbaNames: pub.dbaNames,
    formerNames: pub.formerNames,
    restrictedSubsidiaryNames: pub.restrictedSubsidiaryNames,
    unrestrictedSubsidiaryNames: pub.unrestrictedSubsidiaryNames,
  });

  const existing = await prisma.knownEntityInput.findMany({
    where: { userId, ticker },
    select: { normalizedEntityName: true, entityRole: true, sourceType: true },
  });
  const keys = new Set(existing.map((e) => `${e.normalizedEntityName}|${e.entityRole}|${e.sourceType}`));

  let inserted = 0;
  for (const s of seeds) {
    const k = `${s.normalizedEntityName}|${s.entityRole}|${s.sourceType}`;
    if (keys.has(k)) continue;
    keys.add(k);
    await prisma.knownEntityInput.create({
      data: {
        userId,
        ticker,
        entityName: s.entityName,
        normalizedEntityName: s.normalizedEntityName,
        sourceType: s.sourceType,
        entityRole: s.entityRole,
        jurisdictionHint: s.jurisdictionHint,
      },
    });
    inserted++;
  }

  const profile = await prisma.entityIntelligenceProfile.upsert({
    where: { userId_ticker: { userId, ticker } },
    create: {
      userId,
      ticker,
      companyName: pub.companyName,
      publicRegistrantName: pub.legalNames?.[0] ?? pub.companyName,
      stateOfIncorporation: pub.stateOfIncorporation,
      hqCity: pub.hqCity,
      hqState: pub.hqState,
      principalExecutiveOfficeAddress: pub.principalExecutiveOfficeAddress,
      notes: pub.notes,
    },
    update: {
      companyName: pub.companyName ?? undefined,
      publicRegistrantName: pub.legalNames?.[0] ?? pub.companyName ?? undefined,
      stateOfIncorporation: pub.stateOfIncorporation ?? undefined,
      hqCity: pub.hqCity ?? undefined,
      hqState: pub.hqState ?? undefined,
      principalExecutiveOfficeAddress: pub.principalExecutiveOfficeAddress ?? undefined,
      notes: pub.notes ?? undefined,
    },
  });

  return NextResponse.json({ inserted, seededFrom: seeds.length, profile });
}
