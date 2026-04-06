/**
 * List EDGAR filer CIKs that appear in an issuer’s submissions history (from accession numbers),
 * similar to the SEC full-text search “Entity” facet for a company.
 */

import {
  getCompanyMetadataByCik,
  getCompanyTickersEntriesCached,
  getFilingsByTicker,
  parseFilerCikFromAccession,
} from "@/lib/sec-edgar";

export type RelatedSecFiler = {
  cik: string;
  ticker: string;
  entityName: string;
  /** Filings in this issuer’s current submissions feed whose accession starts with this filer CIK. */
  filingCount: number;
};

export type RelatedSecFilersResult =
  | {
      ok: true;
      parentCik: string;
      parentName: string;
      related: RelatedSecFiler[];
      disclaimer: string;
    }
  | { ok: false; message: string };

const DISCLAIMER =
  "Each row is a distinct filer CIK taken from accession numbers in this issuer’s EDGAR submissions data—the same filer CIK SEC shows in filing metadata. Counts are how often that filer CIK appears on filings listed for the sidebar ticker’s issuer (recent submissions feed), not a global full-text hit count. Insiders and other registrants appear here when they file forms in that feed.";

const MAX_ENTITIES = 80;
const MIN_GAP_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getRelatedSecFilersForTicker(ticker: string): Promise<RelatedSecFilersResult> {
  const t = ticker?.trim();
  if (!t) return { ok: false, message: "Ticker required" };

  const filings = await getFilingsByTicker(t);
  if (!filings) {
    return { ok: false, message: "Company not found in SEC ticker list or filings unavailable." };
  }

  const counts = new Map<string, number>();
  for (const f of filings.filings) {
    const filer = parseFilerCikFromAccession(f.accessionNumber);
    if (!filer) continue;
    counts.set(filer, (counts.get(filer) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTITIES);

  const entries = await getCompanyTickersEntriesCached();
  const fromTickers = new Map<string, { ticker: string; title: string }>();
  if (entries) {
    for (const e of entries) {
      const cik = String(e.cik_str).padStart(10, "0");
      const tk = (e.ticker ?? "").trim().toUpperCase();
      fromTickers.set(cik, {
        ticker: tk || "—",
        title: (e.title ?? "").trim() || `CIK ${cik}`,
      });
    }
  }

  const related: RelatedSecFiler[] = [];
  let lastMetadataAt = 0;

  async function throttledMetadata(cik: string) {
    const now = Date.now();
    if (lastMetadataAt > 0) {
      const wait = MIN_GAP_MS - (now - lastMetadataAt);
      if (wait > 0) await sleep(wait);
    }
    const meta = await getCompanyMetadataByCik(cik);
    lastMetadataAt = Date.now();
    return meta;
  }

  for (const [cik, filingCount] of sorted) {
    const mapped = fromTickers.get(cik);
    let entityName: string;
    let tickerSym: string;

    if (mapped?.title) {
      entityName = mapped.title;
      tickerSym = mapped.ticker;
    } else {
      const meta = await throttledMetadata(cik);
      entityName = meta?.name?.trim() || `CIK ${cik}`;
      const first = meta?.tickers?.[0]?.trim().toUpperCase();
      tickerSym = first && first.length > 0 ? first : "—";
    }

    related.push({ cik, ticker: tickerSym, entityName, filingCount });
  }

  return {
    ok: true,
    parentCik: filings.cik,
    parentName: filings.companyName.trim() || t.toUpperCase(),
    related,
    disclaimer: DISCLAIMER,
  };
}
