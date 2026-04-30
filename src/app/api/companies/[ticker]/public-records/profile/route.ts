import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  clampExhibit21SnapshotForPersist,
  clampSubsidiaryDomicileList,
  clampSubsidiaryNameList,
  publicRecordsProfileSaveErrorHint,
} from "@/lib/publicRecordsProfilePersistLimits";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400, headers: NO_STORE_HEADERS });

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

  return NextResponse.json({ profile }, { headers: NO_STORE_HEADERS });
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

  const normalizedSubsidiaryNames = clampSubsidiaryNameList(strArr(body.subsidiaryNames) ?? []);
  const domsRaw = clampSubsidiaryDomicileList(strArr(body.subsidiaryDomiciles) ?? []);
  const normalizedSubsidiaryDomiciles = domsRaw.slice(0, normalizedSubsidiaryNames.length);

  function exhibitSnapshotDbValue(raw: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (raw === undefined) return undefined;
    const snapped = clampExhibit21SnapshotForPersist(raw ?? null);
    if (snapped === null) return Prisma.JsonNull;
    return snapped as unknown as Prisma.InputJsonValue;
  }

  try {
    const profile = await prisma.publicRecordsProfile.upsert({
      where: { userId_ticker: { userId, ticker } },
      create: {
        userId,
        ticker,
        companyName: typeof body.companyName === "string" ? body.companyName : null,
        legalNames: strArr(body.legalNames) ?? [],
        formerNames: strArr(body.formerNames) ?? [],
        dbaNames: strArr(body.dbaNames) ?? [],
        subsidiaryNames: normalizedSubsidiaryNames,
        subsidiaryDomiciles: normalizedSubsidiaryDomiciles,
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
        cik: typeof body.cik === "string" ? body.cik : null,
        irsEmployerIdentificationNumber:
          typeof body.irsEmployerIdentificationNumber === "string" ? body.irsEmployerIdentificationNumber : null,
        fiscalYearEnd: typeof body.fiscalYearEnd === "string" ? body.fiscalYearEnd : null,
        majorFacilityLocations: j(body.majorFacilityLocations),
        knownPropertyLocations: j(body.knownPropertyLocations),
        knownPermitJurisdictions: j(body.knownPermitJurisdictions),
        knownRegulatoryJurisdictions: j(body.knownRegulatoryJurisdictions),
        subsidiaryExhibit21Snapshot:
          body.subsidiaryExhibit21Snapshot !== undefined ? exhibitSnapshotDbValue(body.subsidiaryExhibit21Snapshot) : undefined,
        notes: typeof body.notes === "string" ? body.notes : null,
      },
      update: {
        companyName: typeof body.companyName === "string" ? body.companyName : undefined,
        legalNames: strArr(body.legalNames),
        formerNames: strArr(body.formerNames),
        dbaNames: strArr(body.dbaNames),
        subsidiaryNames: normalizedSubsidiaryNames,
        subsidiaryDomiciles: normalizedSubsidiaryDomiciles,
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
        cik: typeof body.cik === "string" ? body.cik : undefined,
        irsEmployerIdentificationNumber:
          typeof body.irsEmployerIdentificationNumber === "string" ? body.irsEmployerIdentificationNumber : undefined,
        fiscalYearEnd: typeof body.fiscalYearEnd === "string" ? body.fiscalYearEnd : undefined,
        majorFacilityLocations: body.majorFacilityLocations !== undefined ? j(body.majorFacilityLocations) : undefined,
        knownPropertyLocations: body.knownPropertyLocations !== undefined ? j(body.knownPropertyLocations) : undefined,
        knownPermitJurisdictions: body.knownPermitJurisdictions !== undefined ? j(body.knownPermitJurisdictions) : undefined,
        knownRegulatoryJurisdictions:
          body.knownRegulatoryJurisdictions !== undefined ? j(body.knownRegulatoryJurisdictions) : undefined,
        subsidiaryExhibit21Snapshot:
          body.subsidiaryExhibit21Snapshot !== undefined ? exhibitSnapshotDbValue(body.subsidiaryExhibit21Snapshot) : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      },
    });

    return NextResponse.json({ profile });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Database error";
    console.error("[public-records/profile] POST upsert", e);
    return NextResponse.json({ error: publicRecordsProfileSaveErrorHint(detail) }, { status: 500 });
  }
}
