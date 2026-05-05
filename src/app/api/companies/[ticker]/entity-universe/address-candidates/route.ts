import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { addressKindForBonus, debtorNameFinancePattern, scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../_helpers";
import type {
  AddressClusterAddressKind,
  EntityUniverseConfidenceKind,
  EntityUniverseReviewStatus,
  VerifiedBusinessEntityStatus,
} from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;
  const items = await prisma.addressClusterCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } });
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
  const candidateEntityName =
    typeof body.candidateEntityName === "string" ? body.candidateEntityName.trim() : "";
  const matchedAddress = typeof body.matchedAddress === "string" ? body.matchedAddress.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim().toUpperCase() : "";
  const sourceName = typeof body.sourceName === "string" ? body.sourceName : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  if (!candidateEntityName || !matchedAddress || !state || !sourceName || !sourceUrl)
    return NextResponse.json({ error: "candidateEntityName, matchedAddress, state, sourceName, sourceUrl required" }, { status: 400 });

  const { normalized } = normalizeEntityName(candidateEntityName);
  const addrType = (body.addressType as AddressClusterAddressKind | undefined) ?? "unknown";
  const exRows = await prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker } });
  const exHit = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const nm = exRows.some((e) => normalizeEntityName(e.entityName).root === normalizeEntityName(candidateEntityName).root);
  const cd = !!(await prisma.creditDocumentEntity.findFirst({
    where: { userId, ticker, normalizedEntityName: normalized },
  }));

  const rel = scoreEntityRelevance({
    listedInExhibit21: Boolean(exHit),
    nameRootMatch: nm,
    financeSpvPattern: debtorNameFinancePattern(candidateEntityName),
    ...addressKindForBonus(addrType),
    caution: nm ? {} : { nameSimilarityOnly: true },
  });
  const conf = scoreEntityConfidence({
    exactNameRegistry: Boolean(body.entityId && String(body.entityId).trim()),
    sourceUrlCaptured: sourceUrl.length > 0,
    addressOnly: nm === false && !cd,
    inCreditDocsWithExcerpt: cd,
  });

  const row = await prisma.addressClusterCandidate.create({
    data: {
      userId,
      ticker,
      candidateEntityName,
      normalizedCandidateEntityName: normalized,
      matchedAddress,
      addressType: addrType,
      state,
      sourceName,
      sourceUrl,
      entityId: typeof body.entityId === "string" ? body.entityId : null,
      entityType: typeof body.entityType === "string" ? body.entityType : null,
      status: (body.status as VerifiedBusinessEntityStatus | undefined) ?? "unknown",
      evidenceJson: body.evidenceJson && typeof body.evidenceJson === "object" ? (body.evidenceJson as object) : undefined,
      listedInExhibit21: Boolean(exHit),
      appearsInCreditDocs: cd,
      confidence: (body.confidence as EntityUniverseConfidenceKind | undefined) ?? conf,
      relevanceScore:
        typeof body.relevanceScore === "number" ? body.relevanceScore : rel,
      reviewStatus: (body.reviewStatus as EntityUniverseReviewStatus | undefined) ?? "unreviewed",
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}
