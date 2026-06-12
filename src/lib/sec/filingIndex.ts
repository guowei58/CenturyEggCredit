/**
 * List files in an SEC filing folder via Archives `index.json`, falling back to the legacy SEC “filing detail”
 * `{accession}-index.htm` page when JSON is missing or empty.
 *
 * For Exhibit 99 HTML, prefer **`{accession}.txt`** submission parsing: each `<DOCUMENT>` block lists `<TYPE>` (e.g.
 * `EX-99.1`) and `<FILENAME>` — stronger than basename heuristics when the 8-K body has no exhibit hyperlinks.
 */

import { detectItem202In8KPrimaryHtml, edgarArchivesFolderCikCandidates, getSecEdgarUserAgent } from "@/lib/sec-edgar";

export type SecFilingIndexItem = { name: string; type?: string; size?: string };

function normalizeIndexItems(data: unknown): SecFilingIndexItem[] {
  if (!data || typeof data !== "object") return [];
  const dir = (data as Record<string, unknown>).directory;
  if (!dir || typeof dir !== "object") return [];
  const item = (dir as Record<string, unknown>).item;
  if (Array.isArray(item)) return item.filter((x) => x && typeof x === "object") as SecFilingIndexItem[];
  if (item && typeof item === "object") return [item as SecFilingIndexItem];
  return [];
}

/** `000114420415004623` → `0001144204-15-004623` for `{accession}-index.htm` basenames. */
export function accessionForIndexHtmlBasename(accessionNumber: string): string {
  const nd = accessionNumber.replace(/-/g, "").trim();
  if (nd.length === 18 && /^\d{18}$/.test(nd)) {
    return `${nd.slice(0, 10)}-${nd.slice(10, 12)}-${nd.slice(12)}`;
  }
  return accessionNumber.trim();
}

/**
 * Parse “Filing Detail” HTML (`*-index.htm`) for attachment names in this accession folder.
 * Exported for unit tests.
 */
export function parseFilingDetailIndexHtmlAttachments(html: string, cikNum: number, accNoDashes: string): string[] {
  const prefix = `/Archives/edgar/data/${cikNum}/${accNoDashes}/`;
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`href="${esc}([^"]+)"`, "gi");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = (m[1] ?? "").trim();
    if (name && !name.includes("/") && !name.includes("?")) out.add(name);
  }
  return [...out];
}

async function fetchFilingIndexItemsFromLegacyIndexHtml(
  cikNum: number,
  accessionNumber: string
): Promise<SecFilingIndexItem[]> {
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return [];
  const base = accessionForIndexHtmlBasename(accessionNumber);
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${base}-index.htm`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() }, cache: "no-store" });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let html: string;
  try {
    html = await res.text();
  } catch {
    return [];
  }
  if (!html || html.length < 200) return [];
  const names = parseFilingDetailIndexHtmlAttachments(html, cikNum, accNoDashes);
  return names.map((name) => ({ name }));
}

async function fetchFilingIndexItemsSingleCik(cikPadded: string, accessionNumber: string): Promise<SecFilingIndexItem[]> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return [];
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return [];

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/index.json`;
  let res: Response;
  try {
    res = await fetch(indexUrl, { headers: { "User-Agent": getSecEdgarUserAgent() }, cache: "no-store" });
  } catch {
    return fetchFilingIndexItemsFromLegacyIndexHtml(cikNum, accessionNumber);
  }
  if (!res.ok) {
    return fetchFilingIndexItemsFromLegacyIndexHtml(cikNum, accessionNumber);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return fetchFilingIndexItemsFromLegacyIndexHtml(cikNum, accessionNumber);
  }
  const items = normalizeIndexItems(data)
    .map((i) => ({ ...i, name: (i.name ?? "").trim() }))
    .filter((i) => i.name.length > 0);
  if (items.length > 0) return items;
  return fetchFilingIndexItemsFromLegacyIndexHtml(cikNum, accessionNumber);
}

export async function fetchFilingIndexItems(issuerCikPadded: string, accessionNumber: string): Promise<SecFilingIndexItem[]> {
  for (const cikPad of edgarArchivesFolderCikCandidates(issuerCikPadded, accessionNumber)) {
    const items = await fetchFilingIndexItemsSingleCik(cikPad, accessionNumber);
    if (items.length > 0) return items;
  }
  return [];
}

export function buildArchivesFileUrl(cikNum: number, accessionDashed: string, filename: string): string {
  const accNoDashes = accessionDashed.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${filename}`;
}

const MAX_SUBMISSION_TXT_BYTES = 12 * 1024 * 1024;

/**
 * Full EDGAR submission text (`{accession}.txt`). Used to resolve `EX-99.x` HTML paths from `<TYPE>` / `<FILENAME>`.
 */
async function fetchAccessionSubmissionTxtSingleCik(cikPadded: string, accessionNumber: string): Promise<string | null> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return null;
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return null;
  const basename = accessionForIndexHtmlBasename(accessionNumber);
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${basename}.txt`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() }, cache: "no-store" });
    if (!res.ok) return null;
    const cl = res.headers.get("content-length");
    if (cl != null) {
      const n = parseInt(cl, 10);
      if (Number.isFinite(n) && n > MAX_SUBMISSION_TXT_BYTES) return null;
    }
    const text = await res.text();
    if (text.length > MAX_SUBMISSION_TXT_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

export async function fetchAccessionSubmissionTxt(issuerCikPadded: string, accessionNumber: string): Promise<string | null> {
  for (const cikPad of edgarArchivesFolderCikCandidates(issuerCikPadded, accessionNumber)) {
    const txt = await fetchAccessionSubmissionTxtSingleCik(cikPad, accessionNumber);
    if (txt) return txt;
  }
  return null;
}

/** True for submission `<TYPE>` values that denote Exhibit 99.x body / press release documents. */
export function submissionDocumentTypeIsExhibit99(typeRaw: string): boolean {
  const t = typeRaw.replace(/\s+/g, " ").trim().toUpperCase();
  if (!t) return false;
  if (t.startsWith("EX-99")) return true;
  if (/^EXHIBIT\s*99\b/.test(t)) return true;
  if (/^EX\s+99(?:\.\d+)?\b/.test(t)) return true;
  return false;
}

/**
 * Ordered `.htm` / `.html` filenames for `EX-99` blocks in the submission `.txt` (document order).
 * Exported for unit tests.
 */
export function parseExhibit99HtmlFilenamesFromSubmissionTxt(content: string): string[] {
  if (!content || content.length < 50) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const parts = content.split(/<DOCUMENT>\s*/i);
  for (const part of parts) {
    const typeM = part.match(/^\s*<TYPE>\s*([^\n\r<]+)/im);
    const fnM = part.match(/<FILENAME>\s*([^\n\r<]+)/im);
    if (!typeM || !fnM) continue;
    const type = (typeM[1] ?? "").trim();
    const fn = (fnM[1] ?? "").trim();
    if (!fn || !/\.(htm|html)$/i.test(fn)) continue;
    if (!submissionDocumentTypeIsExhibit99(type)) continue;
    const low = fn.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(fn);
  }
  return out;
}

function canonicalizeFilenamesAgainstIndex(preferred: string[], indexFilenames: string[]): string[] {
  const byLower = new Map<string, string>();
  for (const raw of indexFilenames) {
    const n = raw.trim();
    if (!n) continue;
    const low = n.toLowerCase();
    if (!byLower.has(low)) byLower.set(low, n);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pref of preferred) {
    const canon = byLower.get(pref.trim().toLowerCase());
    if (!canon) continue;
    const low = canon.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(canon);
  }
  return out;
}

/** Score HTML attachments that look like Exhibit 99.x (earnings / press release). Exported for tests. */
export function scoreExhibit99HtmlFilename(name: string): number {
  const raw = (name ?? "").trim();
  if (!raw || !/\.(htm|html)$/i.test(raw)) return 0;
  const l = raw.toLowerCase();
  if (/^index\.(htm|html)$/i.test(l)) return 0;
  if (/\.xsl$/i.test(l) || /xslF\d/i.test(l)) return 0;
  if (/\.(xml|json|png|gif|jpg|jpeg|pdf|zip|txt)$/i.test(l)) return 0;

  let s = 0;
  if (/\bex-99(?:\.\d+)?\b/i.test(l)) s += 100;
  if (/\bexhibit\s*99(?:\.\d+)?\b/i.test(l)) s += 98;
  /** `exhibit991press.htm`, `exhibit991erq22024.htm` (no space/dot before the trailing digit — common Workiva output). */
  if (/^exhibit99\d/i.test(l)) s += 94;
  if (/exhibit99\d{0,2}\.(?:htm|html)\b/i.test(l)) s += 90;
  if (/\bexhibit99[-_.]/i.test(l)) s += 86;
  /**
   * `ctl20178-kexhibit9913q.htm`, `exhibit9913q.htm` — letter or prefix glued before `exhibit` breaks `\bexhibit99…`;
   * exhibit number + optional letter suffix before extension (common CenturyLink / Lumen / legacy CTL filings).
   */
  if (/exhibit99\d+[a-z0-9]*\.(htm|html)$/i.test(l)) s += 92;
  if (/\bex99-\d+/i.test(l)) s += 96;
  if (/\bex99\d{1,2}(?![0-9])/i.test(l)) s += 94;
  if (/\bex(?:hibit)?[-_.\s]99(?:[._-]\d+)?\b/i.test(l)) s += 88;
  if (/\bex99[-_.]/i.test(l)) s += 82;
  if (/\bex99\.(?:htm|html)\b/i.test(l)) s += 78;
  /**
   * `ex99` + digits at end (e.g. `d881734dex991.htm`) — filing-agent names often glue `dex991` so `\bex99` never matches.
   */
  if (/ex99\d+\.(?:htm|html)$/i.test(l)) s += 90;
  /**
   * Short `exh99.htm`, `exh99-1.htm`, `exh991.htm` — “exhibit” abbreviated `exh` (common in older EDGAR folders; mirrors `ex99…`).
   */
  if (/^exh99(?:[-_]\d+)?\.(?:htm|html)$/i.test(l)) s += 90;
  if (/exh99\d+\.(?:htm|html)$/i.test(l)) s += 90;
  /**
   * `…_ex99-1.htm`, `…ex99_1.htm` — underscore before `ex` breaks `\bex99`; hyphen/underscore before the exhibit sub-number is common.
   */
  if (/ex99[-_]\d+(?:\.\d+)?\.(?:htm|html)$/i.test(l)) s += 92;
  if (/[-_.]99[-_.][a-z0-9].*\.(htm|html)$/i.test(l)) s += 52;
  if ((/press|earnings|release|results/i.test(l) && /\b99\b/.test(l)) || /earningsrelease/i.test(l)) s += 28;
  /** Issuer-named earnings/press HTML next to the 8-K (not always `ex99…`); e.g. `ctl-…-earningsreleasex.htm` sibling files. */
  if (/earnings/i.test(l) && /release/i.test(l)) s += 60;
  if (/press/i.test(l) && /release/i.test(l)) s += 55;
  /** Older filings: `pressrls.htm`, `pressrel.htm` (“press release” abbreviated; no separate “release” substring). */
  if (/pressr(?:els?|ls)\./i.test(l)) s += 54;
  /**
   * Stub earnings/press HTML (`er.htm`) — extremely short legacy names in some 8-K folders; keep below typical `ex99` scores.
   */
  if (/^er\.(?:htm|html)$/i.test(l)) s += 48;
  /** `earnings4thqtr.htm`, `earnings1qtr08.htm` — `qtr` often glued to digits so `\bqtr\b` would miss. */
  if (/\bearnings/i.test(l) && /qtr/i.test(l)) s += 58;
  /** `q3_fy26quarterlyearnings.htm` and similar issuer-named quarterly earnings HTML. */
  if (/quarterlyearnings|quarterly_earnings/i.test(l.replace(/[_\s-]/g, ""))) s += 62;
  if (/q[1-4].*earnings|earnings.*q[1-4]/i.test(l)) s += 56;
  /**
   * Workiva / issuer-styled EX-99.1 HTML with **no** `exhibit` / `ex99` substring — e.g. `rexrex991q1-2026.htm`,
   * `issuer992q3-2025.htm` (`99` + exhibit number + fiscal quarter). Without this, {@link rankExhibit99HtmlFilenames}
   * can return **no** HTML when `{accession}.txt` is missing and the app opens only the Form 8-K cover.
   */
  if (/99[1-9]\d*q[1-4]/i.test(l)) s += 88;
  return s;
}

/**
 * True when HTML looks like the short **Form 8-K cover / item index** page (not the Exhibit 99 press body).
 * Used to skip the primary doc when it is technically the “earnings” filename but renders the SEC shell only.
 */
/**
 * True when the Form 8-K **primary** HTML only indexes / links to a separate Exhibit 99 earnings attachment
 * (common Workiva iXBRL: Item 2.02 prose + exhibit table with `href="…quarterlyearnings.htm"`).
 * The primary must not be shown as the press-release body when a ranked Exhibit 99 HTML exists.
 */
export function html8KPrimaryDefersEarningsToExhibitAttachment(html: string): boolean {
  if (!html || html.length < 400) return false;
  const chunk = html.slice(0, 140_000);
  if (
    /-sec-extract:\s*exhibit/i.test(chunk) &&
    /<a\b[^>]*href\s*=\s*["'][^"']+\.(?:htm|html)["']/i.test(chunk)
  ) {
    return true;
  }
  let t = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/&#160;|&nbsp;|&#xA0;/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (/\bfurnished\s+as\s+exhibit\s+99(?:\.\d+)?\b/i.test(t)) return true;
  if (/\bfull\s+text\s+of\s+the\s+earnings\b/i.test(t) && /\bexhibit\s+99(?:\.\d+)?\b/i.test(t)) return true;
  return false;
}

export function looksLike8kFormCoverShellHtml(html: string): boolean {
  if (!html || html.length < 400 || html.length > 85_000) return false;
  if (detectItem202In8KPrimaryHtml(html)) return false;

  let t = html
    .slice(0, 120_000)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/&#160;|&nbsp;|&#xA0;/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  const u = t.toUpperCase();
  const hasForm8k = /\bFORM\s+8-K\b/i.test(u);
  const hasCurrentReport = /\bCURRENT REPORT\b/i.test(u);
  const hasSec = /SECURITIES AND EXCHANGE COMMISSION/i.test(u);
  return hasForm8k && hasCurrentReport && hasSec;
}

/**
 * Exhibit 99 **press** HTML that is clearly a management / officer announcement (Item 5.02-style), not results / earnings.
 * Used to skip false positives when submission metadata is wrong. Conservative: requires personnel cues and
 * absence of common earnings / quarterly results language in the visible lead.
 */
export function htmlLooksLikePersonnelOnlyPressNotEarningsResults(html: string): boolean {
  if (!html || html.length < 80) return false;
  const chunk = html.slice(0, 60_000);
  let t = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/&#160;|&nbsp;|&#xA0;/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\s+/g, " ").trim().slice(0, 10_000);
  const low = t.toLowerCase();
  const earnings = /\b(earnings|financial results|quarterly results|results for the (?:first|second|third|fourth)|\bq[1-4]\b.{0,30}20\d{2}|fiscal 20\d{2}|diluted (?:eps|earnings per share)|net income|revenue of \$\d|conference call|non-gaap|adjusted ebitda|results of operations|operating metrics|same-?station|comparable period)\b/i.test(
    low
  );
  if (earnings) return false;
  const personnel =
    /\b(?:named|appointed|promoted|elected)\b.{0,140}\b(?:chief|president|officer|ceo|coo|cfo|evp|senior vice president|executive vice president|managing vice president)\b/i.test(
      low
    ) ||
    /\b(?:chief|executive|financial|operating) officer\b.{0,100}\b(?:named|appointed|promoted|succeeds|successor)\b/i.test(
      low
    ) ||
    /\bdeparture\b.{0,80}\b(?:director|officer|ceo|cfo|president)\b/i.test(low);
  return personnel;
}

export type RankExhibit99HtmlFilenamesOpts = {
  excludeLowercase?: Set<string>;
  /**
   * When set, **other** HTML attachments in the tier are ordered **before** this name so Exhibit 99 bodies
   * win over a primary doc that is only the Form 8-K wrapper (still scored and kept as fallback).
   */
  primaryDocumentForOrdering?: string;
  /**
   * HTML basenames from `{accession}.txt` (`EX-99.x` `<TYPE>` rows), in filing order. Intersected with
   * `filenames` (case-insensitive); listed **before** basename-heuristic ordering for a stronger Exhibit 99 match.
   */
  submissionTxtExhibit99Ordered?: string[];
};

/**
 * Prefer Exhibit 99.1-style press release HTML in an 8-K folder (`index.json` names).
 * Optionally exclude filenames already tried (e.g. the filing primary document).
 */
export function rankExhibit99HtmlFilenames(filenames: string[], opts?: RankExhibit99HtmlFilenamesOpts): string[] {
  const ex = opts?.excludeLowercase;
  const uniq = [...new Set(filenames.map((x) => x.trim()).filter(Boolean))];
  const scored = uniq
    .filter((n) => !ex || !ex.has(n.toLowerCase()))
    .map((name) => ({ name, score: scoreExhibit99HtmlFilename(name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  /**
   * Use every name at or above the “mid-confidence” floor (not only tier-1 when tier-1 is non-empty).
   * Otherwise the **primary** can hit tier-1 on a generic `earningsrelease.htm` (short 8-K) while a larger sibling
   * is only tier-2 (`press…release…`, typos like `presssrelease.htm`) — and we would never try the real PR.
   */
  const MIN_RANK_SCORE = 42;
  const pick = scored.filter((x) => x.score >= MIN_RANK_SCORE);
  const prim = (opts?.primaryDocumentForOrdering ?? "").trim().toLowerCase();
  const heuristicOrdered = (() => {
    if (!prim) return pick.map((x) => x.name);
    const nonPrimary = pick.filter((x) => x.name.toLowerCase() !== prim);
    const primaryHits = pick.filter((x) => x.name.toLowerCase() === prim);
    return [...nonPrimary, ...primaryHits].map((x) => x.name);
  })();

  const txtPref = opts?.submissionTxtExhibit99Ordered;
  if (!txtPref || txtPref.length === 0) return heuristicOrdered;

  const canonicalFromTxt = canonicalizeFilenamesAgainstIndex(txtPref, uniq).filter(
    (n) => !ex || !ex.has(n.toLowerCase())
  );
  if (canonicalFromTxt.length === 0) return heuristicOrdered;

  const seenTxt = new Set(canonicalFromTxt.map((n) => n.toLowerCase()));
  const rest = heuristicOrdered.filter((n) => !seenTxt.has(n.toLowerCase()));
  return [...canonicalFromTxt, ...rest];
}

async function fetchArchivesFilingFileHtmlSingleCik(
  cikPadded: string,
  accessionNumber: string,
  filename: string
): Promise<string | null> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return null;
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return null;
  const fn = filename.trim();
  if (!fn) return null;

  const url = buildArchivesFileUrl(cikNum, accessionNumber, fn);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "text/html,*/*" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html && html.length >= 500 ? html : null;
  } catch {
    return null;
  }
}

/** Fetch one file from an EDGAR filing folder (tries submissions CIK, then accession-prefix folder when they differ). */
export async function fetchArchivesFilingFileHtml(
  issuerCikPadded: string,
  accessionNumber: string,
  filename: string
): Promise<string | null> {
  for (const cikPad of edgarArchivesFolderCikCandidates(issuerCikPadded, accessionNumber)) {
    const html = await fetchArchivesFilingFileHtmlSingleCik(cikPad, accessionNumber, filename);
    if (html) return html;
  }
  return null;
}
