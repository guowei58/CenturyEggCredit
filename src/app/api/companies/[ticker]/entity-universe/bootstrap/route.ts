import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exhibit21UniverseMirrorFromProfileSubsidiaries } from "@/lib/entityUniverseExhibitMirror";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";
import { syncExhibit21SubsidiariesFromPublicProfile } from "@/lib/syncExhibit21FromPublicProfile";
import { requireUserTicker, serEntityUniverseRow } from "../_helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  try {
    await syncExhibit21SubsidiariesFromPublicProfile(prisma, userId, ticker);
  } catch {
    /** Table may not exist yet, or DB error — bootstrap still returns profile mirror for Exhibit 21. */
  }

  let exhibit21Subsidiaries: Awaited<ReturnType<typeof prisma.exhibit21Subsidiary.findMany>> = [];
  try {
    exhibit21Subsidiaries = await prisma.exhibit21Subsidiary.findMany({
      where: { userId, ticker },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    exhibit21Subsidiaries = [];
  }

  const [
    creditDocEntities,
    uccDebtorCandidates,
    sosNameFamilyCandidates,
    addressClusterCandidates,
    masterRows,
    issues,
    discoveryTasks,
    intelProfile,
    publicRecordsProf,
  ] = await Promise.all([
    prisma.creditDocumentEntity.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }),
    prisma.uccDebtorCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }),
    prisma.sosNameFamilyCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }),
    prisma.addressClusterCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }),
    prisma.entityUniverseItem.findMany({ where: { userId, ticker }, orderBy: [{ relevanceScore: "desc" }, { updatedAt: "desc" }] }),
    prisma.entityUniverseIssue.findMany({ where: { userId, ticker }, orderBy: [{ severity: "desc" }, { updatedAt: "desc" }] }),
    prisma.entityUniverseDiscoveryTask.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }),
    prisma.entityIntelligenceProfile.findFirst({ where: { userId, ticker } }),
    prisma.publicRecordsProfile.findUnique({
      where: { userId_ticker: { userId, ticker } },
    }),
  ]);

  const cdNorm = new Set(creditDocEntities.map((r) => r.normalizedEntityName));
  const uccNorm = new Set(uccDebtorCandidates.map((r) => r.normalizedDebtorName));

  const profileTableRows =
    publicRecordsProf != null
      ? subsidiaryTableRowsFromSavedProfile(
          publicRecordsProf.subsidiaryExhibit21Snapshot,
          publicRecordsProf.subsidiaryNames,
          publicRecordsProf.subsidiaryDomiciles
        )
      : [];

  let exhibit21Payload: Record<string, unknown>[];
  /** Profile subsidiaries drive Exhibit 21 when present on the saved public records profile row. */
  if (profileTableRows.length > 0) {
    exhibit21Payload = exhibit21UniverseMirrorFromProfileSubsidiaries(ticker, profileTableRows, cdNorm, uccNorm, {
      userId,
    }).map((r) => serEntityUniverseRow(r)) as Record<string, unknown>[];
  } else if (exhibit21Subsidiaries.length > 0) {
    exhibit21Payload = exhibit21Subsidiaries.map((r) => ({
      ...serEntityUniverseRow(r as unknown as Record<string, unknown>),
      appearsInCreditDocs: cdNorm.has(r.normalizedEntityName),
      appearsInUccSearch: uccNorm.has(r.normalizedEntityName),
    })) as Record<string, unknown>[];
  } else {
    exhibit21Payload = [];
  }

  const exNorm = new Set(
    exhibit21Payload.map((r) => {
      const ne = r.normalizedEntityName;
      if (typeof ne === "string" && ne.length > 0) return ne;
      return normalizeEntityName(String(r.entityName ?? "")).normalized;
    })
  );

  return NextResponse.json({
    exhibit21Subsidiaries: exhibit21Payload,
    creditDocEntities: creditDocEntities.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
    uccDebtorCandidates: uccDebtorCandidates.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
    sosNameFamilyCandidates: sosNameFamilyCandidates.map((r) =>
      serEntityUniverseRow(r as unknown as Record<string, unknown>)
    ),
    addressClusterCandidates: addressClusterCandidates.map((r) =>
      serEntityUniverseRow(r as unknown as Record<string, unknown>)
    ),
    masterRows: masterRows.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
    issues: issues.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
    discoveryTasks: discoveryTasks.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
    entityIntelligenceProfile: intelProfile ? serEntityUniverseRow(intelProfile as unknown as Record<string, unknown>) : null,
    exhibit21NormalizedSet: [...exNorm],
  });
}
