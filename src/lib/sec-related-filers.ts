/**
 * SEC Filings tab — “Entity” list aligned with sec.gov/edgar/search full-text index (EFTS).
 * See `sec-efts-entity-facet.ts`.
 */

import { getFilingsByTicker } from "@/lib/sec-edgar";
import {
  fetchEdgarSearchEntityFacetForCik,
} from "@/lib/sec-efts-entity-facet";

export type RelatedSecFiler = {
  cik: string;
  ticker: string;
  entityName: string;
  filingCount: number;
};

export type RelatedSecFilersResult =
  | {
      ok: true;
      parentCik: string;
      parentName: string;
      related: RelatedSecFiler[];
      disclaimer: string;
      relatedSource: "edgar-fts";
      /** Filings in the EFTS index for this CIK filter (same order of magnitude as SEC search). */
      eftsTotalFilings: number;
      /** True if we stopped paging before exhausting all index hits (cap ~1500). */
      eftsTruncated: boolean;
    }
  | { ok: false; message: string };

const MAX_ENTITY_ROWS = 85;

export async function getRelatedSecFilersForTicker(ticker: string): Promise<RelatedSecFilersResult> {
  const t = ticker?.trim();
  if (!t) return { ok: false, message: "Ticker required" };

  const filings = await getFilingsByTicker(t);
  if (!filings) {
    return { ok: false, message: "Company not found in SEC ticker list or filings unavailable." };
  }

  const parentCik = filings.cik;
  const parentName = filings.companyName.trim() || t.toUpperCase();

  try {
    const { rows, totalFilingsInIndex, truncated } = await fetchEdgarSearchEntityFacetForCik(parentCik);
    const related: RelatedSecFiler[] = rows.slice(0, MAX_ENTITY_ROWS).map((r) => ({
      cik: r.cik,
      ticker: r.ticker,
      entityName: r.entityName,
      filingCount: r.filingCount,
    }));

    return {
      ok: true,
      parentCik,
      parentName,
      related,
      disclaimer: "",
      relatedSource: "edgar-fts",
      eftsTotalFilings: totalFilingsInIndex,
      eftsTruncated: truncated,
    };
  } catch {
    return { ok: false, message: "Could not load SEC EDGAR full-text entity list." };
  }
}
