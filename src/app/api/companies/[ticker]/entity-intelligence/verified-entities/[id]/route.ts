import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireUserTicker } from "../../_helpers";
import type {
  EntityVerificationOutcome,
  EntityConfidenceLevel,
  VerifiedDomesticOrForeign,
  VerifiedBusinessEntityStatus,
} from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ex = await prisma.verifiedEntityRecord.findFirst({ where: { id, userId, ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const official =
    typeof b.officialEntityName === "string" ? b.officialEntityName.trim() : ex.officialEntityName;
  const norm = normalizeEntityName(official).normalized;

  const parseD = (k: string) =>
    typeof b[k] === "string" ? (String(b[k]).trim() ? new Date(String(b[k])) : null) : undefined;

  const officersUpdate =
    b.officersDirectorsManagersJson !== undefined
      ? b.officersDirectorsManagersJson === null
        ? Prisma.JsonNull
        : (b.officersDirectorsManagersJson as Prisma.InputJsonValue)
      : undefined;

  const row = await prisma.verifiedEntityRecord.update({
    where: { id },
    data: {
      searchedName: typeof b.searchedName === "string" ? b.searchedName : undefined,
      officialEntityName: typeof b.officialEntityName === "string" ? official : undefined,
      normalizedOfficialEntityName: typeof b.officialEntityName === "string" ? norm : undefined,
      knownEntityInputId:
        typeof b.knownEntityInputId === "string" ? b.knownEntityInputId : b.knownEntityInputId === null ? null : undefined,
      state: typeof b.state === "string" ? b.state.trim().toUpperCase() : undefined,
      jurisdiction: typeof b.jurisdiction === "string" ? b.jurisdiction : undefined,
      entityId: typeof b.entityId === "string" ? b.entityId : undefined,
      entityType: typeof b.entityType === "string" ? b.entityType : undefined,
      domesticOrForeign: (b.domesticOrForeign as VerifiedDomesticOrForeign | undefined) ?? undefined,
      status: (b.status as VerifiedBusinessEntityStatus | undefined) ?? undefined,
      formationDate: parseD("formationDate"),
      registrationDate: parseD("registrationDate"),
      dissolutionDate: parseD("dissolutionDate"),
      withdrawalDate: parseD("withdrawalDate"),
      forfeitureDate: parseD("forfeitureDate"),
      reinstatementDate: parseD("reinstatementDate"),
      registeredAgentName: typeof b.registeredAgentName === "string" ? b.registeredAgentName : undefined,
      registeredAgentAddress: typeof b.registeredAgentAddress === "string" ? b.registeredAgentAddress : undefined,
      principalOfficeAddress: typeof b.principalOfficeAddress === "string" ? b.principalOfficeAddress : undefined,
      mailingAddress: typeof b.mailingAddress === "string" ? b.mailingAddress : undefined,
      officersDirectorsManagersJson: officersUpdate,
      sourceName: typeof b.sourceName === "string" ? b.sourceName : undefined,
      sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : undefined,
      documentUrl: typeof b.documentUrl === "string" ? b.documentUrl : undefined,
      documentsAvailable: typeof b.documentsAvailable === "boolean" ? b.documentsAvailable : undefined,
      lastVerifiedAt:
        typeof b.lastVerifiedAt === "string"
          ? b.lastVerifiedAt
            ? new Date(String(b.lastVerifiedAt))
            : null
          : undefined,
      verificationStatus: (b.verificationStatus as EntityVerificationOutcome | undefined) ?? undefined,
      confidence: (b.confidence as EntityConfidenceLevel | undefined) ?? undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    },
  });

  return NextResponse.json({ item: row });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const ex = await prisma.verifiedEntityRecord.findFirst({ where: { id, userId, ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.verifiedEntityRecord.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
