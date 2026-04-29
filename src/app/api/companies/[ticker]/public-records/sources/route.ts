import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PUBLIC_RECORDS_REGISTRY, registrySourceKey } from "@/lib/publicRecordsSourceRegistry";
import { recommendPublicRecordSources } from "@/lib/recommendPublicRecordSources";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const profile = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  const userSources = await prisma.userPublicRecordSource.findMany({
    where: { userId, ticker },
    orderBy: { createdAt: "asc" },
  });

  const checklist = await prisma.publicRecordsChecklistItem.findMany({
    where: { userId, ticker },
  });
  const checklistByKey = new Map(checklist.map((c) => [c.sourceKey, c]));

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
  }).map((r) => ({
    ...r,
    checklist: checklistByKey.get(r.sourceKey) ?? null,
  }));

  return NextResponse.json({
    registry: PUBLIC_RECORDS_REGISTRY.map((s) => ({
      ...s,
      sourceKey: registrySourceKey(s.id),
    })),
    userSources,
    recommended,
  });
}

const CATEGORIES = new Set<string>([
  "entity_sos",
  "ucc_secured_debt",
  "tax_liens_releases",
  "real_estate_recorder",
  "property_tax_assessor",
  "permits_zoning_co",
  "environmental_compliance",
  "courts_judgments",
  "licenses_regulatory",
  "economic_incentives",
  "procurement_contracts",
  "gis_facility_mapping",
  "other",
]);

const J_TYPES = new Set<string>([
  "state",
  "county",
  "city",
  "court",
  "agency",
  "regional",
  "other",
]);

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

  const cat = body.category as string;
  const jt = body.jurisdictionType as string;
  if (!CATEGORIES.has(cat)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (!J_TYPES.has(jt)) return NextResponse.json({ error: "Invalid jurisdictionType" }, { status: 400 });

  const source = await prisma.userPublicRecordSource.create({
    data: {
      userId,
      ticker,
      category: cat as import("@/generated/prisma/client").PublicRecordCategory,
      jurisdictionType: jt as import("@/generated/prisma/client").PublicRecordJurisdictionType,
      jurisdictionName: typeof body.jurisdictionName === "string" ? body.jurisdictionName : "",
      state: typeof body.state === "string" ? body.state : null,
      county: typeof body.county === "string" ? body.county : null,
      city: typeof body.city === "string" ? body.city : null,
      agencyName: typeof body.agencyName === "string" ? body.agencyName : null,
      sourceName: typeof body.sourceName === "string" ? body.sourceName : "Custom source",
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : "",
      searchInstructions: typeof body.searchInstructions === "string" ? body.searchInstructions : null,
      searchUseCase: typeof body.searchUseCase === "string" ? body.searchUseCase : null,
      requiresLogin: Boolean(body.requiresLogin),
      hasFees: Boolean(body.hasFees),
      supportsNameSearch: body.supportsNameSearch !== false,
      supportsAddressSearch: Boolean(body.supportsAddressSearch),
      supportsParcelSearch: Boolean(body.supportsParcelSearch),
      supportsInstrumentSearch: Boolean(body.supportsInstrumentSearch),
      supportsPdfDownload: Boolean(body.supportsPdfDownload),
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });

  return NextResponse.json({ source });
}
