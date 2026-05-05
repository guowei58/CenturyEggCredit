import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName, isGenericRegisteredAgent } from "@/lib/entityNormalize";
import { debtorNameFinancePattern, scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type { EntityUniverseReviewStatus, EntityUniverseConfidenceKind, VerifiedBusinessEntityStatus } from "@/generated/prisma/client";

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

  const existing = await prisma.sosNameFamilyCandidate.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const next =
    typeof body.candidateEntityName === "string"
      ? body.candidateEntityName.trim()
      : existing.candidateEntityName;
  const normalized = normalizeEntityName(next).normalized;
  const ex = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const cd = !!(await prisma.creditDocumentEntity.findFirst({
    where: { userId, ticker, normalizedEntityName: normalized },
  }));
  const exRows = await prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker } });
  const nm = exRows.some((e) => normalizeEntityName(e.entityName).root === normalizeEntityName(next).root);
  const ra = typeof body.registeredAgentName === "string" ? body.registeredAgentName : existing.registeredAgentName;
  const gra = Boolean(ra && isGenericRegisteredAgent(ra));
  const rel = scoreEntityRelevance({
    listedInExhibit21: Boolean(ex),
    nameRootMatch: nm,
    financeSpvPattern: debtorNameFinancePattern(next),
    ipRealEstateAssetHoldingsPattern: /\b(ip|real\s+estate)\b/i.test(next),
    caution: { genericRegisteredAgentOnly: gra && !nm && !cd, nameSimilarityOnly: !gra && !cd },
  });

  const confComputed =
    (body.confidence as EntityUniverseConfidenceKind | undefined) ??
    scoreEntityConfidence({
      exactNameRegistry: Boolean(
        (typeof body.entityId === "string" ? body.entityId : existing.entityId)?.trim()
      ),
      sourceUrlCaptured:
        typeof body.sourceUrl === "string" ? body.sourceUrl.length > 0 : existing.sourceUrl.length > 0,
      genericRegisteredAgentOnly: gra && !cd,
      inCreditDocsWithExcerpt: cd,
    });

  const row = await prisma.sosNameFamilyCandidate.update({
    where: { id },
    data: {
      candidateEntityName: typeof body.candidateEntityName === "string" ? next : undefined,
      normalizedCandidateEntityName: typeof body.candidateEntityName === "string" ? normalized : undefined,
      state: typeof body.state === "string" ? body.state.trim().toUpperCase() : undefined,
      sourceName: typeof body.sourceName === "string" ? body.sourceName : undefined,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      entityId: typeof body.entityId === "string" ? body.entityId : undefined,
      entityType: typeof body.entityType === "string" ? body.entityType : undefined,
      status: (body.status as VerifiedBusinessEntityStatus | undefined) ?? undefined,
      formationDate:
        typeof body.formationDate === "string" ? (body.formationDate ? new Date(body.formationDate) : null) : undefined,
      registeredAgentName: typeof body.registeredAgentName === "string" ? body.registeredAgentName : undefined,
      registeredAgentAddress:
        typeof body.registeredAgentAddress === "string" ? body.registeredAgentAddress : undefined,
      principalOfficeAddress:
        typeof body.principalOfficeAddress === "string" ? body.principalOfficeAddress : undefined,
      mailingAddress: typeof body.mailingAddress === "string" ? body.mailingAddress : undefined,
      matchedNameRoot: typeof body.matchedNameRoot === "string" ? body.matchedNameRoot : undefined,
      matchedSearchTerm: typeof body.matchedSearchTerm === "string" ? body.matchedSearchTerm : undefined,
      listedInExhibit21: Boolean(ex),
      appearsInCreditDocs: cd,
      relevanceScore:
        typeof body.relevanceScore === "number" ? body.relevanceScore : Math.max(existing.relevanceScore, rel),
      confidence: confComputed,
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

  const existing = await prisma.sosNameFamilyCandidate.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.sosNameFamilyCandidate.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
