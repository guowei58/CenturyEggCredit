import type { CreditDocSourceFilingKind } from "@/generated/prisma/client";
import type { DebtDocumentTableRow } from "@/lib/creditDocs/edgarDebtDocSearch/types";
import type { DebtDocSearchInputs } from "@/lib/creditDocs/edgarDebtDocSearch/types";
import type { EdgarDebtDocSearchResult } from "@/lib/creditDocs/edgarDebtDocSearch/types";
import { runDebtDocSearch } from "@/lib/creditDocs/edgarDebtDocSearch/runDebtDocSearch";
import type { FinderCandidate } from "@/lib/creditDocs/findCreditDocuments";
import { inferCreditDocumentTitleType } from "@/lib/creditDocs/findCreditDocuments";

function formToFilingKind(form: string): CreditDocSourceFilingKind {
  const f = form.trim().toUpperCase();
  if (f === "10-K" || f.startsWith("10-K")) return "sec_10k";
  if (f === "10-Q" || f.startsWith("10-Q")) return "sec_10q";
  if (f.startsWith("8-K")) return "sec_8k";
  if (f.startsWith("S-1")) return "sec_s1";
  if (f.startsWith("S-3")) return "sec_s3";
  if (f.startsWith("S-4")) return "sec_s4";
  if (f.startsWith("424")) return "sec_424b";
  return "other";
}

function filenameFromSecUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").pop();
    return seg ? decodeURIComponent(seg) : "document";
  } catch {
    return "document";
  }
}

function tableRowToFinderCandidate(row: DebtDocumentTableRow): FinderCandidate {
  const fn = filenameFromSecUrl(row.directExhibitLink);
  return {
    documentTitle: `${row.filingForm} (${row.filingDate}) — ${row.instrumentOrFacilityName}`,
    documentType: inferCreditDocumentTitleType(`${row.documentType} ${row.instrumentOrFacilityName}`),
    filingType: formToFilingKind(row.filingForm),
    sourceUrl: row.directExhibitLink,
    savedDocumentRefId: `edgar:${row.accessionNumber}::${fn}`,
    extractedTextDigest: null,
    openUrl: row.directExhibitLink,
    filingDate: row.filingDate,
  };
}

/** Full EDGAR debt playbook + finder candidates for queue/links. */
export async function findEdgarDebtDocSearchWithReport(
  ticker: string,
  opts?: Partial<DebtDocSearchInputs>
): Promise<{ search: EdgarDebtDocSearchResult | null; candidates: FinderCandidate[] }> {
  const search = await runDebtDocSearch({
    ticker,
    lookbackYears: 10,
    ...opts,
  });
  if (!search) return { search: null, candidates: [] };
  return { search, candidates: search.table.map(tableRowToFinderCandidate) };
}

/** Finder-only EDGAR rows (same pipeline as {@link findEdgarDebtDocSearchWithReport}). */
export async function findEdgarCreditDocumentCandidates(ticker: string): Promise<FinderCandidate[]> {
  const { candidates } = await findEdgarDebtDocSearchWithReport(ticker);
  return candidates;
}

export function mergeCreditFinderCandidates(edgar: FinderCandidate[], local: FinderCandidate[]): FinderCandidate[] {
  const seen = new Set<string>();
  const merged: FinderCandidate[] = [];
  for (const c of [...edgar, ...local]) {
    const k = ((c.openUrl ?? "") || (c.savedDocumentRefId ?? "") || c.documentTitle).toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push(c);
  }
  return merged;
}
