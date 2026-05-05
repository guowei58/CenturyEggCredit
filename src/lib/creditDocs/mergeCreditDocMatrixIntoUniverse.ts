import type { PrismaClient } from "@/generated/prisma/client";
import type {
  CreditDocDetailedReviewStatus,
  EntityUniverseItemRole,
  EntityUniverseReviewStatus,
} from "@/generated/prisma/client";
import { derivePrimaryUniverseRole } from "@/lib/creditDocs/buildEntityRoleMatrix";
import { CREDIT_MATRIX_ROLE_KEYS, emptyRoleFlagsJson, type CreditMatrixRoleKey, type RoleFlagTriState } from "@/lib/creditDocs/matrixRoleKeys";
import { mergeRoleFlag } from "@/lib/creditDocs/workflowRoleMatrixMerge";

function coerceFlags(raw: unknown): Record<CreditMatrixRoleKey, RoleFlagTriState> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = emptyRoleFlagsJson();
  for (const k of CREDIT_MATRIX_ROLE_KEYS) {
    const v = o[k];
    if (v === "true" || v === "false" || v === "unknown" || v === "needs_review") out[k] = v;
  }
  return out;
}

function mergeFlags(existing: unknown, incoming: Record<CreditMatrixRoleKey, RoleFlagTriState>): Record<CreditMatrixRoleKey, RoleFlagTriState> {
  const ex = coerceFlags(existing);
  const out = emptyRoleFlagsJson();
  for (const k of CREDIT_MATRIX_ROLE_KEYS) {
    out[k] = mergeRoleFlag(ex[k], incoming[k]);
  }
  return out;
}

const ROLE_PRIORITY: EntityUniverseItemRole[] = [
  "borrower",
  "issuer",
  "co_issuer",
  "guarantor",
  "grantor",
  "pledgor",
  "collateral_owner",
  "receivables_sub",
  "securitization_vehicle",
  "finance_sub",
  "unrestricted_subsidiary",
  "non_guarantor_subsidiary",
  "restricted_subsidiary",
  "excluded_subsidiary",
  "immaterial_subsidiary",
  "public_parent",
  "holding_company",
  "operating_company",
  "possible_affiliate",
  "unknown",
];

function roleRank(r: EntityUniverseItemRole): number {
  const i = ROLE_PRIORITY.indexOf(r);
  return i === -1 ? 999 : i;
}

function pickMoreStructuralRole(existing: EntityUniverseItemRole | null | undefined, incoming: EntityUniverseItemRole): EntityUniverseItemRole {
  const a = existing ?? "unknown";
  return roleRank(incoming) <= roleRank(a) ? incoming : a;
}

export function universeReviewFromMatrixRow(rs: CreditDocDetailedReviewStatus): EntityUniverseReviewStatus {
  switch (rs) {
    case "confirmed":
      return "confirmed_relevant";
    case "edited":
      return "likely_relevant";
    case "rejected":
      return "rejected";
    case "needs_follow_up":
      return "needs_follow_up";
    default:
      return "unreviewed";
  }
}

async function urlsForDocs(
  prisma: PrismaClient,
  userId: string,
  ticker: string,
  docIds: unknown
): Promise<{ titles: string; firstUrl: string | null }> {
  const ids = Array.isArray(docIds)
    ? docIds.filter((x): x is string => typeof x === "string")
    : typeof docIds === "string"
      ? [docIds]
      : [];
  if (!ids.length) return { titles: "", firstUrl: null };
  const sources = await prisma.creditDocumentSource.findMany({
    where: { id: { in: ids }, userId, ticker },
    select: { documentTitle: true, sourceUrl: true, secUrl: true },
  });
  const titles = sources.map((s) => s.documentTitle).filter(Boolean);
  const firstUrl =
    sources.map((s) => s.secUrl ?? s.sourceUrl).find((u): u is string => typeof u === "string" && u.length > 0) ?? null;
  return { titles: titles.join("; "), firstUrl };
}

export async function sendMatrixRowsToEntityUniverse(
  prisma: PrismaClient,
  opts: {
    userId: string;
    ticker: string;
    matrixRowIds: string[];
    force?: boolean;
    onlyConfirmed?: boolean;
  }
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const onlyConfirmed = opts.onlyConfirmed !== false;

  const rows = await prisma.creditDocumentEntityRoleMatrixRow.findMany({
    where: {
      userId: opts.userId,
      ticker: opts.ticker,
      id: { in: opts.matrixRowIds },
      ...(onlyConfirmed ? ({ reviewStatus: "confirmed" } as const) : {}),
    },
  });

  for (const row of rows) {
    const incomingFlags = coerceFlags(row.roleFlagsJson);
    const incomingPrimary =
      row.recommendedPrimaryRole ?? derivePrimaryUniverseRole(incomingFlags as Partial<Record<CreditMatrixRoleKey, RoleFlagTriState>>);
    const { titles, firstUrl } = await urlsForDocs(prisma, opts.userId, opts.ticker, row.sourceDocumentIds);

    const existing = await prisma.entityUniverseItem.findFirst({
      where: {
        userId: opts.userId,
        ticker: opts.ticker,
        normalizedEntityName: row.normalizedEntityName,
      },
    });

    if (!existing) {
      await prisma.entityUniverseItem.create({
        data: {
          userId: opts.userId,
          ticker: opts.ticker,
          entityName: row.entityName,
          normalizedEntityName: row.normalizedEntityName,
          entityRole: incomingPrimary,
          primarySourceCategory: "credit_document",
          mergedSourceCategories: ["credit_document"],
          sourceDocumentTitle: titles || null,
          sourceDocumentUrl: firstUrl,
          state: row.state || "",
          jurisdiction: row.jurisdiction || "",
          listedInExhibit21: row.listedInExhibit21,
          appearsInCreditDocs: true,
          confidence: row.confidence,
          relevanceScore: row.relevanceScore,
          roleFlagsJson: incomingFlags as object,
          reviewStatus: universeReviewFromMatrixRow(row.reviewStatus),
          evidenceJson: row.sourceEvidenceJson as object | undefined,
          notes: row.notes ?? null,
        },
      });
      created++;
      continue;
    }

    if (!opts.force && existing.reviewStatus === "confirmed_relevant") {
      skipped++;
      continue;
    }

    const merged = mergeFlags(existing.roleFlagsJson, incomingFlags);
    const mergedPrimary = pickMoreStructuralRole(existing.entityRole, derivePrimaryUniverseRole(merged));
    const mergedCats = [...new Set([...(existing.mergedSourceCategories ?? []), "credit_document"])];

    await prisma.entityUniverseItem.update({
      where: { id: existing.id },
      data: {
        appearsInCreditDocs: true,
        listedInExhibit21: existing.listedInExhibit21 || row.listedInExhibit21,
        entityRole: mergedPrimary === "unknown" ? existing.entityRole : mergedPrimary,
        mergedSourceCategories: mergedCats,
        primarySourceCategory: existing.primarySourceCategory === "exhibit_21" ? "exhibit_21" : "credit_document",
        sourceDocumentTitle: titles.length > 0 ? titles : existing.sourceDocumentTitle ?? null,
        sourceDocumentUrl: firstUrl ?? existing.sourceDocumentUrl,
        confidence: existing.confidence === "unknown" ? row.confidence : existing.confidence,
        relevanceScore: Math.max(existing.relevanceScore, row.relevanceScore),
        roleFlagsJson: merged as object,
        evidenceJson:
          existing.evidenceJson == null ? (row.sourceEvidenceJson as object) : ({ existing: existing.evidenceJson, creditWorkflow: row.sourceEvidenceJson } as object),
        reviewStatus: universeReviewFromMatrixRow(row.reviewStatus),
      },
    });
    updated++;
  }

  return { created, updated, skipped };
}
