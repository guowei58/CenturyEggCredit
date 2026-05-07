import type { EntityMapperEvidence, EntityMapperV2Snapshot } from "@/lib/entity-mapper-v2/types";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { prisma } from "@/lib/prisma";
import { securedPartyLooksLikeFinancingAgent } from "@/lib/ucc/creditPartyMatch";
import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";

/**
 * Non-destructively merges UCC search rows into the persisted Entity Mapper v2 snapshot evidence array.
 * Never implies borrower/guarantor status — only collateral/grantor hypotheses for review.
 */
export async function mergeUccSearchResultsIntoEntityMapperSnapshot(
  userId: string,
  ticker: string
): Promise<{ merged: number; note?: string }> {
  const rows = await prisma.uccSearchResult.findMany({ where: { userId, ticker } });
  if (!rows.length) return { merged: 0 };

  const raw = await readSavedContent(ticker, "entity-mapper-v2-snapshot", userId);
  if (!raw?.trim()) return { merged: 0, note: "no_entity_mapper_snapshot" };

  let snap: EntityMapperV2Snapshot;
  try {
    snap = JSON.parse(raw) as EntityMapperV2Snapshot;
  } catch {
    return { merged: 0, note: "invalid_entity_mapper_snapshot" };
  }

  if (snap.version !== 2 || !Array.isArray(snap.evidence) || !Array.isArray(snap.exhibit21Universe)) {
    return { merged: 0, note: "unexpected_snapshot_shape" };
  }

  const exhibitNorm = new Set(snap.exhibit21Universe.map((r) => normalizeEntityName(r.exhibit21LegalName).normalized));

  const existingIds = new Set(snap.evidence.map((e) => e.id));
  let merged = 0;

  for (const r of rows) {
    const debtorNorm = normalizeEntityName(r.debtorNameFound).normalized;
    if (!debtorNorm || !exhibitNorm.has(debtorNorm)) continue;

    const id = `ucc:${r.id}`;
    if (existingIds.has(id)) continue;

    const agentLike = securedPartyLooksLikeFinancingAgent(r.securedPartyName);

    let status: EntityMapperEvidence["status"] = "Unclear";
    const fs = (r.filingStatus ?? "").toLowerCase();
    if (fs === "active") status = "Current";
    else if (fs === "terminated" || fs === "lapsed") status = "Historical";

    const filingDateIso =
      r.filingDate instanceof Date ? r.filingDate.toISOString().slice(0, 10) : String(r.filingDate ?? "").slice(0, 10);

    const ev: EntityMapperEvidence = {
      id,
      subsidiary_name: r.entitySearched,
      normalized_subsidiary_name: normalizeEntityName(r.entitySearched).normalized,
      matched_document_entity_name: r.debtorNameFound,
      role: "Grantor / Pledgor / Collateral Party",
      role_value: "Ambiguous",
      facility_family: "",
      document_name: "UCC financing statement",
      document_type: "ucc_financing_statement",
      document_date: "",
      filing_date: filingDateIso,
      accession_number: "",
      exhibit_number: "",
      direct_exhibit_url: r.documentLink ?? r.sourceUrl ?? "",
      section_reference: "",
      source_quote: `Secured party: ${r.securedPartyName ?? "—"} · Filing #: ${r.filingNumber ?? "—"} · ${r.jurisdiction}`,
      confidence: agentLike ? "Medium" : "Low",
      status,
      notes:
        "UCC debtor filing located — verify against collateral / pledge agreements. UCC debtor status does not establish borrower or guarantor.",
    };

    snap.evidence.push(ev);
    existingIds.add(id);
    merged++;
  }

  if (merged === 0) return { merged: 0, note: "no_matching_exhibit21_debtors" };

  const w = await writeSavedContent(ticker, "entity-mapper-v2-snapshot", JSON.stringify(snap), userId);
  if (!w.ok) return { merged: 0, note: w.error };
  return { merged };
}
