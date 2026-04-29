import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generatePublicRecordsSearchTerms } from "@/lib/generatePublicRecordsSearchTerms";
import { recommendPublicRecordSources } from "@/lib/recommendPublicRecordSources";
import { computeCoverageQuality } from "@/lib/publicRecordsCoverage";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const profile = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  const records = await prisma.publicRecord.findMany({ where: { userId, ticker } });
  const checklist = await prisma.publicRecordsChecklistItem.findMany({ where: { userId, ticker } });

  const terms = generatePublicRecordsSearchTerms({
    companyName: profile?.companyName ?? undefined,
    ticker,
    legalNames: profile?.legalNames ?? [],
    formerNames: profile?.formerNames ?? [],
    dbaNames: profile?.dbaNames ?? [],
    subsidiaryNames: profile?.subsidiaryNames ?? [],
    borrowerNames: profile?.borrowerNames ?? [],
    guarantorNames: profile?.guarantorNames ?? [],
    issuerNames: profile?.issuerNames ?? [],
    parentCompanyNames: profile?.parentCompanyNames ?? [],
    operatingCompanyNames: profile?.operatingCompanyNames ?? [],
    restrictedSubsidiaryNames: profile?.restrictedSubsidiaryNames ?? [],
    unrestrictedSubsidiaryNames: profile?.unrestrictedSubsidiaryNames ?? [],
  });

  const recommended = recommendPublicRecordSources({
    hqState: profile?.hqState,
    hqCounty: profile?.hqCounty,
    hqCity: profile?.hqCity,
    stateOfIncorporation: profile?.stateOfIncorporation,
    principalExecutiveOfficeAddress: profile?.principalExecutiveOfficeAddress,
    borrowerNames: profile?.borrowerNames ?? [],
    guarantorNames: profile?.guarantorNames ?? [],
    subsidiaryNames: profile?.subsidiaryNames ?? [],
    majorFacilityLocations: profile?.majorFacilityLocations ?? undefined,
    knownPropertyLocations: profile?.knownPropertyLocations ?? undefined,
  });

  const checked = checklist.filter((c) => c.status !== "not_started").length;
  const unresolved = checklist.filter((c) =>
    ["needs_follow_up", "potential_match", "blocked_login_required", "blocked_fee_required"].includes(c.status)
  ).length;
  const noResult = checklist.filter((c) => c.status === "searched_no_result").length;
  const highRisk = records.filter((r) => r.riskLevel === "high" || r.riskLevel === "critical").length;
  const openItems = records.filter((r) => ["open", "pending", "active"].includes(r.status)).length;

  const coverageQuality = computeCoverageQuality({
    profile: {
      hqState: profile?.hqState,
      hqCounty: profile?.hqCounty,
      borrowerNames: profile?.borrowerNames ?? [],
      guarantorNames: profile?.guarantorNames ?? [],
      subsidiaryNames: profile?.subsidiaryNames ?? [],
      parentCompanyNames: profile?.parentCompanyNames ?? [],
      majorFacilityLocations: profile?.majorFacilityLocations ?? undefined,
      knownPropertyLocations: profile?.knownPropertyLocations ?? undefined,
    },
    checklistCheckedCount: checked,
    recommendedSourceCount: recommended.length,
    recordsHighRiskCount: highRisk,
    unresolvedChecklistCount: unresolved,
  });

  const run = await prisma.publicRecordsSearchRun.create({
    data: {
      userId,
      ticker,
      searchedBy: session.user?.name ?? session.user?.email ?? null,
      categoriesIncluded: [...new Set(records.map((r) => r.category))],
      searchScope: profile ? { ticker, hqState: profile.hqState } : {},
      searchTermsUsed: terms.allTermsFlat.slice(0, 200),
      sourcesChecked: {
        checked,
        totalRecommended: recommended.length,
        checklistRows: checklist.length,
      },
      summary: `Recorded diligence snapshot: ${records.length} finding(s), ${checklist.length} checklist row(s), ${checked} source(s) touched.`,
      openItemsCount: openItems,
      highRiskItemsCount: highRisk,
      unresolvedItemsCount: unresolved,
      noResultItemsCount: noResult,
      coverageQuality,
    },
  });

  return NextResponse.json({ run });
}
