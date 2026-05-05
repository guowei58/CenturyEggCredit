import { normalizeEntityName } from "@/lib/entityNormalize";

/**
 * Builds Entity Universe Exhibit 21 row payloads matching the subsidiary table on Public Records Profile.
 */
export function exhibit21UniverseMirrorFromProfileSubsidiaries(
  ticker: string,
  prRows: { name: string; domicile: string }[],
  cdNorm: Set<string>,
  uccNorm: Set<string>,
  options?: { userId?: string }
): Record<string, unknown>[] {
  return prRows.map((r, idx) => {
    const entityName = r.name.trim();
    const dom = r.domicile?.trim() || "";
    const { normalized } = normalizeEntityName(entityName);
    const now = new Date();
    const row: Record<string, unknown> = {
      id: `profile-mirror:${ticker}:${idx}:${normalized}`,
      ticker,
      entityName,
      normalizedEntityName: normalized,
      jurisdiction: dom || null,
      source10KTitle: "Public Records profile (Exhibit 21)",
      source10KUrl: null,
      fiscalYear: null,
      listedAsSignificant: false,
      materialityNote: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      appearsInCreditDocs: cdNorm.has(normalized),
      appearsInUccSearch: uccNorm.has(normalized),
      exhibit21Source: "profile_mirror",
    };
    if (options?.userId) row.userId = options.userId;
    return row;
  });
}
