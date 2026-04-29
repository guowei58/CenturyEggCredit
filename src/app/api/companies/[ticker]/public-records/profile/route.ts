import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(request.url);
  const seedName = url.searchParams.get("companyName")?.trim() || "";

  let profile = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  if (!profile) {
    profile = await prisma.publicRecordsProfile.create({
      data: {
        userId,
        ticker,
        companyName: seedName || null,
      },
    });
  }

  return NextResponse.json({ profile });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const j = (v: unknown) => (v === undefined ? undefined : v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

  const profile = await prisma.publicRecordsProfile.upsert({
    where: { userId_ticker: { userId, ticker } },
    create: {
      userId,
      ticker,
      companyName: typeof body.companyName === "string" ? body.companyName : null,
      legalNames: strArr(body.legalNames) ?? [],
      formerNames: strArr(body.formerNames) ?? [],
      dbaNames: strArr(body.dbaNames) ?? [],
      subsidiaryNames: strArr(body.subsidiaryNames) ?? [],
      borrowerNames: strArr(body.borrowerNames) ?? [],
      guarantorNames: strArr(body.guarantorNames) ?? [],
      issuerNames: strArr(body.issuerNames) ?? [],
      restrictedSubsidiaryNames: strArr(body.restrictedSubsidiaryNames) ?? [],
      unrestrictedSubsidiaryNames: strArr(body.unrestrictedSubsidiaryNames) ?? [],
      parentCompanyNames: strArr(body.parentCompanyNames) ?? [],
      operatingCompanyNames: strArr(body.operatingCompanyNames) ?? [],
      hqState: typeof body.hqState === "string" ? body.hqState : null,
      hqCounty: typeof body.hqCounty === "string" ? body.hqCounty : null,
      hqCity: typeof body.hqCity === "string" ? body.hqCity : null,
      principalExecutiveOfficeAddress:
        typeof body.principalExecutiveOfficeAddress === "string" ? body.principalExecutiveOfficeAddress : null,
      stateOfIncorporation: typeof body.stateOfIncorporation === "string" ? body.stateOfIncorporation : null,
      majorFacilityLocations: j(body.majorFacilityLocations),
      knownPropertyLocations: j(body.knownPropertyLocations),
      knownPermitJurisdictions: j(body.knownPermitJurisdictions),
      knownRegulatoryJurisdictions: j(body.knownRegulatoryJurisdictions),
      notes: typeof body.notes === "string" ? body.notes : null,
    },
    update: {
      companyName: typeof body.companyName === "string" ? body.companyName : undefined,
      legalNames: strArr(body.legalNames),
      formerNames: strArr(body.formerNames),
      dbaNames: strArr(body.dbaNames),
      subsidiaryNames: strArr(body.subsidiaryNames),
      borrowerNames: strArr(body.borrowerNames),
      guarantorNames: strArr(body.guarantorNames),
      issuerNames: strArr(body.issuerNames),
      restrictedSubsidiaryNames: strArr(body.restrictedSubsidiaryNames),
      unrestrictedSubsidiaryNames: strArr(body.unrestrictedSubsidiaryNames),
      parentCompanyNames: strArr(body.parentCompanyNames),
      operatingCompanyNames: strArr(body.operatingCompanyNames),
      hqState: typeof body.hqState === "string" ? body.hqState : undefined,
      hqCounty: typeof body.hqCounty === "string" ? body.hqCounty : undefined,
      hqCity: typeof body.hqCity === "string" ? body.hqCity : undefined,
      principalExecutiveOfficeAddress:
        typeof body.principalExecutiveOfficeAddress === "string" ? body.principalExecutiveOfficeAddress : undefined,
      stateOfIncorporation: typeof body.stateOfIncorporation === "string" ? body.stateOfIncorporation : undefined,
      majorFacilityLocations: body.majorFacilityLocations !== undefined ? j(body.majorFacilityLocations) : undefined,
      knownPropertyLocations: body.knownPropertyLocations !== undefined ? j(body.knownPropertyLocations) : undefined,
      knownPermitJurisdictions: body.knownPermitJurisdictions !== undefined ? j(body.knownPermitJurisdictions) : undefined,
      knownRegulatoryJurisdictions:
        body.knownRegulatoryJurisdictions !== undefined ? j(body.knownRegulatoryJurisdictions) : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    },
  });

  return NextResponse.json({ profile });
}
