import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { addressKindForBonus, debtorNameFinancePattern, scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type {
  AddressClusterAddressKind,
  EntityUniverseConfidenceKind,
  EntityUniverseReviewStatus,
  VerifiedBusinessEntityStatus,
} from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.addressClusterCandidate.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const next =
    typeof body.candidateEntityName === "string"
      ? body.candidateEntityName.trim()
      : existing.candidateEntityName;
  const normalized = normalizeEntityName(next).normalized;
  const exHit = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const exRows = await prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker } });
  const nm = exRows.some((e) => normalizeEntityName(e.entityName).root === normalizeEntityName(next).root);
  const cd = !!(await prisma.creditDocumentEntity.findFirst({
    where: { userId, ticker, normalizedEntityName: normalized },
  }));
  const addrType = (body.addressType as AddressClusterAddressKind | undefined) ?? existing.addressType;
  const rel = scoreEntityRelevance({
    listedInExhibit21: Boolean(exHit),
    nameRootMatch: nm,
    financeSpvPattern: debtorNameFinancePattern(next),
    ...addressKindForBonus(addrType),
    caution: nm ? {} : { nameSimilarityOnly: true },
  });
  const conf = scoreEntityConfidence({
    exactNameRegistry: Boolean(
      (typeof body.entityId === "string" ? body.entityId : existing.entityId)?.trim()
    ),
    sourceUrlCaptured:
      typeof body.sourceUrl === "string" ? body.sourceUrl.length > 0 : existing.sourceUrl.length > 0,
    addressOnly: !nm && !cd,
    inCreditDocsWithExcerpt: cd,
  });

  const row = await prisma.addressClusterCandidate.update({
    where: { id },
    data: {
      candidateEntityName: typeof body.candidateEntityName === "string" ? next : undefined,
      normalizedCandidateEntityName: typeof body.candidateEntityName === "string" ? normalized : undefined,
      matchedAddress: typeof body.matchedAddress === "string" ? body.matchedAddress : undefined,
      addressType: (body.addressType as AddressClusterAddressKind | undefined) ?? undefined,
      state: typeof body.state === "string" ? body.state.trim().toUpperCase() : undefined,
      sourceName: typeof body.sourceName === "string" ? body.sourceName : undefined,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      entityId: typeof body.entityId === "string" ? body.entityId : undefined,
      entityType: typeof body.entityType === "string" ? body.entityType : undefined,
      status: (body.status as VerifiedBusinessEntityStatus | undefined) ?? undefined,
      evidenceJson:
        body.evidenceJson !== undefined
          ? (body.evidenceJson as Prisma.InputJsonValue)
          : undefined,
      listedInExhibit21: Boolean(exHit),
      appearsInCreditDocs: cd,
      relevanceScore:
        typeof body.relevanceScore === "number" ? body.relevanceScore : Math.max(existing.relevanceScore, rel),
      confidence: (body.confidence as EntityUniverseConfidenceKind | undefined) ?? conf,
      reviewStatus: (body.reviewStatus as EntityUniverseReviewStatus | undefined) ?? undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.addressClusterCandidate.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.addressClusterCandidate.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
