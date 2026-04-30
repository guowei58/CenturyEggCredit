/**
 * Locate Exhibit 21 (subsidiaries) in an SEC filing folder via index.json.
 * The primary 10-K HTML usually does not include Exhibit 21; it is a separate file.
 * Fallback: parse hyperlinks from the primary filing HTML (many filers only link to Ex. 21).
 *
 * Resolution rejects candidates whose body lacks an Exhibit 21 label (EX-21, Exhibit No. 21, etc.),
 * then walks older plain Form 10-K / Form 20-F filings until a subsidiary schedule passes validation.
 */

import type { SecFiling } from "@/lib/sec-edgar";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";
import { extractExhibit21CandidateUrlsFromPrimaryHtml } from "@/lib/sec-primary-doc-exhibit-links";
import { isPlainForm10K, isPlainForm20F } from "@/lib/secAnnualReportForms";

type IndexItem = { name?: string; type?: string; size?: string };

/**
 * True when fetched body text visibly identifies the document as Exhibit 21 — not inferred from filenames only.
 * Matches headings like Exhibit 21, Exhibit No. 21, EX-21, EX–21.1, EX.21 (index/Toc style).
 */
export function bodyContainsExhibit21Marker(raw: string): boolean {
  if (!raw || raw.length < 5) return false;
  const sample = raw.length <= 980_000 ? raw : `${raw.slice(0, 780_000)}\n${raw.slice(-200_000)}`;
  const patterns: RegExp[] = [
    /\bEX\s*-\s*21(?:[\s./_-]\w+|[\s.]*\(|\b)/i,
    /\bEX[-–—_]21(?:[\s./_-]\w+|[\s.]*\(|\b)(?!\d)/i,
    /\bEX21\b(?!\d)/i,
    /\bEX\.\s*21\b/i,
    /\bexhibit\s*-?\s*no\.?\s*21\b/i,
    /\bexhibit\s+21\b/i,
    /\([^)]*\bEX\s*[-–—_]?\s*21\b[^)]*\)/i,
  ];
  return patterns.some((re) => re.test(sample));
}

function normalizeIndexItems(data: unknown): IndexItem[] {
  if (!data || typeof data !== "object") return [];
  const dir = (data as Record<string, unknown>).directory;
  if (!dir || typeof dir !== "object") return [];
  const item = (dir as Record<string, unknown>).item;
  if (Array.isArray(item)) return item.filter((x) => x && typeof x === "object") as IndexItem[];
  if (item && typeof item === "object") return [item as IndexItem];
  return [];
}

/** Positive signals for Exhibit 21 attachment; avoids matching exhibit321 (Exhibit 3.21). */
function exhibit21FilenameScore(name: string): number {
  const l = name.toLowerCase();
  if (/index-|xslF|\.xsl$/i.test(l)) return 0;

  let score = 0;
  const isViewable = /\.(htm|html|txt|pdf)$/i.test(l);
  if (!isViewable) return 0;

  /** Strong: literal ex21 segment (not ex210). */
  if (/(?:^|[^a-z0-9])ex21(?:[^0-9a-z]|\.(htm|html|txt|pdf)$)/i.test(name)) score += 120;
  /** Exhibit 21 spelled out */
  if (/exhibit(?:[^a-z0-9]+)?21(?:\D|\.(htm|html|pdf))/i.test(name)) score += 100;
  /** Penalize other exhibit numbers that mention subsidiaries */
  const exNum = /exhibit[^a-z0-9]*(\d{1,2})\b/i.exec(l);
  if (exNum && exNum[1] !== "21" && !/exhibit[^a-z0-9]*21/i.test(l)) {
    score = Math.min(score, 35);
  }
  if (/\bsubsidiar/i.test(l)) score += 50;
  return score;
}

function rankExhibit21IndexFilenames(filenames: string[]): string[] {
  return filenames
    .map((name) => ({ name, score: exhibit21FilenameScore(name) }))
    .filter((x) => x.score >= 50)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((x) => x.name);
}

/**
 * Heuristic: reject proxy/compensation HTML masquerading as subsidiary lists; require entity-like rows.
 */
export function bodyLooksLikeSubsidiarySchedule(raw: string): boolean {
  const sample = raw.slice(0, 220_000);
  const lower = sample.toLowerCase();
  if (sample.length < 350) return false;

  const proxyHeavy =
    /\bsummary\s+compensation\s+table\b/i.test(sample) ||
    /\bgrants?\s+of\s+plan[-\s]*based\s+awards\b/i.test(sample) ||
    /\bnon-?qualified\s+deferred\s+compensation\b/i.test(sample);

  const hasScheduleSignal =
    /\bsubsidiaries\s+of\s+the\s+registrant\b/.test(lower) ||
    /\blist\s+of\s+subsidiaries\b/.test(lower) ||
    /\bexhibit\s*21\b/.test(lower) ||
    /\bsubsidiary\b.*\bjurisdiction\b/.test(lower) ||
    /\bname\s+of\s+subsidiary\b/.test(lower) ||
    /\bstate\s+or\s+other\s+jurisdiction\s+of\s+incorporation\b/.test(lower);

  const entityTail =
    /\b(?:Inc\.?|LLC|L\.L\.C\.|Corp\.?|Ltd\.?|Limited|L\.P\.|LP|N\.A\.|PLC|GmbH|S\.A\.|B\.V\.|N\.V\.|A\/S|AG)\b/gi;
  const entityHits = sample.match(entityTail)?.length ?? 0;

  if (proxyHeavy && !hasScheduleSignal && entityHits < 6) return false;
  if (hasScheduleSignal && entityHits >= 2) return true;
  if (entityHits >= 10) return true;
  if (hasScheduleSignal && entityHits >= 1) return true;
  return false;
}

async function fetchBodySample(url: string, maxBytes = 240_000): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch {
    return null;
  }
}

async function urlPassesExhibit21Validation(url: string): Promise<boolean> {
  const isPdf = /\.pdf$/i.test(url);
  const pdfNameLikely =
    /(?:^|[^a-z0-9])ex21(?:[^0-9a-z]|\.pdf)/i.test(url) || /exhibit[^a-z0-9]*21/i.test(url);

  if (isPdf) {
    if (!pdfNameLikely) return false;
    const body = await fetchBodySample(url, 840_000);
    if (!body?.startsWith("%PDF")) return false;
    return bodyContainsExhibit21Marker(body);
  }

  const body = await fetchBodySample(url);
  if (!body) return false;
  if (!bodyContainsExhibit21Marker(body)) return false;
  return bodyLooksLikeSubsidiarySchedule(body);
}

async function buildIndexCandidateUrls(cikPadded: string, accessionNumber: string): Promise<string[]> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return [];
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return [];

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/index.json`;
  let res: Response;
  try {
    res = await fetch(indexUrl, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const items = normalizeIndexItems(data);
  const names = items.map((i) => (i.name ?? "").trim()).filter(Boolean);
  const ranked = rankExhibit21IndexFilenames(names);
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/`;
  return ranked.map((n) => `${base}${n}`);
}

async function buildPrimaryCandidateUrls(primaryDocumentUrl: string): Promise<string[]> {
  const trimmed = primaryDocumentUrl.trim();
  if (!trimmed) return [];
  let res: Response;
  try {
    res = await fetch(trimmed, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const html = await res.text();
  return extractExhibit21CandidateUrlsFromPrimaryHtml(html, trimmed);
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const k = u.replace(/\?.*$/, "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/**
 * Try index.json filenames + primary-doc anchor targets in priority order; return first URL whose body validates.
 */
async function resolveValidatedExhibit21ForSingleFiling(
  cikPadded: string,
  accessionNumber: string,
  primaryDocumentUrl?: string | null
): Promise<string | null> {
  const indexUrls = await buildIndexCandidateUrls(cikPadded, accessionNumber);
  const primaryUrls = await buildPrimaryCandidateUrls(primaryDocumentUrl ?? "");
  const merged = dedupeUrls([...indexUrls, ...primaryUrls]);

  for (const url of merged) {
    if (await urlPassesExhibit21Validation(url)) return url;
  }
  return null;
}

function isPlainAnnualNonAmendment(f: SecFiling): boolean {
  return isPlainForm10K(f.form) || isPlainForm20F(f.form);
}

export type Exhibit21Resolution = {
  exhibit21Url: string | null;
  /** Filing whose accession produced the resolved Exhibit 21 (may be older than “latest” annual). */
  sourceFiling: SecFiling | null;
};

/**
 * Walk plain Form 10-K / Form 20-F filings (newest first) until Exhibit 21 validates.
 */
export async function resolveExhibit21AcrossAnnualFilings(
  cikPadded: string,
  filings: SecFiling[],
  maxFilings = 14
): Promise<Exhibit21Resolution> {
  const annual = filings
    .filter((f) => typeof f.form === "string" && isPlainAnnualNonAmendment(f))
    .sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));

  let n = 0;
  for (const filing of annual) {
    if (n >= maxFilings) break;
    n += 1;
    const url = await resolveValidatedExhibit21ForSingleFiling(cikPadded, filing.accessionNumber, filing.docUrl);
    if (url) return { exhibit21Url: url, sourceFiling: filing };
  }

  return { exhibit21Url: null, sourceFiling: null };
}

/**
 * URL to Exhibit 21 for one filing only (validated). Prefer {@link resolveExhibit21AcrossAnnualFilings} for ingest UX.
 */
export async function resolveExhibit21DocumentUrl(
  cikPadded: string,
  accessionNumber: string,
  primaryDocumentUrl?: string | null
): Promise<string | null> {
  return resolveValidatedExhibit21ForSingleFiling(cikPadded, accessionNumber, primaryDocumentUrl);
}
