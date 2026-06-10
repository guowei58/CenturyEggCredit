/**
 * SEC EDGAR API — filings only. Free, no auth.
 * See: https://www.sec.gov/edgar/sec-api-documentation
 * Rate limit: 10 requests per second per IP. User-Agent required.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/** Submissions feeds must bypass Next.js/Data cache so new filings appear the same day. */
export function secRemoteFetchInit(): RequestInit {
  return {
    headers: { "User-Agent": getSecEdgarUserAgent() },
    cache: "no-store",
  };
}

export type SecFiling = {
  form: string;
  filingDate: string;
  /**
   * Period end date on periodic filings when SEC provides it (`reportDate` in submissions JSON).
   * Earnings 8-K (Item 2.02) usually lands relative to this date, not the later 10-Q acceptance date.
   */
  reportDate?: string;
  /** SEC submissions `items` (comma-separated Item numbers, e.g. `2.02,9.01` or `5.02,9.01`). */
  items?: string;
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
  /** Comma-separated Item numbers, e.g. `2.02,9.01` — present on modern 8-K rows. */
  items?: string[];
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
  /** Principal place of business / mailing — SEC submissions (`data.sec.gov/submissions`) */
  addresses?: {
    business?: {
      street1?: string;
      street2?: string;
      city?: string;
      stateOrCountry?: string;
      zip?: string;
    };
    mailing?: {
      street1?: string;
      street2?: string;
      city?: string;
      stateOrCountry?: string;
      zip?: string;
    };
  };
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
 * Variants to try when mapping a user symbol to `company_tickers.json`.
 * SEC uses hyphens for class tickers (e.g. BRK-B) while many data vendors use dots (BRK.B).
 */
export function secCompanyTickerLookupCandidates(raw: string): string[] {
  const base = raw.trim().toUpperCase();
  if (!base) return [];
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim().toUpperCase();
    if (t && !out.includes(t)) out.push(t);
  };
  add(base);
  if (base.includes(".")) add(base.replace(/\./g, "-"));
  const nospace = base.replace(/\s+/g, "");
  if (nospace !== base) add(nospace);
  const spacedToHyphen = base.replace(/\s+/g, "-");
  if (spacedToHyphen !== base && spacedToHyphen !== nospace) add(spacedToHyphen);
  return out;
}

/** True if `raw` should be treated as a numeric SEC CIK (not a ticker symbol). */
function looksLikeNumericCikInput(raw: string): boolean {
  const t = raw.trim();
  if (!t || !/^\d+$/.test(t)) return false;
  return t.length >= 6 && t.length <= 10;
}

/**
 * Fetch the SEC company tickers JSON and resolve ticker -> CIK (10-digit string).
 * Accepts optional numeric CIK (6–10 digits). Maps broker-style class symbols (BRK.B → BRK-B).
 */
export async function getCikFromTicker(ticker: string): Promise<string | null> {
  const trimmed = ticker.trim();
  if (!trimmed) return null;

  if (looksLikeNumericCikInput(trimmed)) {
    return trimmed.padStart(10, "0");
  }

  const entries = await getCompanyTickersEntriesCached();
  if (!entries?.length) return null;
  const candidates = secCompanyTickerLookupCandidates(trimmed);
  for (const upper of candidates) {
    for (const entry of entries) {
      if (entry.ticker && entry.ticker.toUpperCase() === upper) {
        return String(entry.cik_str).padStart(10, "0");
      }
    }
  }

  if (/^\d+$/.test(trimmed)) {
    const asCik = normalizeCikInput(trimmed);
    if (asCik) return asCik;
  }

  return null;
}

/**
 * Fetch company submissions for a CIK and return recent filings with document URLs.
 */
export async function getFilingsByCik(cik: string): Promise<SecFilingsResult | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, secRemoteFetchInit());
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
    const rd = recent.reportDate?.[i] ?? "";
    const items = recent.items?.[i] ?? "";
    filings.push({
      form: recent.form?.[i] ?? "",
      filingDate: recent.filingDate?.[i] ?? "",
      ...(rd.trim() ? { reportDate: rd } : {}),
      ...(items.trim() ? { items } : {}),
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
  items?: string[];
};

async function fetchSubmissionsChunk(name: string): Promise<SubmissionsChunkJson | null> {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  // names are like "CIK0000320193-submissions-001.json"
  const url = `https://data.sec.gov/submissions/${encodeURIComponent(clean)}`;
  const res = await fetch(url, secRemoteFetchInit());
  if (!res.ok) return null;
  try {
    return (await res.json()) as SubmissionsChunkJson;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export type GetAllFilingsByCikOptions = {
  /** Delay between submissions chunk fetches (SEC rate limiting). */
  paceChunkMs?: number;
  /** Optional SEC form filter applied while collecting long-history filings. */
  includeForms?: string[];
  /** Optional cap so callers can stop once enough matching filings are collected. */
  maxFilings?: number;
  /**
   * When `true`, merge periodic filings from: built‑in predecessor map, optional
   * `data/sec-predecessor-ciks-by-ticker.json`, and any **extra CIKs** in SEC `company_tickers.json` that list the
   * same symbol (minus the resolved primary CIK). Archive fetches already fall back to the accession-prefix CIK.
   * When omitted, only the small built‑in map (e.g. GOOG) merges, and only if `maxFilings` / `includeForms` are not set.
   */
  mergePredecessorIssuers?: boolean;
};

/** Padded CIKs listed under the same ticker after a reorganisation whose historical 10‑Q / 10‑K filings live under a prior issuer. */
const TICKER_MERGED_PREDECESSOR_CIKS: Record<string, readonly string[]> = {
  // Alphabet superseded GOOGLE INC.; EDGAR submissions before Oct 2015 are under predecessor CIK 0001288776 (see 8‑K Oct 2015).
  GOOG: ["0001288776"],
  GOOGL: ["0001288776"],
};

let cachedPredecessorCiksByTicker: Record<string, readonly string[]> | undefined;

/**
 * Optional `data/sec-predecessor-ciks-by-ticker.json`: `{ "TICKER": ["0001234567", ...] }` (zero-padded CIKs).
 * Used when {@link GetAllFilingsByCikOptions.mergePredecessorIssuers} is `true` (e.g. XBRL diagnostics).
 */
function loadOptionalPredecessorCiksByTicker(): Record<string, readonly string[]> {
  if (cachedPredecessorCiksByTicker !== undefined) return cachedPredecessorCiksByTicker;
  try {
    const p = join(process.cwd(), "data", "sec-predecessor-ciks-by-ticker.json");
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const out: Record<string, readonly string[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      const ku = k.trim().toUpperCase();
      if (!ku || ku.startsWith("$")) continue;
      if (!Array.isArray(v)) continue;
      const arr = v.map((x) => String(x).trim()).filter(Boolean);
      if (arr.length) out[ku] = arr;
    }
    cachedPredecessorCiksByTicker = out;
  } catch {
    cachedPredecessorCiksByTicker = {};
  }
  return cachedPredecessorCiksByTicker;
}

function normalizeExtraIssuerCiks(raw: readonly string[], primaryPadded: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    const p = String(c ?? "")
      .replace(/\D/g, "")
      .padStart(10, "0");
    if (!p || p === "0000000000" || p === primaryPadded || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Normalize accession numbers for Map keys / dedupe (strip dashes, uppercase). */
export function secAccessionDedupeKey(acc: string): string {
  return (acc ?? "").trim().replace(/-/g, "").toUpperCase();
}

/** True when SEC submissions `items` lists **Item 2.02** (results of operations / earnings). */
export function secSubmissionItemsIncludeItem202(items: string | undefined): boolean {
  const raw = (items ?? "").trim();
  if (!raw) return false;
  return raw.split(",").some((p) => /^2\.0?2$/i.test(p.trim()));
}

/**
 * 8-K is a plausible source for an **earnings** press release: Item 2.02 appears in the primary HTML scan, or
 * submissions `items` is absent (legacy feed), or `items` includes 2.02. Filters filings that only disclose
 * Items like 5.02 (officer changes) with no earnings Item.
 */
export function secFilingIsEarningsPressRelease8K(
  f: SecFiling,
  item202ByAccessionKey: ReadonlyMap<string, boolean>
): boolean {
  const k = secAccessionDedupeKey(f.accessionNumber);
  if (k && item202ByAccessionKey.get(k) === true) return true;
  const items = (f.items ?? "").trim();
  if (!items) return true;
  return secSubmissionItemsIncludeItem202(f.items);
}

/** Merge filings from one primary issuer bundle and predecessor bundles (dedupe by accession number). Filings sorted newest-first. */
export function mergeSuccessorIssuerBundles(primary: SecFilingsResult, predecessors: readonly SecFilingsResult[]): SecFilingsResult {
  const uniq = new Map<string, SecFiling>();
  for (const f of primary.filings) {
    const k = secAccessionDedupeKey(f.accessionNumber);
    if (k) uniq.set(k, f);
  }
  for (const bundle of predecessors) {
    for (const f of bundle.filings) {
      const k = secAccessionDedupeKey(f.accessionNumber);
      if (!k || uniq.has(k)) continue;
      uniq.set(k, f);
    }
  }
  const filings = Array.from(uniq.values()).sort((a, b) =>
    String(b.filingDate || "").localeCompare(String(a.filingDate || ""))
  );
  return { companyName: primary.companyName, cik: primary.cik, filings };
}

function tickerWantsSuccessorMerge(symUpper: string, opts?: GetAllFilingsByCikOptions): boolean {
  if (opts?.mergePredecessorIssuers === false) return false;
  if (opts?.mergePredecessorIssuers === true) return true;
  const preds = TICKER_MERGED_PREDECESSOR_CIKS[symUpper];
  if (!preds?.length) return false;
  const capped =
    typeof opts?.maxFilings === "number" && Number.isFinite(opts.maxFilings) && opts.maxFilings >= 1;
  const filtered = !!(opts?.includeForms && opts.includeForms.length > 0);
  if (capped || filtered) return false;
  return true;
}

/**
 * Fetch all filings available in SEC submissions for a CIK by loading `filings.recent` plus `filings.files[]` chunks.
 * This is needed for multi-year (e.g. 20-year quarterly) history.
 */
export async function getAllFilingsByCik(
  cik: string,
  opts?: GetAllFilingsByCikOptions
): Promise<SecFilingsResult | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, secRemoteFetchInit());
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;

  const companyName = data.name ?? "Unknown";
  const includeForms = (opts?.includeForms ?? []).map((form) => form.trim().toUpperCase()).filter(Boolean);
  const includeFormSet = includeForms.length > 0 ? new Set(includeForms) : null;
  const maxFilingsRaw = opts?.maxFilings;
  const maxFilings =
    typeof maxFilingsRaw === "number" && Number.isFinite(maxFilingsRaw) && maxFilingsRaw >= 1
      ? Math.floor(maxFilingsRaw)
      : Number.POSITIVE_INFINITY;
  const uniq = new Map<string, SecFiling>();

  const pushFromBlock = (blk: SubmissionsChunkJson | SubmissionsRecent | null | undefined) => {
    if (!blk?.accessionNumber?.length) return;
    const len = blk.accessionNumber.length;
    for (let i = 0; i < len; i++) {
      const acc = blk.accessionNumber?.[i] ?? "";
      const accNoDashes = acc.replace(/-/g, "");
      const form = blk.form?.[i] ?? "";
      if (includeFormSet && !includeFormSet.has(form.trim().toUpperCase())) continue;
      const doc = blk.primaryDocument?.[i] ?? "";
      const rd = blk.reportDate?.[i] ?? "";
      const items = blk.items?.[i] ?? "";
      const filing: SecFiling = {
        form,
        filingDate: blk.filingDate?.[i] ?? "",
        ...(rd.trim() ? { reportDate: rd } : {}),
        ...(items.trim() ? { items } : {}),
        description: blk.primaryDocDescription?.[i] ?? "",
        accessionNumber: acc,
        primaryDocument: doc,
        docUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(padded, 10)}/${accNoDashes}/${doc}`,
      };
      const key = `${filing.accessionNumber}::${filing.primaryDocument}`;
      if (!uniq.has(key)) uniq.set(key, filing);
    }
  };

  pushFromBlock(data.filings?.recent);

  const files = Array.isArray(data.filings?.files) ? data.filings!.files! : [];
  for (const f of files) {
    if (uniq.size >= maxFilings) break;
    const name = (f.name ?? "").trim();
    if (!name) continue;
    const pace = opts?.paceChunkMs ?? 0;
    if (pace > 0) await sleep(pace);
    const chunk = await fetchSubmissionsChunk(name);
    pushFromBlock(chunk);
  }

  const filings = Array.from(uniq.values())
    .sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""))
    .slice(0, maxFilings);
  return { companyName, cik: padded, filings };
}

/**
 * SEC `company_tickers.json` sometimes lists the same symbol on more than one CIK (e.g. after a re-org).
 * Used only when {@link GetAllFilingsByCikOptions.mergePredecessorIssuers} is `true`.
 */
async function listOtherCiksSharingTickerInCompanyTickersJson(
  ticker: string,
  primaryPadded: string
): Promise<string[]> {
  const entries = await getCompanyTickersEntriesCached();
  if (!entries?.length) return [];
  const candidates = secCompanyTickerLookupCandidates(ticker);
  const found = new Set<string>();
  for (const e of entries) {
    const t = (e.ticker ?? "").trim().toUpperCase();
    if (!candidates.includes(t)) continue;
    const p = String(e.cik_str ?? "")
      .replace(/\D/g, "")
      .padStart(10, "0");
    if (p && p !== primaryPadded) found.add(p);
  }
  return Array.from(found);
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
export async function getAllFilingsByTicker(
  ticker: string,
  opts?: GetAllFilingsByCikOptions
): Promise<SecFilingsResult | null> {
  const trimmed = ticker.trim();
  const cik = await getCikFromTicker(trimmed);
  if (!cik) return null;

  const primary = await getAllFilingsByCik(cik, opts);

  const symUpper = trimmed.toUpperCase();
  const paddedPrimary = cik.replace(/\D/g, "").padStart(10, "0");
  const explicitPredecessorMerge = opts?.mergePredecessorIssuers === true;
  const implicitPredecessorMerge = tickerWantsSuccessorMerge(symUpper, opts);

  let extrasRaw: string[] = [];
  if (explicitPredecessorMerge) {
    const fromStatic = TICKER_MERGED_PREDECESSOR_CIKS[symUpper] ?? [];
    const fromFile = loadOptionalPredecessorCiksByTicker()[symUpper] ?? [];
    const fromTickerFile = await listOtherCiksSharingTickerInCompanyTickersJson(trimmed, paddedPrimary);
    extrasRaw = [...fromStatic, ...fromFile, ...fromTickerFile];
  } else if (implicitPredecessorMerge) {
    extrasRaw = [...(TICKER_MERGED_PREDECESSOR_CIKS[symUpper] ?? [])];
  }

  const extraCiks = normalizeExtraIssuerCiks(extrasRaw, paddedPrimary);

  if (!primary || extraCiks.length === 0) {
    return primary;
  }

  const paceBetweenIssuers =
    typeof opts?.paceChunkMs === "number" && Number.isFinite(opts.paceChunkMs) && opts.paceChunkMs > 0
      ? opts.paceChunkMs
      : 120;

  const predBundles: SecFilingsResult[] = [];
  for (const predCik of extraCiks) {
    await sleep(paceBetweenIssuers);
    const p = await getAllFilingsByCik(predCik, opts);
    if (p) predBundles.push(p);
  }

  if (predBundles.length === 0) return primary;
  return mergeSuccessorIssuerBundles(primary, predBundles);
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

/**
 * CIK path segments to try under `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/`.
 *
 * Order matches {@link loadPresentedStatementsValidationContext}: **`issuerCik` first** (filing-agent accessions often
 * store artifacts under the reporting company), **then** the accession-prefix filer CIK when it differs (predecessor
 * issuer folders before a reorg — e.g. GOOG-era `0001288776-…` while the ticker resolves to Alphabet `1652044`).
 */
export function edgarArchivesFolderCikCandidates(issuerCikPadded: string, accessionNumber: string): string[] {
  const out: string[] = [];
  const issuer = (issuerCikPadded ?? "").replace(/\D/g, "").padStart(10, "0");
  if (issuer !== "0000000000") out.push(issuer);
  const fromAcc = parseFilerCikFromAccession(accessionNumber);
  if (fromAcc && fromAcc !== issuer) out.push(fromAcc);
  return out;
}

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` filing date to UTC noon ms for stable date windows. */
export function parseIsoFilingDateUtcMs(filingDate: string): number | null {
  const t = (filingDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const ms = Date.parse(`${t}T12:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Archives URL for a filing&apos;s primary document.
 * Uses the **issuer / submissions** CIK for the `/Archives/edgar/data/{cik}/` segment (first argument).
 * Accessions often begin with a *different* CIK (e.g. filing agent); those files still live under the
 * reporting company&apos;s folder — the same convention as `primaryDocument` URLs in SEC submissions JSON.
 */
export function secArchivesPrimaryDocumentUrl(
  issuerCikPadded: string,
  filing: Pick<SecFiling, "accessionNumber" | "primaryDocument">
): string | null {
  const doc = (filing.primaryDocument ?? "").trim();
  if (!doc) return null;
  const cikNum = parseInt(issuerCikPadded.replace(/\D/g, ""), 10);
  const acc = (filing.accessionNumber ?? "").replace(/-/g, "");
  if (!Number.isFinite(cikNum) || cikNum <= 0 || !acc) return null;
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${encodeURIComponent(doc)}`;
}

/** Fetch HTML for an EDGAR primary document (same path convention as Inline XBRL viewers). */
export async function fetchEdgarPrimaryDocumentHtml(
  issuerCikPadded: string,
  filing: Pick<SecFiling, "accessionNumber" | "primaryDocument">
): Promise<string | null> {
  for (const cik of edgarArchivesFolderCikCandidates(issuerCikPadded, filing.accessionNumber)) {
    const url = secArchivesPrimaryDocumentUrl(cik, filing);
    if (!url) continue;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "text/html,*/*" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (html && html.length >= 500) return html;
    } catch {
      continue;
    }
  }
  return null;
}

const ITEM_202_HTML_SCAN_MAX_CHARS = 250_000;

/**
 * True if the **primary** 8-K HTML appears to disclose Item 2.02 (Results of Operations and Financial Condition).
 * SEC submissions `primaryDocDescription` is often just "8-K"; scanning the opened document aligns with EDGAR item lists.
 */
export function detectItem202In8KPrimaryHtml(html: string): boolean {
  if (!html || html.length < 200) return false;
  const chunk = html.length > ITEM_202_HTML_SCAN_MAX_CHARS ? html.slice(0, ITEM_202_HTML_SCAN_MAX_CHARS) : html;
  let t = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/&#160;|&nbsp;|&#xA0;/gi, " ");
  t = t.replace(/<\/(p|div|tr|br|li)\s*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\s+/g, " ");
  if (/\bitem\s*(?:ii|2|two)\s*(?:\.|·)?\s*0*2(?:\b|\s|\.|,)/i.test(t)) return true;
  if (/\b2\s*\.\s*0\s*2\s+results\s+of\s+operations\b/i.test(t)) return true;
  return false;
}

/**
 * Whether submissions metadata suggests an earnings / Item 2.02–style 8-K (used to rank ahead of generic current reports).
 * Best-effort only — many filings have sparse `primaryDocDescription`.
 */
export function hasEarningsAdjacent8KMetadataSignal(f: SecFiling): boolean {
  const blob = `${f.description ?? ""}\n${f.primaryDocument ?? ""}`;
  const low = blob.toLowerCase();
  if (/\bitem\s*(?:ii|2|two)\s*(?:\.|·)?\s*0*2(?:\b|\s|\.|,)/i.test(blob) || /\b2\.0?2\s*results\b/i.test(blob))
    return true;
  if (
    /\b(earnings|results?\s+of\s+operations|financial\s+results|press\s+release|earnings\s+release|quarterly\s+results)\b/i.test(
      blob
    )
  )
    return true;
  if (/\b(exhibit\s*99|ex-99|exhibit\s+99)\b/i.test(blob)) return true;
  if (/99[\w.-]*\.(htm|html)/i.test(blob) || /ex99|pressrelease|earnings[_-]?release/i.test(low)) return true;
  if (/earnings/i.test(low) && /release/i.test(low)) return true;
  return false;
}

export type RankEarningsAdjacent8KOpts = {
  maxDaysBefore?: number;
  maxDaysAfter?: number;
  /**
   * When the anchor date is a periodic report&apos;s **period end** (`reportDate`), earnings Item 2.02 + Exhibit 99
   * typically file **after** that date but **before** the 10-Q/10-K acceptance date. Use a wider forward window and
   * temporal scoring keyed off “days after period end.”
   */
  anchorIsPeriodEnd?: boolean;
};

export type RankEarningsAdjacent8KPrimaryScanResult = {
  ranked: SecFiling[];
  /** Primary document HTML fetched while ranking (null when fetch failed). Key = {@link secAccessionDedupeKey}. */
  primaryHtmlByAccessionKey: Map<string, string | null>;
  /** {@link detectItem202In8KPrimaryHtml} per accession. Key = {@link secAccessionDedupeKey}. */
  item202ByAccessionKey: Map<string, boolean>;
};

type EarningsAdjacent8KWindow = {
  candidates: SecFiling[];
  baseMs: number;
  anchorIsPeriodEnd: boolean;
};

function buildEarningsAdjacent8KWindow(
  filings: SecFiling[],
  anchorDate: string,
  opts?: RankEarningsAdjacent8KOpts
): EarningsAdjacent8KWindow | null {
  const anchorIsPeriodEnd = opts?.anchorIsPeriodEnd === true;
  const maxBefore =
    typeof opts?.maxDaysBefore === "number" && Number.isFinite(opts.maxDaysBefore) && opts.maxDaysBefore >= 0
      ? opts.maxDaysBefore
      : anchorIsPeriodEnd
        ? 7
        : 14;
  const maxAfter =
    typeof opts?.maxDaysAfter === "number" && Number.isFinite(opts.maxDaysAfter) && opts.maxDaysAfter >= 0
      ? opts.maxDaysAfter
      : anchorIsPeriodEnd
        ? 85
        : 2;
  const baseMs = parseIsoFilingDateUtcMs(anchorDate);
  if (baseMs == null) return null;
  const minD = baseMs - maxBefore * MS_PER_DAY;
  const maxD = baseMs + maxAfter * MS_PER_DAY;

  const candidates = filings.filter((f) => {
    const form = (f.form ?? "").toUpperCase();
    if (!form.startsWith("8-K")) return false;
    const d = parseIsoFilingDateUtcMs(f.filingDate);
    if (d == null) return false;
    return d >= minD && d <= maxD;
  });

  return { candidates, baseMs, anchorIsPeriodEnd };
}

function earningsAdjacent8KScore(f: SecFiling, baseMs: number, anchorIsPeriodEnd: boolean): number {
  let s = 0;
  const blob = `${f.description ?? ""}\n${f.primaryDocument ?? ""}`.toLowerCase();
  const item202 = /\bitem\s*(?:ii|2|two)\s*(?:\.|·)?\s*0*2(?:\b|\s|\.|,)/i.test(blob) || /\b2\.0?2\s*results\b/i.test(blob);
  if (item202) s += 130;
  if (
    /\b(earnings|results?\s+of\s+operations|financial\s+results|press\s+release|earnings\s+release|quarterly\s+results)\b/.test(
      blob
    )
  ) {
    s += 110;
  }
  if (/\b(exhibit\s*99|ex-99|exhibit\s+99)\b/.test(blob)) s += 55;
  if (/99[\w.-]*\.(htm|html)|ex99|pressrelease|earnings[_-]?release/.test(blob)) s += 45;

  const hasEarningsSignal =
    item202 ||
    /\b(earnings|results?\s+of\s+operations|financial\s+results|press\s+release|exhibit\s*99|ex-99)\b/.test(blob) ||
    /99[\w.-]*\.(htm|html)|ex99|pressrelease|earnings[_-]?release/.test(blob) ||
    (/\bearnings\b/.test(blob) && /\brelease\b/.test(blob));
  if (/\bother\s+events?\b/.test(blob) && !hasEarningsSignal) s -= 35;

  const d = parseIsoFilingDateUtcMs(f.filingDate);
  if (d == null) return s;
  if (anchorIsPeriodEnd) {
    const lagDays = (d - baseMs) / MS_PER_DAY;
    if (lagDays < -5) s += 6;
    else if (lagDays <= 0) s += 32;
    else {
      const target = 28;
      s += 52 - Math.min(42, Math.abs(lagDays - target) * 1.25);
    }
  } else {
    const dayDiff = (baseMs - d) / MS_PER_DAY;
    if (dayDiff === 0) s += 50;
    else if (dayDiff > 0) s += 42 - Math.min(24, dayDiff * 2);
    else s += 18;
  }
  return s;
}

function sortEarningsAdjacent8KCandidates(
  candidates: SecFiling[],
  baseMs: number,
  anchorIsPeriodEnd: boolean,
  item202FromPrimary?: ReadonlyMap<string, boolean>
): SecFiling[] {
  const strong = (f: SecFiling): boolean => {
    const k = secAccessionDedupeKey(f.accessionNumber);
    const fromHtml = k ? item202FromPrimary?.get(k) === true : false;
    return hasEarningsAdjacent8KMetadataSignal(f) || fromHtml;
  };

  return [...candidates].sort((a, b) => {
    const sa = strong(a) ? 1 : 0;
    const sb = strong(b) ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return earningsAdjacent8KScore(b, baseMs, anchorIsPeriodEnd) - earningsAdjacent8KScore(a, baseMs, anchorIsPeriodEnd);
  });
}

/**
 * Rank Form 8-K filings near a 10-K/10-Q **filing** date or, preferably, its **period end** (`reportDate`).
 */
export function rankEarningsAdjacent8KFilings(
  filings: SecFiling[],
  anchorDate: string,
  opts?: RankEarningsAdjacent8KOpts
): SecFiling[] {
  const win = buildEarningsAdjacent8KWindow(filings, anchorDate, opts);
  if (!win) return [];
  return sortEarningsAdjacent8KCandidates(win.candidates, win.baseMs, win.anchorIsPeriodEnd);
}

/**
 * Like {@link rankEarningsAdjacent8KFilings}, but fetches each candidate&apos;s **primary** 8-K HTML and detects **Item 2.02**
 * so earnings filings rank above generic current reports when submissions metadata is sparse.
 */
export async function rankEarningsAdjacent8KFilingsWithPrimaryItemScan(
  issuerCik: string,
  filings: SecFiling[],
  anchorDate: string,
  opts?: RankEarningsAdjacent8KOpts & { paceMs?: number }
): Promise<RankEarningsAdjacent8KPrimaryScanResult> {
  const win = buildEarningsAdjacent8KWindow(filings, anchorDate, opts);
  const empty: RankEarningsAdjacent8KPrimaryScanResult = {
    ranked: [],
    primaryHtmlByAccessionKey: new Map(),
    item202ByAccessionKey: new Map(),
  };
  if (!win || win.candidates.length === 0) return empty;

  const paceMs =
    typeof opts?.paceMs === "number" && Number.isFinite(opts.paceMs) && opts.paceMs > 0 ? opts.paceMs : 0;
  const item202FromPrimary = new Map<string, boolean>();
  const primaryHtmlByAccessionKey = new Map<string, string | null>();

  for (const f of win.candidates) {
    if (paceMs > 0) await sleep(paceMs);
    const html = await fetchEdgarPrimaryDocumentHtml(issuerCik, f);
    const k = secAccessionDedupeKey(f.accessionNumber);
    if (!k) continue;
    primaryHtmlByAccessionKey.set(k, html);
    item202FromPrimary.set(k, html ? detectItem202In8KPrimaryHtml(html) : false);
  }

  const ranked = sortEarningsAdjacent8KCandidates(
    win.candidates,
    win.baseMs,
    win.anchorIsPeriodEnd,
    item202FromPrimary
  );
  return { ranked, primaryHtmlByAccessionKey, item202ByAccessionKey: item202FromPrimary };
}

/** Display name + tickers from submissions JSON (minimal parse). */
export async function getCompanyMetadataByCik(cik: string): Promise<{ name: string; tickers: string[] } | null> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, secRemoteFetchInit());
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
let companyTickersCachePromise: Promise<TickerJsonEntry[] | null> | null = null;
const COMPANY_TICKERS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * SEC company_tickers.json (~10k issuers), cached in memory to avoid one fetch per name search.
 */
export async function getCompanyTickersEntriesCached(): Promise<TickerJsonEntry[] | null> {
  const now = Date.now();
  if (companyTickersCache && now - companyTickersCache.fetchedAt < COMPANY_TICKERS_CACHE_TTL_MS) {
    return companyTickersCache.entries;
  }
  if (companyTickersCachePromise) return companyTickersCachePromise;

  companyTickersCachePromise = (async () => {
    try {
      const url = "https://www.sec.gov/files/company_tickers.json";
      const res = await fetch(url, secRemoteFetchInit());
      if (!res.ok) return null;
      const raw = (await res.json()) as CompanyTickersJson | TickerJsonEntry[];
      const entries = listCompanyTickersEntries(raw);
      companyTickersCache = { entries, fetchedAt: Date.now() };
      return entries;
    } catch {
      return null;
    } finally {
      companyTickersCachePromise = null;
    }
  })();

  return companyTickersCachePromise;
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

/** Parsed from SEC submissions `addresses.business` — reliable HQ vs 10-K HTML scraping. */
export type SecPrincipalBusinessAddress = {
  /** Multi-line block for profile textarea */
  formatted: string;
  city: string | null;
  /** USPS-style state when `stateOrCountry` is a 2-letter US code */
  state: string | null;
  /** 5-digit USPS ZIP from submissions ZIP field */
  zip: string | null;
};

function zipFiveDigits(raw: string | undefined | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 5 ? d.slice(0, 5) : null;
}

/**
 * Prefer business office; falls back to mailing when business is absent (still SEC-provided).
 */
export function extractPrincipalBusinessAddressFromSubmissions(data: SubmissionsJson): SecPrincipalBusinessAddress | null {
  const b = data.addresses?.business ?? data.addresses?.mailing;
  if (!b) return null;
  const street1 = typeof b.street1 === "string" ? b.street1.replace(/\s+/g, " ").trim() : "";
  const street2 = typeof b.street2 === "string" ? b.street2.replace(/\s+/g, " ").trim() : "";
  const city = typeof b.city === "string" ? b.city.replace(/\s+/g, " ").trim() : "";
  const stateRaw = typeof b.stateOrCountry === "string" ? b.stateOrCountry.trim() : "";
  const zipRaw = typeof b.zip === "string" ? b.zip.trim() : "";

  const zip = zipFiveDigits(zipRaw);
  let state: string | null = null;
  if (/^[A-Za-z]{2}$/.test(stateRaw)) state = stateRaw.toUpperCase();

  const lines: string[] = [];
  if (street1) lines.push(street1);
  if (street2) lines.push(street2);
  let cityLine = "";
  if (city && state && zip) cityLine = `${city}, ${state} ${zip}`;
  else if (city && state) cityLine = `${city}, ${state}`;
  else if (city || state || zipRaw) cityLine = [city, state, zipRaw].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);

  const formatted = lines.join("\n").trim();
  if (formatted.length < 8) return null;
  return {
    formatted,
    city: city || null,
    state,
    zip,
  };
}

async function fetchSubmissionsJsonForTicker(ticker: string): Promise<{ paddedCik: string; data: SubmissionsJson } | null> {
  const cik = await getCikFromTicker(ticker);
  if (!cik) return null;
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const res = await fetch(url, secRemoteFetchInit());
  if (!res.ok) return null;
  const data = (await res.json()) as SubmissionsJson;
  return { paddedCik: padded, data };
}

function buildSecCompanyProfile(data: SubmissionsJson, ticker: string, paddedCik: string): SecCompanyProfile {
  const recent = data.filings?.recent;
  const filingsCount = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber.length : 0;
  const fy = data.fiscalYearEnd?.replace(/-/g, "").trim();
  const fiscalYearEnd = fy && fy.length >= 4 ? `${fy.slice(0, 2)}/${fy.slice(2)}` : "—";
  const formerNames = parseFormerNamesFromSubmissions(data.formerNames);
  return {
    name: data.name ?? ticker,
    ticker: ticker.trim().toUpperCase(),
    cik: paddedCik,
    sic: data.sic ?? "—",
    sicDescription: data.sicDescription ?? "—",
    stateOfIncorporation: data.stateOfIncorporation ?? "—",
    fiscalYearEnd,
    filingsCount,
    formerNames,
  };
}

/**
 * Single submissions fetch — profile plus structured principal business address for HQ geography.
 */
export async function getCompanyProfileAndPrincipalBusinessAddress(
  ticker: string
): Promise<{ profile: SecCompanyProfile; principalBusiness: SecPrincipalBusinessAddress | null } | null> {
  const hit = await fetchSubmissionsJsonForTicker(ticker);
  if (!hit) return null;
  const profile = buildSecCompanyProfile(hit.data, ticker, hit.paddedCik);
  const principalBusiness = extractPrincipalBusinessAddressFromSubmissions(hit.data);
  return { profile, principalBusiness };
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
  const hit = await fetchSubmissionsJsonForTicker(ticker);
  if (!hit) return null;
  return buildSecCompanyProfile(hit.data, ticker, hit.paddedCik);
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
