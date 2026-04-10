/**
 * SEC EDGAR full-text search (EFTS) — same backing index as sec.gov/edgar/search/#/ciks=...
 * GET https://efts.sec.gov/LATEST/search-index?ciks=0001415404&start=&count=
 * Each hit lists parallel `ciks` / `display_names` for entities co-tagged on a filing.
 */

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

const PAGE_SIZE = 100;
const MAX_PAGES = 15;
const RATE_MS = 130;

/** Max filings scanned when paging EFTS (100 × 15). */
export const EFTS_ENTITY_FACET_MAX_FILINGS_SCANNED = PAGE_SIZE * MAX_PAGES;

export type EftsEntityFacetRow = {
  cik: string;
  /** SEC display string, e.g. "DISH Network CORP  (CIK 0001001082)" */
  entityName: string;
  ticker: string;
  /** Count of indexed filings where this exact display label appears for this CIK. */
  filingCount: number;
};

type EftsSearchHit = {
  _source?: {
    ciks?: string[];
    display_names?: string[];
  };
};

type EftsSearchResponse = {
  hits?: {
    total?: { value?: number; relation?: string };
    hits?: EftsSearchHit[];
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function padCik(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.padStart(10, "0");
}

function cleanDisplay(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Ticker in SEC labels: `Name (TICKER)  (CIK …)` */
function parseTickerFromDisplay(display: string): string {
  const m = display.match(/\(\s*([A-Z]{1,5})\s*\)\s*\(\s*CIK\s*\d/i);
  return m ? m[1]!.toUpperCase() : "—";
}

/**
 * Walk all pages for `ciks=` filter and aggregate counts per (cik, display_names[i]) pair.
 * Mirrors the “Entity” facet on SEC’s EDGAR search when filtered to one issuer CIK.
 */
export async function fetchEdgarSearchEntityFacetForCik(cik: string): Promise<{
  rows: EftsEntityFacetRow[];
  totalFilingsInIndex: number;
  truncated: boolean;
}> {
  const cik10 = padCik(cik);
  if (!cik10 || cik10 === "0000000000") {
    return { rows: [], totalFilingsInIndex: 0, truncated: false };
  }

  let start = 0;
  let totalFilings = 0;
  const counts = new Map<string, number>();
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = `https://efts.sec.gov/LATEST/search-index?ciks=${encodeURIComponent(cik10)}&start=${start}&count=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`SEC EFTS search failed (${res.status})`);
    }
    const j = (await res.json()) as EftsSearchResponse;
    totalFilings = j.hits?.total?.value ?? totalFilings;
    const hits = j.hits?.hits ?? [];
    pages++;

    for (const row of hits) {
      const src = row._source ?? {};
      const ciks = Array.isArray(src.ciks) ? src.ciks : [];
      const names = Array.isArray(src.display_names) ? src.display_names : [];
      const n = Math.min(ciks.length, names.length);
      for (let i = 0; i < n; i++) {
        const ck = padCik(String(ciks[i] ?? ""));
        if (!ck || ck === "0000000000") continue;
        const label = cleanDisplay(String(names[i] ?? ""));
        if (!label) continue;
        const key = `${ck}::${label}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    start += hits.length;
    if (hits.length === 0) break;
    if (start >= totalFilings) break;
    await sleep(RATE_MS);
  }

  const truncated = start < totalFilings;
  const rows: EftsEntityFacetRow[] = Array.from(counts.entries())
    .map(([key, filingCount]) => {
      const sep = key.indexOf("::");
      const ck = key.slice(0, sep);
      const entityName = key.slice(sep + 2);
      return {
        cik: ck,
        entityName,
        ticker: parseTickerFromDisplay(entityName),
        filingCount,
      };
    })
    .sort((a, b) =>
      b.filingCount !== a.filingCount
        ? b.filingCount - a.filingCount
        : a.entityName.localeCompare(b.entityName, undefined, { sensitivity: "base" })
    );

  return { rows, totalFilingsInIndex: totalFilings, truncated };
}
