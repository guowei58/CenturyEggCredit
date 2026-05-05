import { prisma } from "@/lib/prisma";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";

import type { Exhibit21UniverseRow } from "@/lib/entity-mapper-v2/types";

/** Shared normalizer for matching document entity strings to Exhibit 21 rows. */
export function normalizeLegalName(name: string): string {
  let s = name.trim().toLowerCase();
  s = s.replace(/,/g, "");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\b(inc\.?|incorporated)\b/gi, "inc");
  s = s.replace(/\b(corp\.?|corporation)\b/gi, "corp");
  s = s.replace(/\b(co\.?|company)\b/gi, "co");
  s = s.replace(/\b(l\.?l\.?c\.?|llc)\b/gi, "llc");
  s = s.replace(/\b(ltd\.?|limited)\b/gi, "ltd");
  s = s.replace(/\b(l\.?p\.?|lp)\b/gi, "lp");
  s = s.replace(/\s*&\s*/g, " and ");
  return s.trim();
}

export async function loadExhibit21UniverseForTicker(
  userId: string,
  ticker: string
): Promise<{ rows: Exhibit21UniverseRow[]; profileUpdatedAtIso: string | null }> {
  const sym = sanitizeTicker(ticker);
  if (!sym || !userId) return { rows: [], profileUpdatedAtIso: null };

  const prof = await prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId, ticker: sym } },
    select: {
      subsidiaryNames: true,
      subsidiaryDomiciles: true,
      subsidiaryExhibit21Snapshot: true,
      updatedAt: true,
      notes: true,
    },
  });

  if (!prof) return { rows: [], profileUpdatedAtIso: null };

  const table = subsidiaryTableRowsFromSavedProfile(
    prof.subsidiaryExhibit21Snapshot,
    prof.subsidiaryNames ?? [],
    prof.subsidiaryDomiciles ?? []
  );

  const updatedIso = prof.updatedAt.toISOString();
  const sourceFiling = "Exhibit 21";

  const rows: Exhibit21UniverseRow[] = table.map((r) => ({
    exhibit21LegalName: r.name.trim(),
    normalizedLegalName: normalizeLegalName(r.name),
    jurisdiction: r.domicile.replace(/\s+/g, " ").trim(),
    entityType: "",
    sourceFiling,
    sourceDate: updatedIso.split("T")[0] ?? updatedIso,
    sourceLink: "",
  }));

  return { rows, profileUpdatedAtIso: updatedIso };
}
