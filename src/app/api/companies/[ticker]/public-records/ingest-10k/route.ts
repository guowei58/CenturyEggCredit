import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildPublicRecordsProfileFromSec } from "@/lib/buildPublicRecordsProfileFromSec";
import { mergePublicRecordsSecPrefill } from "@/lib/mergePublicRecordsSecPrefill";

export const dynamic = "force-dynamic";

/**
 * Fetch SEC submissions + latest 10-K text hints and merge into the saved public-records profile (persist).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const built = await buildPublicRecordsProfileFromSec(ticker, userId);
  if (!built.ok) {
    return NextResponse.json({ error: built.message }, { status: 422 });
  }

  const { prefill } = built;

  const existing = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  const merged = mergePublicRecordsSecPrefill(
    {
      companyName: existing?.companyName ?? null,
      legalNames: existing?.legalNames ?? [],
      formerNames: existing?.formerNames ?? [],
      subsidiaryNames: existing?.subsidiaryNames ?? [],
      issuerNames: existing?.issuerNames ?? [],
      hqState: existing?.hqState ?? null,
      hqCity: existing?.hqCity ?? null,
      hqCounty: existing?.hqCounty ?? null,
      principalExecutiveOfficeAddress: existing?.principalExecutiveOfficeAddress ?? null,
      stateOfIncorporation: existing?.stateOfIncorporation ?? null,
      notes: existing?.notes ?? null,
    },
    prefill
  );

  const profile = await prisma.publicRecordsProfile.upsert({
    where: { userId_ticker: { userId, ticker } },
    create: {
      userId,
      ticker,
      companyName: merged.companyName ?? null,
      legalNames: merged.legalNames ?? [],
      formerNames: merged.formerNames ?? [],
      dbaNames: [],
      subsidiaryNames: merged.subsidiaryNames ?? [],
      borrowerNames: [],
      guarantorNames: [],
      issuerNames: merged.issuerNames ?? [],
      restrictedSubsidiaryNames: [],
      unrestrictedSubsidiaryNames: [],
      parentCompanyNames: [],
      operatingCompanyNames: [],
      hqState: merged.hqState ?? null,
      hqCounty: merged.hqCounty ?? null,
      hqCity: merged.hqCity ?? null,
      principalExecutiveOfficeAddress: merged.principalExecutiveOfficeAddress ?? null,
      stateOfIncorporation: merged.stateOfIncorporation ?? null,
      majorFacilityLocations: Prisma.JsonNull,
      knownPropertyLocations: Prisma.JsonNull,
      knownPermitJurisdictions: Prisma.JsonNull,
      knownRegulatoryJurisdictions: Prisma.JsonNull,
      notes: merged.notes ?? null,
    },
    update: {
      companyName: merged.companyName ?? undefined,
      legalNames: merged.legalNames,
      formerNames: merged.formerNames,
      subsidiaryNames: merged.subsidiaryNames,
      issuerNames: merged.issuerNames,
      hqState: merged.hqState ?? undefined,
      hqCounty: merged.hqCounty ?? undefined,
      hqCity: merged.hqCity ?? undefined,
      principalExecutiveOfficeAddress: merged.principalExecutiveOfficeAddress ?? undefined,
      stateOfIncorporation: merged.stateOfIncorporation ?? undefined,
      notes: merged.notes ?? undefined,
    },
  });

  return NextResponse.json({
    profile,
    prefill,
    disclaimer:
      "Values merged from SEC submissions JSON and latest 10-K text extraction. Edit and verify before relying on search coverage.",
  });
}
