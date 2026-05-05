import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import {
  collateralFlags,
  debtorNameFinancePattern,
  scoreEntityRelevance,
} from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../_helpers";
import type { UccDebtorFilingKind, EntityUniverseReviewStatus, EntityUniverseConfidenceKind } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;
  const items = await prisma.uccDebtorCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } });
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
  const debtorName = typeof body.debtorName === "string" ? body.debtorName.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim().toUpperCase() : "";
  const sourceName = typeof body.sourceName === "string" ? body.sourceName : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  if (!debtorName || !state || !sourceName || !sourceUrl)
    return NextResponse.json({ error: "debtorName, state, sourceName, sourceUrl required" }, { status: 400 });

  const { normalized } = normalizeEntityName(debtorName);
  const ex = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const appearsInCreditDocs = !!(await prisma.creditDocumentEntity.findFirst({
    where: { userId, ticker, normalizedEntityName: normalized },
  }));

  const cf = collateralFlags(typeof body.collateralDescription === "string" ? body.collateralDescription : null);
  const rel = scoreEntityRelevance({
    listedInExhibit21: Boolean(ex),
    hasUccDebtorEvidence: true,
    collateralLooksMaterial: cf.collateralLooksMaterial,
    collateralReceivablesInventoryEquipmentDepositIp: cf.collateralReceivablesInventoryEquipmentDepositIp,
    financeSpvPattern: debtorNameFinancePattern(debtorName),
  });
  const conf = scoreEntityConfidence({
    strongUccEvidence: Boolean(body.filingNumber && String(body.filingNumber).trim()),
    sourceUrlCaptured: sourceUrl.length > 0,
    inCreditDocsWithExcerpt: appearsInCreditDocs,
  });

  const row = await prisma.uccDebtorCandidate.create({
    data: {
      userId,
      ticker,
      debtorName,
      normalizedDebtorName: normalized,
      state,
      sourceName,
      sourceUrl,
      filingNumber: typeof body.filingNumber === "string" ? body.filingNumber : null,
      filingDate: typeof body.filingDate === "string" && body.filingDate ? new Date(body.filingDate) : null,
      securedPartyName: typeof body.securedPartyName === "string" ? body.securedPartyName : null,
      collateralDescription:
        typeof body.collateralDescription === "string" ? body.collateralDescription : null,
      filingType: (body.filingType as UccDebtorFilingKind | undefined) ?? "unknown",
      matchedSearchTerm: typeof body.matchedSearchTerm === "string" ? body.matchedSearchTerm : null,
      listedInExhibit21: Boolean(ex),
      appearsInCreditDocs,
      confidence: (body.confidence as EntityUniverseConfidenceKind | undefined) ?? conf,
      relevanceScore:
        typeof body.relevanceScore === "number"
          ? body.relevanceScore
          : rel,
      reviewStatus: (body.reviewStatus as EntityUniverseReviewStatus | undefined) ?? "unreviewed",
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });
  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}
