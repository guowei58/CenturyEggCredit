import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName, isGenericRegisteredAgent } from "@/lib/entityNormalize";
import { debtorNameFinancePattern, scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../_helpers";
import type { EntityUniverseReviewStatus, EntityUniverseConfidenceKind, VerifiedBusinessEntityStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;
  const items = await prisma.sosNameFamilyCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ items: items.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)) });
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
  const candidateEntityName = typeof body.candidateEntityName === "string" ? body.candidateEntityName.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim().toUpperCase() : "";
  const sourceName = typeof body.sourceName === "string" ? body.sourceName : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  if (!candidateEntityName || !state || !sourceName || !sourceUrl)
    return NextResponse.json({ error: "candidateEntityName, state, sourceName, sourceUrl required" }, { status: 400 });

  const { normalized } = normalizeEntityName(candidateEntityName);
  const exRows = await prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker } });
  const exSet = new Set(exRows.map((e) => normalizeEntityName(e.entityName).root));
  const nm = exSet.has(normalizeEntityName(candidateEntityName).root);
  const ex = exRows.find((e) => normalizeEntityName(e.entityName).normalized === normalized);
  const appearsInCreditDocs = !!(await prisma.creditDocumentEntity.findFirst({
    where: { userId, ticker, normalizedEntityName: normalized },
  }));
  const gra = Boolean(body.registeredAgentName && isGenericRegisteredAgent(String(body.registeredAgentName)));
  const rel = scoreEntityRelevance({
    listedInExhibit21: Boolean(ex),
    nameRootMatch: nm,
    financeSpvPattern: debtorNameFinancePattern(candidateEntityName),
    ipRealEstateAssetHoldingsPattern: /\b(ip|real\s+estate)\b/i.test(candidateEntityName),
    caution: {
      genericRegisteredAgentOnly: gra && !nm && !appearsInCreditDocs,
      nameSimilarityOnly: !gra && !appearsInCreditDocs,
    },
  });
  const conf = scoreEntityConfidence({
    exactNameRegistry: Boolean(body.entityId && String(body.entityId).trim()),
    sourceUrlCaptured: sourceUrl.length > 0,
    genericRegisteredAgentOnly: gra && !appearsInCreditDocs,
    inCreditDocsWithExcerpt: appearsInCreditDocs,
  });

  const row = await prisma.sosNameFamilyCandidate.create({
    data: {
      userId,
      ticker,
      candidateEntityName,
      normalizedCandidateEntityName: normalized,
      state,
      sourceName,
      sourceUrl,
      entityId: typeof body.entityId === "string" ? body.entityId : null,
      entityType: typeof body.entityType === "string" ? body.entityType : null,
      status: (body.status as VerifiedBusinessEntityStatus | undefined) ?? "unknown",
      formationDate: typeof body.formationDate === "string" && body.formationDate ? new Date(body.formationDate) : null,
      registeredAgentName: typeof body.registeredAgentName === "string" ? body.registeredAgentName : null,
      registeredAgentAddress: typeof body.registeredAgentAddress === "string" ? body.registeredAgentAddress : null,
      principalOfficeAddress: typeof body.principalOfficeAddress === "string" ? body.principalOfficeAddress : null,
      mailingAddress: typeof body.mailingAddress === "string" ? body.mailingAddress : null,
      matchedNameRoot: typeof body.matchedNameRoot === "string" ? body.matchedNameRoot : null,
      matchedSearchTerm: typeof body.matchedSearchTerm === "string" ? body.matchedSearchTerm : null,
      listedInExhibit21: Boolean(ex),
      appearsInCreditDocs,
      confidence: (body.confidence as EntityUniverseConfidenceKind | undefined) ?? conf,
      relevanceScore:
        typeof body.relevanceScore === "number" ? body.relevanceScore : rel,
      reviewStatus: (body.reviewStatus as EntityUniverseReviewStatus | undefined) ?? "unreviewed",
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}
