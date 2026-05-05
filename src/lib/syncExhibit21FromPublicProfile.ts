import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";

const SOURCE_TITLE = "Public Records profile (Exhibit 21)";

/**
 * Mirrors the subsidiary list saved on State & Local Public Records (grid snapshot or name/domicile arrays)
 * into `exhibit_21_subsidiaries` for Entity Universe workflows.
 */
export async function syncExhibit21SubsidiariesFromPublicProfile(
  db: Pick<PrismaClient, "publicRecordsProfile" | "exhibit21Subsidiary">,
  userId: string,
  ticker: string
): Promise<{ profileRowsProcessed: number; created: number; updated: number }> {
  const prof = await db.publicRecordsProfile.findFirst({ where: { userId, ticker } });
  if (!prof) return { profileRowsProcessed: 0, created: 0, updated: 0 };

  const rows = subsidiaryTableRowsFromSavedProfile(
    prof.subsidiaryExhibit21Snapshot,
    prof.subsidiaryNames,
    prof.subsidiaryDomiciles
  );

  let created = 0;
  let updated = 0;

  for (const r of rows) {
    const name = r.name.trim();
    if (name.length < 3) continue;
    const { normalized } = normalizeEntityName(name);
    const jurisdiction = r.domicile?.trim() || null;

    const existing = await db.exhibit21Subsidiary.findFirst({
      where: { userId, ticker, normalizedEntityName: normalized },
    });

    if (!existing) {
      await db.exhibit21Subsidiary.create({
        data: {
          userId,
          ticker,
          entityName: name,
          normalizedEntityName: normalized,
          jurisdiction,
          source10KTitle: SOURCE_TITLE,
          source10KUrl: null,
          fiscalYear: null,
          listedAsSignificant: false,
          materialityNote: null,
          notes: null,
        },
      });
      created++;
      continue;
    }

    if (existing.entityName !== name || (existing.jurisdiction ?? "") !== (jurisdiction ?? "")) {
      await db.exhibit21Subsidiary.update({
        where: { id: existing.id },
        data: {
          entityName: name,
          normalizedEntityName: normalized,
          jurisdiction,
          source10KTitle: SOURCE_TITLE,
        },
      });
      updated++;
    }
  }

  return { profileRowsProcessed: rows.length, created, updated };
}
