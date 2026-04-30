import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type {
  EntityVerificationOutcome,
  EntityConfidenceLevel,
  VerifiedDomesticOrForeign,
  VerifiedBusinessEntityStatus,
} from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export const dynamic = "force-dynamic";

function ser(r: {
  createdAt: Date;
  updatedAt: Date;
  formationDate: Date | null;
  registrationDate: Date | null;
  dissolutionDate: Date | null;
  withdrawalDate: Date | null;
  forfeitureDate: Date | null;
  reinstatementDate: Date | null;
  lastVerifiedAt: Date | null;
  [k: string]: unknown;
}) {
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
  return {
    ...r,
    formationDate: d(r.formationDate as Date | null),
    registrationDate: d(r.registrationDate as Date | null),
    dissolutionDate: d(r.dissolutionDate as Date | null),
    withdrawalDate: d(r.withdrawalDate as Date | null),
    forfeitureDate: d(r.forfeitureDate as Date | null),
    reinstatementDate: d(r.reinstatementDate as Date | null),
    lastVerifiedAt: r.lastVerifiedAt ? (r.lastVerifiedAt as Date).toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const rows = await prisma.verifiedEntityRecord.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ items: rows.map(ser) });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const searchedName = typeof b.searchedName === "string" ? b.searchedName.trim() : "";
  const official = typeof b.officialEntityName === "string" ? b.officialEntityName.trim() : "";
  const state = typeof b.state === "string" ? b.state.trim().toUpperCase() : "";
  const sourceName = typeof b.sourceName === "string" ? b.sourceName.trim() : "";
  const sourceUrl = typeof b.sourceUrl === "string" ? b.sourceUrl.trim() : "";
  if (!searchedName || !official || !state || !sourceName || !sourceUrl) {
    return NextResponse.json({ error: "searchedName, officialEntityName, state, sourceName, sourceUrl required" }, { status: 400 });
  }

  const normalizedOfficial = normalizeEntityName(official).normalized;
  const knownEntityInputId = typeof b.knownEntityInputId === "string" ? b.knownEntityInputId : null;

  const parseD = (k: string) =>
    typeof b[k] === "string" && (b[k] as string).trim() ? new Date(String(b[k])) : null;

  const row = await prisma.verifiedEntityRecord.create({
    data: {
      userId,
      ticker,
      knownEntityInputId,
      searchedName,
      officialEntityName: official,
      normalizedOfficialEntityName: normalizedOfficial,
      state,
      jurisdiction: typeof b.jurisdiction === "string" ? b.jurisdiction : "",
      entityId: typeof b.entityId === "string" ? b.entityId : null,
      entityType: typeof b.entityType === "string" ? b.entityType : null,
      domesticOrForeign: (b.domesticOrForeign as VerifiedDomesticOrForeign | undefined) ?? "unknown",
      status: (b.status as VerifiedBusinessEntityStatus | undefined) ?? "unknown",
      formationDate: parseD("formationDate"),
      registrationDate: parseD("registrationDate"),
      dissolutionDate: parseD("dissolutionDate"),
      withdrawalDate: parseD("withdrawalDate"),
      forfeitureDate: parseD("forfeitureDate"),
      reinstatementDate: parseD("reinstatementDate"),
      registeredAgentName: typeof b.registeredAgentName === "string" ? b.registeredAgentName : null,
      registeredAgentAddress: typeof b.registeredAgentAddress === "string" ? b.registeredAgentAddress : null,
      principalOfficeAddress: typeof b.principalOfficeAddress === "string" ? b.principalOfficeAddress : null,
      mailingAddress: typeof b.mailingAddress === "string" ? b.mailingAddress : null,
      officersDirectorsManagersJson:
        typeof b.officersDirectorsManagersJson === "object" && b.officersDirectorsManagersJson !== null
          ? (b.officersDirectorsManagersJson as object)
          : undefined,
      sourceName,
      sourceUrl,
      documentUrl: typeof b.documentUrl === "string" ? b.documentUrl : null,
      documentsAvailable: Boolean(b.documentsAvailable),
      lastVerifiedAt: typeof b.lastVerifiedAt === "string" && b.lastVerifiedAt ? new Date(String(b.lastVerifiedAt)) : new Date(),
      verificationStatus: (b.verificationStatus as EntityVerificationOutcome | undefined) ?? "verified_exact_match",
      confidence: (b.confidence as EntityConfidenceLevel | undefined) ?? "medium",
      notes: typeof b.notes === "string" ? b.notes : null,
    },
  });

  return NextResponse.json({ item: ser(row as Parameters<typeof ser>[0]) });
}
