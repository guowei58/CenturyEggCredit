/**
 * Best-effort public-records profile hints from SEC submissions + latest 10-K HTML.
 * Does not replace manual diligence — borrowers/guarantors usually need credit documents.
 */

import { getSubsidiaryHintsForTicker } from "@/lib/subsidiary-hints";
import {
  deriveSubsidiarySearchNamesFromGrid,
  type Exhibit21GridSnapshotV1,
} from "@/lib/exhibit21GridSnapshot";
import { extractExhibit21GridSnapshotFromDocument } from "@/lib/exhibit21GridExtract";
import { pairedSubsidiariesFromLines } from "@/lib/exhibit21SubsidiaryRows";
import { getCompanyProfileAndPrincipalBusinessAddress, getAllFilingsByTicker, getSecEdgarUserAgent } from "@/lib/sec-edgar";
import { resolveLatest10KFilingWithMeta } from "@/lib/sec-10k";
import { resolveExhibit21AcrossAnnualFilings, resolveExhibit21DocumentUrl } from "@/lib/sec-filing-exhibits";
import {
  lookupCountyNameFromUsAddressLine,
  lookupCountyNameFromUsZip,
  lookupStateAbbrFromUsZip,
} from "@/lib/censusCountyFromAddress";

import type { PublicRecordsSecPrefill } from "@/lib/publicRecordsSecPrefillTypes";

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

/** "new jersey" -> "NJ" (same keys as US_STATE_NAMES). */
const STATE_FULL_NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAMES).map(([name, abbr]) => [name, abbr])
);

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(s: string): string {
  const decodeNumericEntity = (_full: string, codeStr: string): string => {
    const cs = String(codeStr);
    const cp = /^x/i.test(cs) ? parseInt(cs.slice(1), 16) : parseInt(cs.replace(/^0+(?=\d)/, "") || "0", 10);
    if (!Number.isFinite(cp) || cp === 160) return " ";
    if (cp === 8239 || cp === 8288) return ""; // NNBS / word joiner
    if (cp < 1 || cp > 0x10ffff) return _full;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return _full;
    }
  };
  return s
    .replace(/&#(?:0*160|[xX]0*[aA]0)\s*;?/gi, " ")
    .replace(/&#(x?[0-9a-f]{1,7});?/gi, decodeNumericEntity)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Minimal SEC HTML → text (aligned with sec-10k.ts). */
function stripSecFilingHtml(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(text));
}

function normalizeStateCode(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || t === "—" || t === "-") return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const full = US_STATE_NAMES[t.toLowerCase()];
  return full ?? null;
}

/** NBSP/narrow-space → space so dashed EIN survives SEC HTML quirks. */
function normalizeEinWhitespace(s: string): string {
  return s.replace(/[\u00a0\u2007\u2009\u202f\ufeff]/g, " ");
}

/** Stronger newline breaks for table/grid covers before tag strip (second pass if flat strip misses EIN). */
function filingHtmlToEinPlainBlob(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th|tr|table|div|p|li)\s*>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(normalizeEinWhitespace(decodeHtmlEntities(stripped)));
}

/** Parse `XX-XXXXXXX` after an IRS label segment (junk like `No.` or `:` may appear first). */
function parseEinFragmentsFromTail(tail: string): string | null {
  const tRaw = normalizeEinWhitespace(tail).slice(0, 280);
  const t = tRaw.replace(/^\D+/, "");
  if (!t) return null;

  const dashGap = /^(\d{2})[\-\u2010-\u2015\u2212\s/.,:#]+(\d{7})\b/;
  let m = t.match(dashGap) ?? t.match(/^(\d{2})\s+(\d{7})\b/);
  if (m?.[1] && m?.[2]) return `${m[1]}-${m[2]}`;

  const compact = t.replace(/\s+/g, "");
  m = compact.match(/^(\d{9})\b/);
  if (m?.[1]) {
    const d = m[1];
    return `${d.slice(0, 2)}-${d.slice(2)}`;
  }
  return null;
}

/** Inline XBRL/table covers often put “(I.R.S. Employer Identification …)” in one cell and EIN digits in another. */
function flattenIxHtmlSnippetToEinLine(htmlSlice: string): string {
  const noScript = htmlSlice
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const flattened = normalizeWhitespace(normalizeEinWhitespace(decodeHtmlEntities(noScript.replace(/<[^>]+>/g, " "))));
  return flattened.replace(/\s+/g, " ");
}

function firstEinHyphenCandidateInFlattened(ixPlain: string): string | null {
  const between = /[\s\-–—\u2010-\u2015\u2212\/.]{1,24}/;
  const hyphenish = new RegExp(`\\b(\\d{2})${between.source}(\\d{7})\\b`, "g");
  let mh: RegExpExecArray | null;
  while ((mh = hyphenish.exec(ixPlain)) !== null) {
    return `${mh[1]}-${mh[2]}`;
  }
  const compact = ixPlain.replace(/\s+/g, "");
  const nine = /\b(\d{9})\b/.exec(compact);
  if (nine?.[1]) {
    const d = nine[1];
    return `${d.slice(0, 2)}-${d.slice(2)}`;
  }
  const spaced = ixPlain.match(/\b(\d{2})\s+(\d{7})\b/);
  if (spaced?.[1] && spaced[2]) return `${spaced[1]}-${spaced[2]}`;
  return null;
}

/** ~first typeset page of body text; hyphenated EIN almost always appears in this prefix. */
const TEN_K_COVER_EIN_CHARS = 96_000;

function scoreHyphenEinCoverContext(ctx: string): number {
  let s = 0;
  if (/Employer\s+Identification/i.test(ctx)) s += 120;
  if (/\(\s*I\s*\.\s*R\s*\.\s*S/i.test(ctx) || /\bI\s*\.\s*R\s*\.\s*S\s*\.\s*Employer/i.test(ctx)) s += 95;
  if (/\bIRS\s+Employer\b/i.test(ctx) || /\bFederal\s+EIN\b/i.test(ctx) || /\bEIN\b/i.test(ctx)) s += 55;
  if (/\bTax\s+Identification/i.test(ctx)) s += 45;
  if (/\bCUSIP\b/i.test(ctx)) s -= 55;
  if (/\bCommission\s+File\s+Number\b/i.test(ctx)) s -= 35;
  return s;
}

/**
 * Hyphenated IRS EIN on the 10-K cover: `XX-XXXXXXX` (ASCII or common Unicode dashes).
 * Prefers matches near Employer / I.R.S. wording when several dashed digit groups exist.
 */
function extractEinByHyphenFormatOnTenKCover(condensedOneLine: string): string | null {
  const page = condensedOneLine.slice(0, TEN_K_COVER_EIN_CHARS);
  const re = /\b(\d{2})\s*[\-–—\u2010-\u2015\u2212]\s*(\d{7})\b/g;
  type Hit = { i: number; ein: string; score: number };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(page)) !== null) {
    const ein = `${m[1]}-${m[2]}`;
    const i = m.index;
    const lo = Math.max(0, i - 320);
    const hi = Math.min(page.length, i + m[0].length + 160);
    const score = scoreHyphenEinCoverContext(page.slice(lo, hi));
    hits.push({ i, ein, score });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0].ein;

  const byIndex = [...hits].sort((a, b) => a.i - b.i);
  const byScore = [...hits].sort((a, b) => b.score - a.score || a.i - b.i);
  if (byScore[0].score >= 28) return byScore[0].ein;
  return byIndex[0].ein;
}

function uniqueCoverScanKey(oneLine: string): string {
  return oneLine.slice(0, 72_000);
}

/** Raw HTML/XBRL when labels and digits are split across markup (common on modern EDGAR 10-K covers). */
function extractEmployerIdentificationNumberFromIxHtml(rawHtml: string): string | null {
  const head = rawHtml.slice(0, Math.min(rawHtml.length, 1_250_000));
  const anchors: RegExp[] = [
    /\(\s*I\s*\.\s*R\s*\.\s*S\s*\.\s*Employer\s+Identification(?:\s+No\.?)?\s*\)/gi,
    /\bI\s*\.\s*R\s*\.\s*S\s*\.\s*Employer\s+Identification(?:\s+No\.?)?/gi,
    /\bIRS\s+Employer(?:\s+Identification(?:\s+(?:Number|No\.?))?)?/gi,
  ];
  for (const ar of anchors) {
    ar.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = ar.exec(head)) !== null) {
      const slice = head.slice(mm.index + mm[0].length, mm.index + mm[0].length + 8800);
      const flat = flattenIxHtmlSnippetToEinLine(slice);
      const hit = firstEinHyphenCandidateInFlattened(flat);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * US IRS EIN from 10-K cover: hyphen form `XX-XXXXXXX` on the first ~page, then anchored HTML/text fallbacks.
 * @param rawIxHtml Latest 10-K HTML from EDGAR (optional; flatten + cover scan catches split-table covers).
 */
export function extractEmployerIdentificationNumberFromTenK(
  htmlOrText: string,
  alternateBlob?: string,
  rawIxHtml?: string,
): string | null {
  /** 1 — Cover scan: `XX-XXXXXXX` on the first page (plus light context when several dashed groups exist). */
  const coverSeen = new Set<string>();
  const tryCover = (chunk: string): string | null => {
    const one = normalizeWhitespace(normalizeEinWhitespace(chunk)).replace(/\s+/g, " ");
    const key = uniqueCoverScanKey(one);
    if (!key.trim() || coverSeen.has(key)) return null;
    coverSeen.add(key);
    return extractEinByHyphenFormatOnTenKCover(one);
  };

  if (rawIxHtml?.trim()) {
    const flatIx = flattenIxHtmlSnippetToEinLine(rawIxHtml.slice(0, 900_000));
    const fromCover = tryCover(flatIx);
    if (fromCover) return fromCover;
  }
  for (const blob of [htmlOrText, alternateBlob ?? ""]) {
    if (!blob.trim()) continue;
    const fromCover = tryCover(blob);
    if (fromCover) return fromCover;
  }

  if (rawIxHtml?.trim()) {
    const fromIx = extractEmployerIdentificationNumberFromIxHtml(rawIxHtml);
    if (fromIx) return fromIx;
  }
  const blobs = [htmlOrText, alternateBlob ?? ""].filter(Boolean);
  const seenBlob = new Set<string>();
  for (const raw of blobs) {
    const head = normalizeEinWhitespace(raw).slice(0, 380_000);
    const condensed = normalizeWhitespace(head).replace(/\s+/g, " ");
    const key = condensed.slice(0, 120_000);
    if (!key.trim() || seenBlob.has(key)) continue;
    seenBlob.add(key);

    /** No trailing `\b` on “No.” labels — `\b` would cut the match before the period (“No”). */
    const anchorRes: RegExp[] = [
      /\b(?:I\s*\.\s*R\s*\.\s*S\s*\.?\s*|IRS\s+)?Employer\s+Identification(?:\s+Number|\s+No\.?)?/gi,
      /\bIRS\s+Employer(?:\s+Identification(?:\s+(?:Number|No\.?))?)?/gi,
      /\b(?:I\s*\.\s*R\s*\.\s*S\s*\.?\s*|IRS\s+)?Employer\s+I\.?D\.?/gi,
      /\bFederal\s+EIN\b/gi,
      /\bTax\s+(?:Identification\s+)?(?:Number|No\.?)/gi,
    ];
    /** Short window only for lone `EIN` with punctuation (noisy). */
    const einOnly = /\bEIN\b\s*[:\#\.\-–—]?\s*/gi;

    let found: string | null = null;
    for (const ar of anchorRes) {
      ar.lastIndex = 0;
      let mm: RegExpExecArray | null;
      while ((mm = ar.exec(condensed)) !== null) {
        const tailStart = mm.index + mm[0].length;
        found = parseEinFragmentsFromTail(condensed.slice(tailStart));
        if (found) return found;
      }
    }

    einOnly.lastIndex = 0;
    let em: RegExpExecArray | null;
    while ((em = einOnly.exec(condensed)) !== null) {
      found = parseEinFragmentsFromTail(condensed.slice(em.index + em[0].length));
      if (found) return found;
    }

    /** 2 — Legacy single-line-ish patterns (include Unicode dash characters used in PDF-to-HTML). */
    const euDash = `\u2010-\u2015`;
    const sepClass = `#:\\s\-–—${euDash}\u2212./`;
    const patterns: RegExp[] = [
      new RegExp(
        `(?:I\\.\\s*R\\.\\s*S\\.\\s*\\.?\\s*|IRS\\s+)?Employer\\s+Identification(?:\\s+Number|\\s+No\\.?)?[^\\d]{0,200}(\\d{2})\\s*[${sepClass}]*\\s*(\\d{7})\\b`,
        "i"
      ),
      new RegExp(
        `(?:Employer\\s+Identification(?:\\s+Number|\\s+No\\.?)?|IRS\\s+Employer(?:\\s+Identification(?:\\s+Number)?|\\s+I\\.?D\\.?)?)\\s*[${sepClass}]{0,8}(\\d{2})[${sepClass}]+(\\d{7})\\b`,
        "i"
      ),
      new RegExp(`\\b(?:E\\.\\s*I\\.\\s*N\\.|EIN)\\s*[${sepClass}]{0,6}(\\d{2})[${sepClass}]*(\\d{7})\\b`, "i"),
      new RegExp(`\\bTax\\s+(?:Identification\\s+)?(?:Number|No\\.?)\\s*[${sepClass}]*(\\d{2})[${sepClass}]+(\\d{7})\\b`, "i"),
      new RegExp(`(?:Federal\\s+EIN|TIN)\\b[^\\d]{0,120}(\\d{2})[${sepClass}]+(\\d{7})\\b`, "i"),
    ];
    for (const re of patterns) {
      const m = condensed.match(re);
      if (m?.[1] && m?.[2]) return `${m[1]}-${m[2]}`;
    }
  }

  return null;
}

/** 10-digit SEC CIK when printed on cover (fills gaps if submissions value is malformed). */
function extractCikFromCoverPage(head: string): string | null {
  const condensed = head.slice(0, 220_000).replace(/\s+/g, " ");
  const patterns: RegExp[] = [
    /\bCIK\b\s*[#:(\[\]]*\s*(\d{7,10})\b/i,
    /\bCIK\b\s+\D{0,4}(\d{7,10})\b/i,
    /\bCentral\s+Index\s+Key\b\s*[#:(\[\]]*\s*(\d{7,10})\b/i,
    /\(.*?CIK[^\d]{0,14}(\d{7,10})\b/i,
  ];
  for (const re of patterns) {
    const m = condensed.match(re);
    if (m?.[1]) return m[1]!.replace(/\D/g, "").padStart(10, "0").slice(-10);
  }
  return null;
}

/** Fiscal month/day as MM/DD from cover table when filings JSON FYE missing. */
function extractFiscalYearEndFromCoverPage(head: string): string | null {
  const condensed = head.slice(0, 140_000).replace(/\s+/g, " ");
  const slashPatterns = [
    /\bFiscal\s+Year\s+End(?:ed)?\b[^\d]{0,40}(\d{1,2})\/(\d{1,2})\b/i,
    /\b(?:Fiscal\s+)?Year\s+[Ee]nd(?:ed)?\b[^\d]{0,70}(\d{1,2})\/(\d{1,2})\b/i,
    /\b[Ee]nd\s+of\s+[Ff]iscal\s+[Yy]ear\b[^\d]{0,40}(\d{1,2})\/(\d{1,2})\b/i,
    /\b[Ee]nd\s+of\s+[Ff]iscal\s+[Yy]ear\b[^\d]{0,80}(\d{1,2})[.-](\d{1,2})\b/i,
  ];
  for (const re of slashPatterns) {
    const m = condensed.match(re);
    if (!m?.[1] || !m?.[2]) continue;
    const mo = Number(m[1]),
      dy = Number(m[2]);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) continue;
    return `${String(mo).padStart(2, "0")}/${String(dy).padStart(2, "0")}`;
  }
  const near = condensed.match(/\b[Ff]iscal\s+[Yy]ear\s+[Ee]nd[^\d]{0,200}?\b([01]\d)([0123]\d)\b(?:\s|[^\d]|$)/);
  if (near) {
    const mo = Number(near[1]),
      dy = Number(near[2]);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) return `${near[1]}/${near[2]}`;
  }
  return null;
}

function findItem2Slice(text: string): string | null {
  const idx = text.search(/\bITEM\s+2\.?\s*[\s\S]{0,40}\bPROPERT/i);
  if (idx < 0) return null;
  const after = text.slice(idx);
  const end = after.search(/\bITEM\s+3\b/i);
  const slice = end > 0 ? after.slice(0, end) : after.slice(0, 14_000);
  return slice;
}

/**
 * Pull a registrant HQ / principal executive block from plain filing text.
 */
function extractPrincipalExecutiveOffice(text: string): { address: string | null; snippetSource: string | null } {
  const head = text.slice(0, 45_000);
  const cover = extractPrincipalExecutiveFromCover(head);
  if (cover) return { address: cover, snippetSource: "10-K cover page (principal executive offices)" };

  const item2 = findItem2Slice(text);
  const windows = [head, item2 ?? ""].filter((w) => w.length > 80);

  const tryPatterns = (window: string): string | null => {
    const patterns: RegExp[] = [
      /principal\s+executive\s+offices?\s+(?:are\s+)?(?:located\s+)?(?:at|in)\s+([\s\S]{15,900}?)(?=\n\s*\n\s*(?:ITEM\s+\d|Item\s+\d|PART\s+[IVX\d]|NOTE\s+\d|\(\s*[a-z]\s*\)\s*$))/i,
      /principal\s+executive\s+office\s+is\s+(?:located\s+)?(?:at|in)\s+([\s\S]{15,900}?)(?=\n\s*\n\s*(?:ITEM\s+\d|Item\s+\d|PART\s+[IVX\d]))/i,
      /principal\s+executive\s+offices?\s+(?:are\s+)?(?:located\s+)?(?:at|in)\s+([^\n]{15,400})/i,
      /principal\s+executive\s+office\s+is\s+(?:located\s+)?(?:at|in)\s+([^\n]{15,400})/i,
      /corporate\s+headquarters\s+(?:are\s+)?(?:located\s+)?(?:at|in)\s+([^\n]{15,400})/i,
    ];
    for (const re of patterns) {
      const m = window.match(re);
      if (m?.[1]) {
        const cleaned = normalizeWhitespace(m[1]).replace(/\s+$/g, "");
        if (cleaned.length >= 12 && cleaned.length <= 950) return cleaned;
      }
    }
    return null;
  };

  for (const w of windows) {
    const hit = tryPatterns(w);
    if (hit) return { address: hit, snippetSource: w === head ? "10-K header / Item 1 region" : "Item 2 (Properties)" };
  }
  return { address: null, snippetSource: null };
}

/**
 * Best-effort US ZIP5 (or ZIP+4) from a free-text address block (prefers the last 5 digits on the “city line”).
 */
function extractUsZipFromAddressBlock(block: string): string | null {
  const matches = block.match(/\b(\d{5})(?:-(\d{4}))?\b/g);
  if (matches?.length) {
    const last = matches[matches.length - 1];
    const m = last.match(/\b(\d{5})/);
    return m?.[1] ?? null;
  }
  /** Some filings run state + ZIP together: "LA71203" after stripping HTML. */
  const glued = block.match(/(?:^|[\s,])([A-Z]{2})(\d{5})(?:-(\d{4}))?(?=\s*[,.]?\s*$|[\s,])/im);
  if (glued?.[2]) return glued[2];
  return null;
}

function addressBlockToGeocodeLine(block: string): string {
  const lines = block
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return block.replace(/\s+/g, " ").trim();
  if (lines.length === 1) return lines[0];
  return `${lines.slice(0, -1).join(" ")}, ${lines[lines.length - 1]}`;
}

/** Parse trailing US city line: "City, ST ZIP", "City, Louisiana ZIP", or "City ST ZIP". */
function parseCityStateZipFromAddress(block: string): {
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-3).join("\n");
  const oneLine = tail.replace(/\n/g, ", ");
  const zm = oneLine.match(/,\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/i);
  if (zm) {
    return {
      city: zm[1].replace(/^[\d\s]+/, "").trim(),
      state: zm[2].toUpperCase(),
      zip: zm[3],
    };
  }
  const z2 = oneLine.match(/,\s*([^,]+?),\s*([A-Z]{2})\s*$/i);
  if (z2) {
    const zip = extractUsZipFromAddressBlock(block);
    return { city: z2[1].trim(), state: z2[2].toUpperCase(), zip };
  }
  const z3 = block.match(/\b([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?),\s*([A-Z]{2})\s+\d{5}\b/);
  if (z3) {
    const zip = extractUsZipFromAddressBlock(z3[0]);
    return { city: z3[1].trim(), state: z3[2].toUpperCase(), zip };
  }
  const z4 = block.match(
    /\b([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)+)\s*,\s*([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)\s+(\d{5})(?:-\d{4})?\b/
  );
  if (z4) {
    const city = z4[1].trim();
    const stateFull = z4[2].trim().toLowerCase();
    const abbr = STATE_FULL_NAME_TO_ABBR[stateFull];
    if (abbr) return { city, state: abbr, zip: z4[3] };
  }
  const z5 = block.match(/\b([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)+)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  if (z5) {
    return { city: z5[1].trim(), state: z5[2].toUpperCase(), zip: z5[3] };
  }
  /** "Monroe, Louisiana 71203" (full state name before ZIP). */
  const last = lines[lines.length - 1] ?? "";
  const z6 = last.match(/^([^,]+),\s*([A-Za-z][a-z]+(?:\s+[a-z]+)?)\s+(\d{5})(?:-\d{4})?\s*$/i);
  if (z6) {
    const stateFull = z6[2].trim().toLowerCase().replace(/\.$/, "");
    const abbr = STATE_FULL_NAME_TO_ABBR[stateFull];
    if (abbr) return { city: z6[1].trim(), state: abbr, zip: z6[3] };
  }
  const zipOnly = extractUsZipFromAddressBlock(block);
  return { city: null, state: null, zip: zipOnly };
}

function pickBetterPeoBlock(a: string | null, b: string | null): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const za = extractUsZipFromAddressBlock(a);
  const zb = extractUsZipFromAddressBlock(b);
  if (za && !zb) return a;
  if (zb && !za) return b;
  return a.length >= b.length ? a : b;
}

/**
 * When HTML→text breaks table layout, regex lookahead may miss the city/ZIP line — scan line-by-line after the cover label.
 */
function extractPeoBlockByLineScan(head: string): string | null {
  const lines = head.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Address\s+of\s+(?:principal\s+)?executive\s+offices?/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const collected: string[] = [];
  const first = lines[start];
  const inline = first.replace(/^[\s(]*Address\s+of\s+(?:principal\s+)?executive\s+offices?\s*\)?\s*[:\s]*/i, "").trim();
  if (inline.length >= 3) collected.push(inline);
  const stopLine = (s: string) =>
    /^(?:\()?(?:Exact\s+name|State\s+or\s+other\s+jurisdiction|Securities\s+registered|Title\s+of\s+each\s+class|Indicate\s+by|IRS\s+Employer|Employer\s+Identification)/i.test(
      s
    ) || /^(?:ITEM\s+\d\b|PART\s+[IVX]|Table\s+of\s+Contents)/i.test(s);
  for (let i = start + 1; i < Math.min(lines.length, start + 14); i++) {
    const line = lines[i];
    if (!line) continue;
    if (stopLine(line)) break;
    collected.push(line);
  }
  const block = normalizeWhitespace(collected.join("\n")).trim();
  return block.length >= 12 ? block : null;
}

/** Cover-page "(State or other jurisdiction of incorporation or organization)" row — submissions JSON sometimes omits this. */
function extractStateOfIncorporationFromCover(head: string): string | null {
  const window = head.slice(0, 48_000);
  const lines = window.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 0);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      /State\s+or\s+other\s+jurisdiction\s+of\s+incorporation/i.test(lines[i]) ||
      /^State\s+of\s+incorporation\b/i.test(lines[i])
    ) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const labelLine = lines[idx];
  const sameRow = labelLine
    .replace(/^.*?(?:State\s+or\s+other\s+jurisdiction\s+of\s+incorporation\s+or\s+organization|State\s+of\s+incorporation)\s*[:\s\-–]*/i, "")
    .trim();
  if (
    sameRow.length >= 2 &&
    sameRow.length <= 120 &&
    !/incorporation\s+or\s+organization/i.test(sameRow)
  ) {
    const n = normalizeStateCode(sameRow) ?? normalizeStateCode(sameRow.replace(/\([^)]*\)/g, "").trim());
    if (n) return n;
  }
  for (let j = idx + 1; j < Math.min(lines.length, idx + 6); j++) {
    const line = lines[j];
    if (/^(?:\()?(?:Address|Exact\s+name|Employer\s+Identification|IRS\s+Employer)/i.test(line)) break;
    const stripped = line.replace(/^[\d\s.)*-]+/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (stripped.length < 2 || stripped.length > 80) continue;
    const n = normalizeStateCode(stripped);
    if (n) return n;
  }
  return null;
}

/** Cover page — allow label + address on same line (common in SEC HTML → text). */
function extractPrincipalExecutiveFromCover(head: string): string | null {
  const window = head.slice(0, 36_000);
  let fromRegex: string | null = null;
  /** Multi-line block first so city/state/ZIP lines are not dropped (single-line regex used to stop at first \\n). */
  const multilinePatterns: RegExp[] = [
    /Address\s+of\s+(?:principal\s+)?executive\s+offices?\s*[:\s]*\n([\s\S]{12,1600}?)(?=\n\s*\n\s*(?:\(?\s*Exact\s+name|Securities\s+registered|Title\s+of\s+each\s+class|Indicate\s+by|Registrant[’']s\s+telephone|Former\s+name|State\s+or\s+other\s+jurisdiction))/i,
    /principal\s+executive\s+offices?\s*[:\s]*\n([\s\S]{12,1600}?)(?=\n\s*\n\s*(?:\(?\s*Exact\s+name|Securities\s+registered|Title\s+of\s+each\s+class|State\s+or\s+other\s+jurisdiction))/i,
    /Address\s+of\s+(?:principal\s+)?executive\s+offices?\s*[:\s]*\n([\s\S]{12,1600}?)(?=\n\s*\n\s*(?:\(?\s*Exact\s+name|Securities\s+registered))/i,
  ];
  for (const re of multilinePatterns) {
    const m = window.match(re);
    if (m?.[1]) {
      const cleaned = normalizeWhitespace(m[1]);
      if (cleaned.length >= 12 && cleaned.length <= 1800) fromRegex = pickBetterPeoBlock(fromRegex, cleaned);
    }
  }
  const sameLine = window.match(
    /\bAddress\s+of\s+(?:principal\s+)?executive\s+offices?\s*:?\s*([^\n]{12,900})/i
  );
  if (sameLine?.[1]) {
    const cleaned = normalizeWhitespace(sameLine[1]);
    if (cleaned.length >= 12 && cleaned.length <= 1200) fromRegex = pickBetterPeoBlock(fromRegex, cleaned);
  }
  const fromScan = extractPeoBlockByLineScan(window);
  return pickBetterPeoBlock(fromRegex, fromScan);
}

function distinctMerge(base: string[], extra: string[], excludeLower: Set<string>): string[] {
  const out = [...base];
  const seen = new Set(out.map((x) => x.toLowerCase()));
  for (const x of excludeLower) seen.add(x);
  for (const e of extra) {
    const t = e.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

async function resolveHqCountyFromPeo(
  address: string | null,
  hqCity: string | null,
  hqState: string | null,
  zipHint: string | null
): Promise<{ county: string | null; extraSources: string[]; extraWarnings: string[] }> {
  const extraSources: string[] = [];
  const extraWarnings: string[] = [];
  const zip = zipHint ?? (address ? extractUsZipFromAddressBlock(address) : null);

  const candidates: string[] = [];
  if (address) candidates.push(addressBlockToGeocodeLine(address));
  if (hqCity && hqState && zip) candidates.push(`${hqCity}, ${hqState} ${zip}`);

  for (const line of candidates) {
    const c = await lookupCountyNameFromUsAddressLine(line);
    if (c) {
      extraSources.push("US Census Geocoder — county from principal executive address");
      return { county: c, extraSources, extraWarnings };
    }
  }
  if (zip) {
    const c = await lookupCountyNameFromUsZip(zip);
    if (c) {
      extraSources.push(`US Census Geocoder — county inferred from ZIP ${zip}`);
      return { county: c, extraSources, extraWarnings };
    }
    extraWarnings.push("Could not resolve HQ county automatically from the address/ZIP — verify manually.");
  }
  return { county: null, extraSources, extraWarnings };
}

export async function buildPublicRecordsProfileFromSec(
  ticker: string,
  userId: string | null | undefined
): Promise<{ ok: true; prefill: PublicRecordsSecPrefill } | { ok: false; message: string }> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return { ok: false, message: "Ticker required" };

  const sources: string[] = [];
  const warnings: string[] = [
    "Borrowers, guarantors, DBAs, and operating-company roles are usually not fully disclosed in the 10-K alone — supplement from credit agreements, indentures, and org charts.",
  ];

  const bundle = await getCompanyProfileAndPrincipalBusinessAddress(tk);
  if (!bundle) {
    return { ok: false, message: "Could not load SEC company profile (ticker → CIK). Check the symbol or try again." };
  }
  const secProfile = bundle.profile;

  sources.push(`SEC submissions JSON — registrant name, CIK, fiscal year end, state of incorporation, former names (${tk})`);

  const companyName = secProfile.name.replace(/\s+/g, " ").trim() || null;
  const cik = secProfile.cik.replace(/\D/g, "").padStart(10, "0");
  let fiscalYearEnd =
    secProfile.fiscalYearEnd && secProfile.fiscalYearEnd !== "—"
      ? secProfile.fiscalYearEnd.replace(/\s+/g, " ").trim()
      : null;

  let stateOfIncorporation = normalizeStateCode(secProfile.stateOfIncorporation);
  if (!stateOfIncorporation && secProfile.stateOfIncorporation && secProfile.stateOfIncorporation !== "—") {
    warnings.push(`State of incorporation from SEC (“${secProfile.stateOfIncorporation}”) could not be normalized to a 2-letter code — verify manually.`);
  }

  const formerNames = secProfile.formerNames ?? [];
  const legalNames = companyName ? [companyName] : [];
  const issuerNames = companyName ? [companyName] : [];

  const tenKMeta = await resolveLatest10KFilingWithMeta(tk);
  const tenK = tenKMeta?.filing ?? null;

  let exhibit21DocUrl: string | null = null;
  if (tenKMeta) {
    const allF = await getAllFilingsByTicker(tk);
    if (allF?.filings?.length) {
      const ex = await resolveExhibit21AcrossAnnualFilings(tenKMeta.cik, allF.filings, 14);
      exhibit21DocUrl = ex.exhibit21Url;
      if (
        ex.exhibit21Url &&
        ex.sourceFiling &&
        ex.sourceFiling.accessionNumber !== tenKMeta.filing.accessionNumber
      ) {
        sources.push(
          `Exhibit 21 attachment uses Form ${ex.sourceFiling.form} filed ${ex.sourceFiling.filingDate} (validated subsidiary schedule); the latest annual filing on its own did not yield a passing Exhibit 21.`
        );
      }
    } else {
      exhibit21DocUrl = await resolveExhibit21DocumentUrl(
        tenKMeta.cik,
        tenKMeta.filing.accessionNumber,
        tenKMeta.filing.docUrl
      );
    }
  }

  const parentLower = (companyName ?? tk).toLowerCase();
  const exclude = new Set([parentLower]);

  let subsidiaryExhibit21Snapshot: Exhibit21GridSnapshotV1 | null = null;
  if (exhibit21DocUrl) {
    try {
      const res = await fetch(exhibit21DocUrl, { headers: { "User-Agent": getSecEdgarUserAgent() } });
      if (res.ok) {
        const rawEx = await res.text();
        subsidiaryExhibit21Snapshot = extractExhibit21GridSnapshotFromDocument(rawEx);
        if (subsidiaryExhibit21Snapshot) {
          sources.push(
            `Exhibit 21 — preserved full subsidiary schedule (${subsidiaryExhibit21Snapshot.rows.length} rows, ${subsidiaryExhibit21Snapshot.source}); search uses inferred subsidiary/name column where possible.`
          );
        }
      }
    } catch {
      warnings.push("Resolved Exhibit 21 attachment could not be downloaded for the full schedule snapshot.");
    }
  }

  let subsidiaryNames: string[] = [];
  if (subsidiaryExhibit21Snapshot) {
    subsidiaryNames = distinctMerge(
      [],
      deriveSubsidiarySearchNamesFromGrid(subsidiaryExhibit21Snapshot),
      exclude
    );
    if (subsidiaryNames.length === 0) {
      warnings.push(
        "Exhibit 21 was scraped as a table but no subsidiary-name column was detected for search hints — edit the captured grid manually if needed."
      );
    }
  } else {
    const hints = tenKMeta
      ? await getSubsidiaryHintsForTicker(tk, userId, {
          alignedTenK: tenKMeta.filing,
          cik: tenKMeta.cik,
          registrantName: companyName ?? undefined,
          subsidiaryExtractionProfile: "public-records",
        })
      : await getSubsidiaryHintsForTicker(tk, userId, { subsidiaryExtractionProfile: "public-records" });
    if (hints.ok) {
      sources.push(...hints.sources);
      subsidiaryNames = hints.names.filter((n) => n.toLowerCase() !== parentLower);
      subsidiaryNames = distinctMerge([], subsidiaryNames, exclude);
    } else {
      warnings.push(hints.message);
    }
  }

  let subsidiaryDomiciles: string[] = [];
  if (!subsidiaryExhibit21Snapshot && subsidiaryNames.length > 0) {
    const paired = pairedSubsidiariesFromLines(subsidiaryNames);
    subsidiaryNames = paired.names;
    subsidiaryDomiciles = paired.domiciles;
  }

  let filing: PublicRecordsSecPrefill["filing"] = null;
  let principalExecutiveOfficeAddress: string | null = null;
  let irsEmployerIdentificationNumber: string | null = null;
  let hqCity: string | null = null;
  let hqState: string | null = null;
  let hqCounty: string | null = null;

  const pb = bundle.principalBusiness;
  if (pb) {
    principalExecutiveOfficeAddress = pb.formatted;
    const zipInFormatted = principalExecutiveOfficeAddress
      ? extractUsZipFromAddressBlock(principalExecutiveOfficeAddress)
      : null;
    if (pb.zip && !zipInFormatted) {
      const lines = principalExecutiveOfficeAddress.split(/\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const last = lines[lines.length - 1];
        if (/,\s*[A-Z]{2}\s*$/i.test(last)) {
          lines[lines.length - 1] = `${last.trimEnd()} ${pb.zip}`;
        } else {
          lines.push(pb.zip);
        }
        principalExecutiveOfficeAddress = lines.join("\n");
      }
    }
    hqCity = pb.city;
    hqState = pb.state;
    if (!hqState && pb.zip) {
      hqState = await lookupStateAbbrFromUsZip(pb.zip);
    }
    const countyFromSub = await resolveHqCountyFromPeo(principalExecutiveOfficeAddress, hqCity, hqState, pb.zip);
    hqCounty = countyFromSub.county;
    sources.push(...countyFromSub.extraSources);
    warnings.push(...countyFromSub.extraWarnings);
    sources.push("SEC submissions JSON — registrant business office (`addresses.business` or `mailing`)");
  } else {
    warnings.push(
      "SEC submissions did not include structured business-address fields — HQ geography will rely on the latest 10-K text when possible."
    );
  }

  if (tenK?.docUrl) {
    try {
      const res = await fetch(tenK.docUrl, { headers: { "User-Agent": getSecEdgarUserAgent() } });
      if (res.ok) {
        const html = await res.text();
        const text = stripSecFilingHtml(html);

        const einCoverAltPlain = filingHtmlToEinPlainBlob(html);
        const einFromCover = extractEmployerIdentificationNumberFromTenK(text, einCoverAltPlain, html);
        if (einFromCover) {
          irsEmployerIdentificationNumber = einFromCover;
          sources.push(`Latest ${tenK.form} (${tenK.filingDate}) — employer identification number (cover)`);
        }

        if (!fiscalYearEnd) {
          const fyCover = extractFiscalYearEndFromCoverPage(text);
          if (fyCover) {
            fiscalYearEnd = fyCover;
            sources.push(`Latest ${tenK.form} (${tenK.filingDate}) — fiscal year end (cover)`);
          }
        }

        const incFromCover = extractStateOfIncorporationFromCover(text);
        if (incFromCover && !stateOfIncorporation) {
          stateOfIncorporation = incFromCover;
          sources.push(`Latest ${tenK.form} (${tenK.filingDate}) — state of incorporation (10-K cover)`);
        }

        const { address, snippetSource } = extractPrincipalExecutiveOffice(text);
        if (address) {
          const geo = parseCityStateZipFromAddress(address);
          const zipHint = geo.zip ?? extractUsZipFromAddressBlock(address);
          const tenKZip = extractUsZipFromAddressBlock(address);
          const tenKZipStr = tenKZip ?? "";
          const currentZip = principalExecutiveOfficeAddress
            ? extractUsZipFromAddressBlock(principalExecutiveOfficeAddress)
            : null;
          /** Prefer 10-K cover text when it includes a ZIP and submissions block omits it or uses a different ZIP. */
          const useTenKAddressBlock =
            !principalExecutiveOfficeAddress ||
            (tenKZipStr.length === 5 &&
              (!currentZip ||
                !(principalExecutiveOfficeAddress ?? "").replace(/\s+/g, " ").includes(tenKZipStr)));

          if (useTenKAddressBlock) {
            principalExecutiveOfficeAddress = address;
            sources.push(
              `Latest ${tenK.form} (${tenK.filingDate}) — principal executive / HQ text (${snippetSource ?? "pattern match"})`
            );
          }

          if (!hqCity && geo.city) hqCity = geo.city;
          if (!hqState && geo.state) hqState = geo.state;
          else if (!hqState && zipHint) hqState = await lookupStateAbbrFromUsZip(zipHint);

          if (!hqCounty) {
            const countyRes = await resolveHqCountyFromPeo(
              principalExecutiveOfficeAddress ?? address,
              hqCity,
              hqState,
              zipHint
            );
            if (countyRes.county) hqCounty = countyRes.county;
            sources.push(...countyRes.extraSources);
            warnings.push(...countyRes.extraWarnings);
          }
        } else if (!principalExecutiveOfficeAddress) {
          warnings.push(
            "Could not find a principal executive office paragraph in the latest 10-K text — paste from the cover page or Item 2 manually."
          );
        }
        filing = {
          form: tenK.form,
          filingDate: tenK.filingDate,
          docUrl: tenK.docUrl,
          exhibit21DocUrl,
        };
      }
    } catch {
      warnings.push("Failed to download the latest 10-K for address extraction.");
    }
  } else {
    warnings.push(
      "No annual Form 10-K or Form 20-F found in SEC submissions (recent window + full filing index). Check the ticker symbol (class shares often use a hyphen, e.g. BRK-B)."
    );
  }

  const prefill: PublicRecordsSecPrefill = {
    companyName,
    legalNames,
    formerNames,
    subsidiaryNames,
    subsidiaryExhibit21Snapshot,
    subsidiaryDomiciles,
    issuerNames,
    cik,
    fiscalYearEnd,
    irsEmployerIdentificationNumber,
    stateOfIncorporation,
    hqState,
    hqCity,
    hqCounty,
    principalExecutiveOfficeAddress,
    sources: Array.from(new Set(sources)),
    warnings,
    filing,
  };

  return { ok: true, prefill };
}
