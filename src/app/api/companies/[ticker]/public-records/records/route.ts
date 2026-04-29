import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type {
  PublicRecordCategory,
  PublicRecordConfidenceLevel,
  PublicRecordFindingStatus,
  PublicRecordRelatedRole,
  PublicRecordRiskLevel,
} from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const records = await prisma.publicRecord.findMany({
    where: { userId, ticker },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ records });
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

  const category = body.category as PublicRecordCategory | undefined;
  if (!category) return NextResponse.json({ error: "category required" }, { status: 400 });

  const record = await prisma.publicRecord.create({
    data: {
      userId,
      ticker,
      category,
      sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : null,
      recordType: typeof body.recordType === "string" ? body.recordType : null,
      status: (body.status as PublicRecordFindingStatus) ?? "unknown",
      searchedEntityName: typeof body.searchedEntityName === "string" ? body.searchedEntityName : null,
      matchedEntityName: typeof body.matchedEntityName === "string" ? body.matchedEntityName : null,
      relatedEntityRole: (body.relatedEntityRole as PublicRecordRelatedRole) ?? "unknown",
      filingDate: body.filingDate ? new Date(String(body.filingDate)) : null,
      effectiveDate: body.effectiveDate ? new Date(String(body.effectiveDate)) : null,
      expirationDate: body.expirationDate ? new Date(String(body.expirationDate)) : null,
      releaseDate: body.releaseDate ? new Date(String(body.releaseDate)) : null,
      recordingNumber: typeof body.recordingNumber === "string" ? body.recordingNumber : null,
      instrumentNumber: typeof body.instrumentNumber === "string" ? body.instrumentNumber : null,
      caseNumber: typeof body.caseNumber === "string" ? body.caseNumber : null,
      permitNumber: typeof body.permitNumber === "string" ? body.permitNumber : null,
      licenseNumber: typeof body.licenseNumber === "string" ? body.licenseNumber : null,
      parcelNumber: typeof body.parcelNumber === "string" ? body.parcelNumber : null,
      accountNumber: typeof body.accountNumber === "string" ? body.accountNumber : null,
      contractNumber: typeof body.contractNumber === "string" ? body.contractNumber : null,
      amount: typeof body.amount === "string" ? body.amount : null,
      taxPeriod: typeof body.taxPeriod === "string" ? body.taxPeriod : null,
      creditorOrAgency: typeof body.creditorOrAgency === "string" ? body.creditorOrAgency : null,
      securedParty: typeof body.securedParty === "string" ? body.securedParty : null,
      counterparty: typeof body.counterparty === "string" ? body.counterparty : null,
      propertyAddress: typeof body.propertyAddress === "string" ? body.propertyAddress : null,
      jurisdictionState: typeof body.jurisdictionState === "string" ? body.jurisdictionState : null,
      jurisdictionCounty: typeof body.jurisdictionCounty === "string" ? body.jurisdictionCounty : null,
      jurisdictionCity: typeof body.jurisdictionCity === "string" ? body.jurisdictionCity : null,
      documentTitle: typeof body.documentTitle === "string" ? body.documentTitle : null,
      documentUrl: typeof body.documentUrl === "string" ? body.documentUrl : null,
      localFileUrl: typeof body.localFileUrl === "string" ? body.localFileUrl : null,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      extractedText: typeof body.extractedText === "string" ? body.extractedText : null,
      summary: typeof body.summary === "string" ? body.summary : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      riskLevel: (body.riskLevel as PublicRecordRiskLevel) ?? "unknown",
      confidence: (body.confidence as PublicRecordConfidenceLevel) ?? "medium",
    },
  });

  return NextResponse.json({ record });
}
