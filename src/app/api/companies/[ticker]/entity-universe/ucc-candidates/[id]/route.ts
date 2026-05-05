import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { collateralFlags, debtorNameFinancePattern, scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { isGenericRegisteredAgent } from "@/lib/entityNormalize";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type { EntityUniverseReviewStatus, EntityUniverseConfidenceKind, UccDebtorFilingKind } from "@/generated/prisma/client";

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

  const existing = await prisma.uccDebtorCandidate.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName =
    typeof body.debtorName === "string" ? body.debtorName.trim() : existing.debtorName;
  const normalized = normalizeEntityName(nextName).normalized;
  const ex = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const cd = !!(await prisma.creditDocumentEntity.findFirst({
    where: { userId, ticker, normalizedEntityName: normalized },
  }));

  const collat =
    typeof body.collateralDescription === "string" ? body.collateralDescription : existing.collateralDescription;
  const cf = collateralFlags(collat ?? "");
  const rel = scoreEntityRelevance({
    listedInExhibit21: Boolean(ex),
    hasUccDebtorEvidence: true,
    collateralLooksMaterial: cf.collateralLooksMaterial,
    collateralReceivablesInventoryEquipmentDepositIp: cf.collateralReceivablesInventoryEquipmentDepositIp,
    financeSpvPattern: debtorNameFinancePattern(nextName),
  });

  const conf = scoreEntityConfidence({
    strongUccEvidence:
      typeof body.filingNumber === "string"
        ? body.filingNumber.length > 0
        : Boolean(existing.filingNumber && existing.filingNumber.length > 0),
    sourceUrlCaptured:
      typeof body.sourceUrl === "string" ? body.sourceUrl.length > 0 : existing.sourceUrl.length > 0,
    inCreditDocsWithExcerpt: cd,
    genericRegisteredAgentOnly: Boolean(
      existing.securedPartyName && isGenericRegisteredAgent(existing.securedPartyName)
    ),
  });

  const row = await prisma.uccDebtorCandidate.update({
    where: { id },
    data: {
      debtorName: typeof body.debtorName === "string" ? nextName : undefined,
      normalizedDebtorName: typeof body.debtorName === "string" ? normalized : undefined,
      state: typeof body.state === "string" ? body.state.trim().toUpperCase() : undefined,
      sourceName: typeof body.sourceName === "string" ? body.sourceName : undefined,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      filingNumber: typeof body.filingNumber === "string" ? body.filingNumber : undefined,
      filingDate:
        typeof body.filingDate === "string" ? (body.filingDate ? new Date(body.filingDate) : null) : undefined,
      securedPartyName: typeof body.securedPartyName === "string" ? body.securedPartyName : undefined,
      collateralDescription:
        typeof body.collateralDescription === "string" ? body.collateralDescription : undefined,
      filingType: (body.filingType as UccDebtorFilingKind | undefined) ?? undefined,
      matchedSearchTerm:
        typeof body.matchedSearchTerm === "string" ? body.matchedSearchTerm : undefined,
      listedInExhibit21: Boolean(ex),
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

  const existing = await prisma.uccDebtorCandidate.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.uccDebtorCandidate.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
