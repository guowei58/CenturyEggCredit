import type { PrismaClient } from "@/generated/prisma/client";
import { reconciliationContext } from "@/lib/creditDocs/reconcileCreditDocEntities";
import { buildEntityRoleMatrixRows, derivePrimaryUniverseRole } from "@/lib/creditDocs/buildEntityRoleMatrix";
import type { CreditMatrixRoleKey } from "@/lib/creditDocs/matrixRoleKeys";
import type { RoleFlagTriState } from "@/lib/creditDocs/matrixRoleKeys";

import type { InputJsonValue } from "@prisma/client/runtime/client";

function jsonify(val: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(val === undefined ? {} : val)) as InputJsonValue;
}

/** Recomputes persisted matrix rows from all extractions for the ticker/workspace. */
export async function rebuildCreditDocEntityRoleMatrixForTicker(
  prisma: PrismaClient,
  opts: { userId: string; ticker: string }
): Promise<{ rowsUpserted: number }> {
  const extractions = await prisma.creditDocumentEntityExtraction.findMany({
    where: { userId: opts.userId, ticker: opts.ticker },
  });
  const sourceIds = [...new Set(extractions.map((e) => e.creditDocumentSourceId))];
  const sources =
    sourceIds.length > 0
      ? await prisma.creditDocumentSource.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, documentTitle: true },
        })
      : [];
  const titleById = new Map(sources.map((s) => [s.id, s.documentTitle]));

  const recon = await reconciliationContext(prisma, opts.userId, opts.ticker);
  const minimal = extractions.map((e) => ({
    id: e.id,
    entityName: e.entityName,
    normalizedEntityName: e.normalizedEntityName,
    entityRole: e.entityRole,
    roleConfidence: e.roleConfidence,
    creditDocumentSourceId: e.creditDocumentSourceId,
    sourceSection: e.sourceSection,
    sourceSchedule: e.sourceSchedule,
    excerpt: e.excerpt,
  }));

  const built = buildEntityRoleMatrixRows(minimal, titleById, recon.exhibit21Norms, recon.universeNorms);

  await prisma.$transaction(async (tx) => {
    await tx.creditDocumentEntityRoleMatrixRow.deleteMany({
      where: { userId: opts.userId, ticker: opts.ticker },
    });
    for (const row of built) {
      const flags = row.roleFlagsJson as Record<CreditMatrixRoleKey, RoleFlagTriState>;
      await tx.creditDocumentEntityRoleMatrixRow.create({
        data: {
          userId: opts.userId,
          ticker: opts.ticker,
          entityName: row.entityName,
          normalizedEntityName: row.normalizedEntityName,
          state: row.state || "",
          jurisdiction: row.jurisdiction || "",
          sourceDocumentIds: jsonify(row.sourceDocumentIds),
          sourceDocumentTitles: jsonify(row.sourceDocumentTitles),
          sourceEvidenceJson: jsonify(row.sourceEvidenceJson),
          roleFlagsJson: jsonify(row.roleFlagsJson),
          listedInExhibit21: row.listedInExhibit21,
          alreadyInEntityUniverse: row.alreadyInEntityUniverse,
          relevanceScore: row.relevanceScore,
          confidence: row.confidence,
          recommendedPrimaryRole: derivePrimaryUniverseRole(flags),
          keyEvidence: row.keyEvidence || null,
          reconciliationFlagsJson: jsonify(row.reconciliationFlagsJson),
          reviewStatus: "unreviewed",
        },
      });
    }
  });

  return { rowsUpserted: built.length };
}
