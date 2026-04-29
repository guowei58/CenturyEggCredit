import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticker: string; id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw, id } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker || !id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const existing = await prisma.publicRecord.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  const copyStr = (k: string) => {
    if (body[k] !== undefined) data[k] = body[k] === null ? null : String(body[k]);
  };
  const copyDate = (k: string) => {
    if (body[k] !== undefined) data[k] = body[k] ? new Date(String(body[k])) : null;
  };

  [
    "sourceKey",
    "recordType",
    "searchedEntityName",
    "matchedEntityName",
    "recordingNumber",
    "instrumentNumber",
    "caseNumber",
    "permitNumber",
    "licenseNumber",
    "parcelNumber",
    "accountNumber",
    "contractNumber",
    "amount",
    "taxPeriod",
    "creditorOrAgency",
    "securedParty",
    "counterparty",
    "propertyAddress",
    "jurisdictionState",
    "jurisdictionCounty",
    "jurisdictionCity",
    "documentTitle",
    "documentUrl",
    "localFileUrl",
    "sourceUrl",
    "extractedText",
    "summary",
    "notes",
  ].forEach((k) => copyStr(k));

  ["filingDate", "effectiveDate", "expirationDate", "releaseDate"].forEach((k) => copyDate(k));

  for (const k of ["status", "relatedEntityRole", "riskLevel", "confidence", "category"] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }

  const record = await prisma.publicRecord.update({
    where: { id },
    data,
  });

  return NextResponse.json({ record });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ ticker: string; id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw, id } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker || !id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const existing = await prisma.publicRecord.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.publicRecord.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
