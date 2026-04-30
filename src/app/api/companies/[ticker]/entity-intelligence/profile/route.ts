import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { parseCustomEntityRegistryEntries } from "@/lib/entityCustomRegistry";

export const dynamic = "force-dynamic";

function ser(p: Awaited<ReturnType<typeof prisma.entityIntelligenceProfile.findUnique>>) {
  if (!p) return null;
  return {
    ...p,
    source10KDate: p.source10KDate?.toISOString().slice(0, 10) ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const url = new URL(request.url);
  const seedName = url.searchParams.get("companyName")?.trim() || "";

  let profile = await prisma.entityIntelligenceProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  const pub = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });

  if (!profile) {
    profile = await prisma.entityIntelligenceProfile.create({
      data: {
        userId,
        ticker,
        companyName: (pub?.companyName ?? seedName) || null,
        publicRegistrantName: pub?.legalNames?.[0] ?? pub?.companyName ?? null,
        stateOfIncorporation: pub?.stateOfIncorporation ?? null,
        hqCity: pub?.hqCity ?? null,
        hqState: pub?.hqState ?? null,
        principalExecutiveOfficeAddress: pub?.principalExecutiveOfficeAddress ?? null,
        notes: pub?.notes ?? null,
      },
    });
  }

  return NextResponse.json({
    profile: ser(profile),
    customSources: parseCustomEntityRegistryEntries(profile.customSourceRegistryEntries),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

  const customJson =
    body.customSourceRegistryEntries !== undefined
      ? (body.customSourceRegistryEntries === null ? Prisma.JsonNull : (body.customSourceRegistryEntries as Prisma.InputJsonValue))
      : undefined;

  const profile = await prisma.entityIntelligenceProfile.upsert({
    where: { userId_ticker: { userId, ticker } },
    create: {
      userId,
      ticker,
      companyName: str(body.companyName) ?? null,
      publicRegistrantName: str(body.publicRegistrantName) ?? null,
      stateOfIncorporation: str(body.stateOfIncorporation) ?? null,
      hqAddress: str(body.hqAddress) ?? null,
      hqCity: str(body.hqCity) ?? null,
      hqState: str(body.hqState) ?? null,
      hqZip: str(body.hqZip) ?? null,
      principalExecutiveOfficeAddress: str(body.principalExecutiveOfficeAddress) ?? null,
      majorOperatingStates: strArr(body.majorOperatingStates) ?? [],
      majorFacilityAddresses: strArr(body.majorFacilityAddresses) ?? [],
      source10KUrl: str(body.source10KUrl) ?? null,
      source10KDate: str(body.source10KDate) ? new Date(str(body.source10KDate)!) : undefined,
      customSourceRegistryEntries: customJson === undefined ? undefined : customJson ?? Prisma.JsonNull,
      genericRegisteredAgentOverrides: strArr(body.genericRegisteredAgentOverrides) ?? [],
      notes: str(body.notes) ?? null,
    },
    update: {
      companyName: str(body.companyName) ?? undefined,
      publicRegistrantName: str(body.publicRegistrantName) ?? undefined,
      stateOfIncorporation: str(body.stateOfIncorporation) ?? undefined,
      hqAddress: str(body.hqAddress) ?? undefined,
      hqCity: str(body.hqCity) ?? undefined,
      hqState: str(body.hqState) ?? undefined,
      hqZip: str(body.hqZip) ?? undefined,
      principalExecutiveOfficeAddress: str(body.principalExecutiveOfficeAddress) ?? undefined,
      majorOperatingStates: strArr(body.majorOperatingStates),
      majorFacilityAddresses: strArr(body.majorFacilityAddresses),
      source10KUrl: str(body.source10KUrl) ?? undefined,
      source10KDate: str(body.source10KDate) ? new Date(str(body.source10KDate)!) : undefined,
      customSourceRegistryEntries: customJson,
      genericRegisteredAgentOverrides: strArr(body.genericRegisteredAgentOverrides),
      notes: str(body.notes) ?? undefined,
    },
  });

  return NextResponse.json({ profile: ser(profile) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  return POST(request, { params });
}
