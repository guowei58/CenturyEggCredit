/**
 * SEC EDGAR API — filings only. Free, no auth.
 * See: https://www.sec.gov/edgar/sec-api-documentation
 * Rate limit: 10 requests per second per IP. User-Agent required.
 */

export const SEC_EDGAR_USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

/**
 * User-Agent for SEC HTTP requests. `SEC_EDGAR_USER_AGENT` env overrides the default.
 * A bare email in env is wrapped with an app name (SEC expects a descriptive identifier, not only an address).
 */
export function getSecEdgarUserAgent(): string {
  const raw = process.env.SEC_EDGAR_USER_AGENT?.trim();
  if (!raw || raw.length < 8) {
    return SEC_EDGAR_USER_AGENT;
  }
  const bareEmail = /^[^\s<>,]+@[^\s<>,]+\.[^\s@]+$/i.test(raw);
  if (bareEmail) {
    return `CenturyEggCredit (${raw})`;
  }
  return raw;
}

export type SecFiling = {
  form: string;
  filingDate: string;
  description: string;
  accessionNumber: string;
  primaryDocument: string;
  docUrl: string;
};

export type SecFilingsResult = {
  companyName: string;
  cik: string;
  filings: SecFiling[];
};

type CompanyTickersEntry = { cik_str: number; ticker: string; title: string };
type CompanyTickersJson = Record<string, CompanyTickersEntry>;

type SubmissionsRecent = {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
};

type SubmissionsJson = {
  name?: string;
  cik?: string;
  sic?: string;
  sicDescription?: string;
  stateOfIncorporation?: string;
  fiscalYearEnd?: string;
  /** Prior registered names — useful for text-based industry matching */
  formerNames?: Array<{ name?: string } | string>;
  filings?: {
    recent?: SubmissionsRecent;
    files?: Array<{ name?: string; filingCount?: number; filingFrom?: string; filingTo?: string }>;
  };
};

export type SecCompanyProfile = {
  name: string;
  ticker: string;
  cik: string;
  sic: string;
  sicDescription: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  filingsCount: number;
  /** Prior SEC-registered legal names (submissions `formerNames`) */
  formerNames: string[];
};

/**
 * Fetch the SEC company tickers JSON and resolve ticker -> CIK (10-digit string).
 */
export async function getCikFromTicker(ticker: string): Promise<string | null> {
  const url = "https://www.sec.gov/files/company_tickers.json";
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!res.ok) return null;
  const data = (await res.json()) as CompanyTickersJson;
  const upper = ticker.trim().toUpperCase();
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (entry.ticker && entry.ticker.toUpperCase() === upper) {
      return String(entry.cik_str).padStart(10, "0");
    }
  }
  return null;
}

/**
 * Fetch company submissions for a CIK and return recent filings with document URLs.
 */
export async function getFilingsByCik(cik: string): Promise<SecFilingsResult | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;
  const recent = data.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) {
    return { companyName: data.name ?? "Unknown", cik: padded, filings: [] };
  }
  const companyName = data.name ?? "Unknown";
  const filings: SecFiling[] = [];
  const len = recent.accessionNumber.length;
  for (let i = 0; i < len; i++) {
    const acc = recent.accessionNumber[i] ?? "";
    const accNoDashes = acc.replace(/-/g, "");
    const doc = recent.primaryDocument?.[i] ?? "";
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(padded, 10)}/${accNoDashes}/${doc}`;
    filings.push({
      form: recent.form?.[i] ?? "",
      filingDate: recent.filingDate?.[i] ?? "",
      description: recent.primaryDocDescription?.[i] ?? "",
      accessionNumber: acc,
      primaryDocument: doc,
      docUrl,
    });
  }
  return { companyName, cik: padded, filings };
}

type SubmissionsChunkJson = {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
};

async function fetchSubmissionsChunk(name: string): Promise<SubmissionsChunkJson | null> {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  // names are like "CIK0000320193-submissions-001.json"
  const url = `https://data.sec.gov/submissions/${encodeURIComponent(clean)}`;
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!res.ok) return null;
  try {
    return (await res.json()) as SubmissionsChunkJson;
  } catch {
    return null;
  }
}

/**
 * Fetch all filings available in SEC submissions for a CIK by loading `filings.recent` plus `filings.files[]` chunks.
 * This is needed for multi-year (e.g. 20-year quarterly) history.
 */
export async function getAllFilingsByCik(cik: string): Promise<SecFilingsResult | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;

  const companyName = data.name ?? "Unknown";
  const out: SecFiling[] = [];

  const pushFromBlock = (blk: SubmissionsChunkJson | SubmissionsRecent | null | undefined) => {
    if (!blk?.accessionNumber?.length) return;
    const len = blk.accessionNumber.length;
    for (let i = 0; i < len; i++) {
      const acc = blk.accessionNumber?.[i] ?? "";
      const accNoDashes = acc.replace(/-/g, "");
      const doc = blk.primaryDocument?.[i] ?? "";
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(padded, 10)}/${accNoDashes}/${doc}`;
      out.push({
        form: blk.form?.[i] ?? "",
        filingDate: blk.filingDate?.[i] ?? "",
        description: blk.primaryDocDescription?.[i] ?? "",
        accessionNumber: acc,
        primaryDocument: doc,
        docUrl,
      });
    }
  };

  pushFromBlock(data.filings?.recent);

  const files = Array.isArray(data.filings?.files) ? data.filings!.files! : [];
  for (const f of files) {
    const name = (f.name ?? "").trim();
    if (!name) continue;
    const chunk = await fetchSubmissionsChunk(name);
    pushFromBlock(chunk);
  }

  // de-dupe by accession + primary document
  const uniq = new Map<string, SecFiling>();
  for (const r of out) {
    const k = `${r.accessionNumber}::${r.primaryDocument}`;
    if (!uniq.has(k)) uniq.set(k, r);
  }

  const filings = Array.from(uniq.values()).sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
  return { companyName, cik: padded, filings };
}

/**
 * Resolve ticker to CIK, then fetch and return recent filings.
 */
export async function getFilingsByTicker(ticker: string): Promise<SecFilingsResult | null> {
  const cik = await getCikFromTicker(ticker);
  if (!cik) return null;
  return getFilingsByCik(cik);
}

/** Resolve ticker to CIK, then fetch long-history submissions (recent + chunks). */
export async function getAllFilingsByTicker(ticker: string): Promise<SecFilingsResult | null> {
  const cik = await getCikFromTicker(ticker);
  if (!cik) return null;
  return getAllFilingsByCik(cik);
}

/**
 * Accession numbers are FILER_CIK-yr-######. The issuer’s submissions feed includes filings
 * filed under other CIKs (e.g. Form 4 by insiders, 13G by institutions), matching SEC “Entity” facets.
 */
export function parseFilerCikFromAccession(accessionNumber: string): string | null {
  const raw = (accessionNumber || "").trim();
  if (!raw) return null;
  const dash = raw.indexOf("-");
  if (dash < 1) return null;
  const head = raw.slice(0, dash).replace(/\D/g, "");
  if (!head || head.length > 10) return null;
  const padded = head.padStart(10, "0");
  if (padded === "0000000000") return null;
  return padded;
}

/** Display name + tickers from submissions JSON (minimal parse). */
export async function getCompanyMetadataByCik(cik: string): Promise<{ name: string; tickers: string[] } | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!res.ok) return null;
  const data = (await res.json()) as { name?: string; tickers?: string[] };
  const name = (data.name ?? "").trim();
  const tickers = Array.isArray(data.tickers)
    ? data.tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean)
    : [];
  return { name: name || `CIK ${padded}`, tickers };
}

export type SecCompanySearchHit = {
  cik: string;
  ticker: string;
  title: string;
};

/**
 * Strip punctuation so "GROUP INC" matches SEC title "GROUP, INC." and similar.
 */
export function normalizeCompanyNameForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if every significant token from the query appears in the title (order-free). */
function titleMatchesAllTokens(normTitle: string, normQuery: string): boolean {
  const tokens = normQuery
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return normQuery.length >= 2 && normTitle.includes(normQuery);
  return tokens.every((t) => normTitle.includes(t));
}

function rankNormalizedMatch(normTitle: string, normQuery: string): number {
  if (normTitle === normQuery) return 100;
  if (normTitle.startsWith(normQuery)) return 85;
  if (normTitle.includes(normQuery)) {
    const idx = normTitle.indexOf(normQuery);
    return 70 - Math.min(25, idx);
  }
  if (normTitle.length >= 8 && normQuery.includes(normTitle)) {
    return 72 - Math.min(20, normQuery.indexOf(normTitle));
  }
  const tokenScore = titleMatchesAllTokens(normTitle, normQuery) ? 55 : 0;
  return tokenScore;
}

function titleMatchesQuery(title: string, rawQuery: string): { ok: boolean; normTitle: string; normQuery: string } {
  const normTitle = normalizeCompanyNameForSearch(title);
  const normQuery = normalizeCompanyNameForSearch(rawQuery);
  if (normQuery.length < 2) return { ok: false, normTitle, normQuery };
  if (normTitle.includes(normQuery)) return { ok: true, normTitle, normQuery };
  /** Exhibit 21 often uses a longer string than SEC "conformed-name" (e.g. omits ", INC."). */
  if (normTitle.length >= 8 && normQuery.includes(normTitle)) return { ok: true, normTitle, normQuery };
  if (titleMatchesAllTokens(normTitle, normQuery)) return { ok: true, normTitle, normQuery };
  return { ok: false, normTitle, normQuery };
}

export type TickerJsonEntry = { cik_str: number; ticker: string; title: string };

let companyTickersCache: { entries: TickerJsonEntry[]; fetchedAt: number } | null = null;
const COMPANY_TICKERS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * SEC company_tickers.json (~10k issuers), cached in memory to avoid one fetch per name search.
 */
export async function getCompanyTickersEntriesCached(): Promise<TickerJsonEntry[] | null> {
  const now = Date.now();
  if (companyTickersCache && now - companyTickersCache.fetchedAt < COMPANY_TICKERS_CACHE_TTL_MS) {
    return companyTickersCache.entries;
  }
  try {
    const url = "https://www.sec.gov/files/company_tickers.json";
    const res = await fetch(url, {
      headers: { "User-Agent": getSecEdgarUserAgent() },
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as CompanyTickersJson | TickerJsonEntry[];
    const entries = listCompanyTickersEntries(raw);
    companyTickersCache = { entries, fetchedAt: now };
    return entries;
  } catch {
    return null;
  }
}

function listCompanyTickersEntries(data: CompanyTickersJson | TickerJsonEntry[]): TickerJsonEntry[] {
  if (Array.isArray(data)) {
    return data.filter(
      (entry): entry is TickerJsonEntry =>
        Boolean(entry && typeof entry === "object" && "cik_str" in entry)
    );
  }
  const out: TickerJsonEntry[] = [];
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (entry && typeof entry === "object" && "cik_str" in entry) out.push(entry as TickerJsonEntry);
  }
  return out;
}

/**
 * Rank SEC company_tickers entries by name match (same rules as searchSecCompaniesByName).
 */
export function matchSecCompaniesByNameScored(
  query: string,
  entries: TickerJsonEntry[],
  limit: number
): { hit: SecCompanySearchHit; score: number }[] {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !entries.length) return [];
  const scored: { hit: SecCompanySearchHit; score: number }[] = [];
  for (const entry of entries) {
    const title = (entry.title ?? "").trim();
    if (!title) continue;
    const { ok, normTitle, normQuery } = titleMatchesQuery(title, trimmed);
    if (!ok) continue;
    const ticker = (entry.ticker ?? "").trim().toUpperCase();
    const hit: SecCompanySearchHit = {
      cik: String(entry.cik_str).padStart(10, "0"),
      ticker: ticker || "—",
      title,
    };
    scored.push({ hit, score: rankNormalizedMatch(normTitle, normQuery) });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.hit.title.length - b.hit.title.length;
  });
  return scored.slice(0, Math.min(limit, 80));
}

/**
 * Search SEC’s company_tickers.json by issuer name.
 * Uses punctuation-insensitive matching so typed names align with SEC titles (e.g. "Inc" vs "INC.").
 */
export async function searchSecCompaniesByName(query: string, limit = 50): Promise<SecCompanySearchHit[]> {
  const entries = await getCompanyTickersEntriesCached();
  if (!entries?.length) return [];
  return matchSecCompaniesByNameScored(query, entries, limit).map((s) => s.hit);
}

/** Normalize user CIK input to 10-digit string or null. */
export function normalizeCikInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 1 || digits.length > 10) return null;
  return digits.padStart(10, "0");
}

/**
 * Fetch company profile from SEC submissions (name, industry, state, FY end, filings count).
 * No business description or financials — those would require 10-K parsing or other sources.
 */
export async function getCompanyProfile(ticker: string): Promise<SecCompanyProfile | null> {
  const cik = await getCikFromTicker(ticker);
  if (!cik) return null;
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;
  const recent = data.filings?.recent;
  const filingsCount = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber.length : 0;
  const fy = data.fiscalYearEnd?.replace(/-/g, "").trim();
  const fiscalYearEnd = fy && fy.length >= 4 ? `${fy.slice(0, 2)}/${fy.slice(2)}` : "—";
  const formerNames = parseFormerNamesFromSubmissions(data.formerNames);
  return {
    name: data.name ?? ticker,
    ticker: ticker.trim().toUpperCase(),
    cik: padded,
    sic: data.sic ?? "—",
    sicDescription: data.sicDescription ?? "—",
    stateOfIncorporation: data.stateOfIncorporation ?? "—",
    fiscalYearEnd,
    filingsCount,
    formerNames,
  };
}

function parseFormerNamesFromSubmissions(raw: SubmissionsJson["formerNames"]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const n = typeof entry === "string" ? entry : entry?.name;
    const t = typeof n === "string" ? n.replace(/\s+/g, " ").trim() : "";
    if (t.length >= 2 && t.length <= 200) out.push(t);
  }
  return out.slice(0, 12);
}
