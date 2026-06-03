/**
 * Extract HTML tables from MD&A and segment-information notes in the filing's primary Inline XBRL document.
 * Resolves ix:nonFraction values (scale/sign) to USD for display when present.
 */

import * as cheerio from "cheerio";
import type { ChildNode, Element as DomElement, Text } from "domhandler";

import { edgarArchivesFolderCikCandidates, getSecEdgarUserAgent } from "@/lib/sec-edgar";
import type { MdnaBounds, NotesSectionBounds, SegmentNotePick } from "@/lib/sec-ixbrl-mdna-boundaries";
import {
  buildNotesSectionBounds,
  findBestSegmentNoteRange,
  findMdnaBounds,
} from "@/lib/sec-ixbrl-mdna-boundaries";

export type IxbrlFilingSection = "mdna" | "segment";

export type TableConfidence = "high" | "medium" | "low";

/** `"app"` — column collapse, $-merge, typography normalization for our grid viewer; `"filing"` — security + ix facts only (press-release fidelity). */
export type IxbrlTableDisplayFidelity = "app" | "filing";

export type BuildDisplayTableHtmlOptions = { fidelity?: IxbrlTableDisplayFidelity };

export type IxbrlHtmlTable = {
  id: string;
  caption: string | null;
  /** Plain-text / formatted numeric cells (row-major); colspan/rowspan are flattened so columns may misalign. */
  rows: string[][];
  /** When set, prefer this in the UI — preserves colspan/rowspan from the filing. */
  tableHtml: string | null;
  factCount: number;
  section: IxbrlFilingSection;
  /** Byte offset in flattened body text (for diagnostics). */
  textOffset: number;
  confidence: TableConfidence;
  inclusionReason: string;
};

export type IxbrlExtractionDiagnostics = {
  form: string;
  mdna: {
    found: boolean;
    startOffset?: number;
    endOffset?: number;
    startLabel?: string;
    endLabel?: string;
    confidence?: string;
    warnings: string[];
    rangeUsedForExtraction: boolean;
  };
  notes: { found: boolean; startOffset?: number; endOffset?: number; headingFound?: boolean };
  segmentNote: {
    found: boolean;
    heading?: string;
    score?: number;
    confidence?: string;
    warnings: string[];
    rangeUsedForExtraction: boolean;
  };
  tables: {
    totalInDocument: number;
    taggedInMdnaRange: number;
    taggedInSegmentRange: number;
    included: number;
    rejected: number;
  };
  rejectionReasons: Record<string, number>;
};

/** Extracted non-GAAP EBITDA / Adjusted EBITDA style reconciliation tables (MD&A or full document). */
export type IxbrlEbitdaTable = {
  caption: string | null;
  tableHtml: string | null;
  /** True when the table’s start offset falls inside the detected MD&A span. */
  inMdna: boolean;
  factCount: number;
  textOffset: number;
};

export type IxbrlEbitdaSupplementalSource = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  /** Filing member filename (8-K shell or Exhibit 99.x HTML) that contained the detected tables. */
  primaryDocument: string;
  /** Direct link to `primaryDocument` in EDGAR Archives. */
  primaryDocumentUrl: string;
  /** `primary` = 8-K main document · `exhibit_99` = Exhibit 99.x press release / earnings HTML from the same filing. */
  documentRole?: "primary" | "exhibit_99";
};

export type IxbrlEbitdaReconciliation = {
  /** `tables` — one or more reconciliation grids found · `mention_only` — MD&A text references EBITDA but no qualifying table · `none` — no detection */
  status: "tables" | "mention_only" | "none";
  tables: IxbrlEbitdaTable[];
  /**
   * When EBITDA tables were not found in the selected 10-K/10-Q but were found in a nearby Form 8-K
   * earnings / press release exhibit.
   */
  supplementalSource?: IxbrlEbitdaSupplementalSource;
  /** When no EBITDA table was found, best URL to the first scanned earnings 8-K (Exhibit 99.x if present, else primary HTML). */
  suggestedPressRelease?: IxbrlEbitdaSupplementalSource;
  /** Set when we attempted a nearby-8-K scan from the periodic filing date. */
  nearby8KScan?: { candidatesTried: number };
};

/** Full earnings / press release document (Exhibit 99 HTML or 8-K primary) embedded in the ixbrl-mdna-tables API response. */
export type EarningsPressReleasePayload = {
  source: IxbrlEbitdaSupplementalSource;
  /** Body inner HTML (scripts/styles stripped server-side); sanitize again in the client. */
  html: string;
  truncated: boolean;
  /** Heuristic: narrative Exhibit 99 vs investor slide HTML in the same 8-K. */
  exhibitClass?: "press_release" | "slide_deck";
};

/** Cap serialized press-release HTML so JSON responses stay bounded. */
export const MAX_EARNINGS_PRESS_RELEASE_HTML_CHARS = 1_200_000;

/**
 * Reduce full EDGAR HTML to markup suitable for in-app rendering (removes script/style; keeps body content).
 */
export function extractPressReleaseBodyHtmlForDisplay(rawHtml: string): string {
  const $ = cheerio.load(rawHtml);
  $("script, style, noscript, link[rel='stylesheet'], meta").remove();
  /**
   * Exhibit 99 HTML often uses relative `src` (e.g. `image001.jpg`) next to the .htm on SEC; in-app rendering
   * shows broken placeholders. Logos aren’t needed for the excerpt — drop embedded raster/vector wrappers.
   */
  $("img, picture, image").remove();
  $("object[type^='image/'], embed[type^='image/']").remove();
  const body = $("body").html();
  if (body != null && body.trim().length > 0) return body.trim();
  const htmlInner = $("html").html();
  if (htmlInner != null && htmlInner.trim().length > 0) return htmlInner.trim();
  return rawHtml.trim();
}

function resolveUrlAgainstDocument(relativeOrAbsolute: string, documentUrl: string): string {
  const s = relativeOrAbsolute.trim();
  if (!s || /^data:/i.test(s) || /^blob:/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  try {
    return new URL(s, documentUrl).href;
  } catch {
    return s;
  }
}

/** Rewrite comma-separated `srcset` entries so relative URLs load next to the exhibit `.htm` on SEC. */
export function resolveSrcsetAgainstDocument(srcset: string, documentUrl: string): string {
  return srcset
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const sp = trimmed.indexOf(" ");
      if (sp > 0) {
        const url = trimmed.slice(0, sp).trim();
        const rest = trimmed.slice(sp).trim();
        return `${resolveUrlAgainstDocument(url, documentUrl)}${rest ? ` ${rest}` : ""}`;
      }
      return resolveUrlAgainstDocument(trimmed, documentUrl);
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Like {@link extractPressReleaseBodyHtmlForDisplay} but keep images and resolve `src` / `srcset` against `documentUrl`
 * (Exhibit 99 slide decks).
 */
export function extractSlideDeckBodyHtmlForDisplay(rawHtml: string, documentUrl: string): string {
  const docUrl = (documentUrl ?? "").trim();
  const $ = cheerio.load(rawHtml);
  $("script, style, noscript, link[rel='stylesheet'], meta").remove();

  if (docUrl.length > 0) {
    $("img[src]").each((_, el) => {
      const eld = el as DomElement;
      const cur = $(eld).attr("src");
      if (cur) $(eld).attr("src", resolveUrlAgainstDocument(cur, docUrl));
    });
    $("img[srcset]").each((_, el) => {
      const eld = el as DomElement;
      const cur = $(eld).attr("srcset");
      if (cur) $(eld).attr("srcset", resolveSrcsetAgainstDocument(cur, docUrl));
    });
    $("source[srcset]").each((_, el) => {
      const eld = el as DomElement;
      const cur = $(eld).attr("srcset");
      if (cur) $(eld).attr("srcset", resolveSrcsetAgainstDocument(cur, docUrl));
    });
    $("source[src]").each((_, el) => {
      const eld = el as DomElement;
      const cur = $(eld).attr("src");
      if (cur) $(eld).attr("src", resolveUrlAgainstDocument(cur, docUrl));
    });
  }

  $("object[type^='image/'], embed[type^='image/']").remove();
  const body = $("body").html();
  if (body != null && body.trim().length > 0) return body.trim();
  const htmlInner = $("html").html();
  if (htmlInner != null && htmlInner.trim().length > 0) return htmlInner.trim();
  return rawHtml.trim();
}

/** Tesla-style decks: full-size slide raster + tiny/white “invisible” text for accessibility. */
function scoreImageHeavySlideDeckSignals(html: string): number {
  const $ = cheerio.load(html);
  const imgs = $("img").toArray();
  if (imgs.length === 0) return 0;

  let large = 0;
  let slideNamed = 0;
  let exhibitRaster = 0;

  for (const el of imgs) {
    const $el = $(el);
    const w = parseInt(String($el.attr("width") ?? "0"), 10);
    const h = parseInt(String($el.attr("height") ?? "0"), 10);
    const title = ($el.attr("title") ?? "").toLowerCase();
    const src = ($el.attr("src") ?? "").toLowerCase();
    if ((Number.isFinite(w) && w >= 480) || (Number.isFinite(h) && h >= 480)) large++;
    if (/^slide\s*\d+/.test(title) || /^slide\d+/.test(title.replace(/\s+/g, ""))) slideNamed++;
    if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(src) && /exhibit|\d{3,}/.test(src)) exhibitRaster++;
  }

  let tinyWhiteFontBlocks = 0;
  $("font").each((_, el) => {
    const st = ($(el).attr("style") ?? "").replace(/\s+/g, " ").toLowerCase();
    if (st.includes("font-size:1pt") || st.includes("font-size: 1pt")) tinyWhiteFontBlocks++;
  });

  let s = 0;
  if (large >= 5) s += 62;
  else if (large >= 4) s += 54;
  else if (large >= 3) s += 36;

  if (slideNamed >= 3) s += 44;
  else if (slideNamed >= 2) s += 28;

  if (exhibitRaster >= 4 && large >= 3) s += 28;

  if (tinyWhiteFontBlocks >= 2 && large >= 2) s += 40;
  else if (tinyWhiteFontBlocks >= 1 && large >= 3) s += 26;

  return s;
}

/** Spaced-out display headings like "S U M M A R Y" common in slide OCR text. */
function scoreSpacedHeadingSlideSignal(rawText: string): number {
  if (/[A-Z](?:\s+[A-Z]){14,}/.test(rawText)) return 28;
  if (/[A-Z](?:\s+[A-Z]){10,}/.test(rawText) && /\bHIGH\s+L\s+I\s+G\s+H\s+T|S U M M A R Y/i.test(rawText))
    return 22;
  return 0;
}

/** Exported for unit tests / tuning. */
export function scoreEarningsHtmlSlideDeckLikelihood(html: string, filename: string): number {
  const $ = cheerio.load(html);
  const fn = (filename ?? "").toLowerCase();
  const imgHeavySig = scoreImageHeavySlideDeckSignals(html);
  let s = imgHeavySig;
  if (/slide|slides|deck|presentation|investor(?:deck|[-_]deck)|graphic|supplement|webcast|q\d|fy\d/i.test(fn))
    s += 42;

  const imgs = $("img").length;
  if (imgs >= 10) s += 34;
  else if (imgs >= 4) s += 26;
  else if (imgs >= 1) s += 12;

  const rawText = $.text().replace(/\u00a0/g, " ");
  s += scoreSpacedHeadingSlideSignal(rawText);

  const words = rawText.split(/\s+/).filter((w) => w.length > 0);
  const gluedAllCaps = words.filter(
    (w) => w.length >= 18 && w === w.toUpperCase() && /[A-Z]{6,}/.test(w) && !/^\d+$/.test(w)
  ).length;
  const longTokens = words.filter((w) => /[A-Za-z\u2014\u2013]{10,}/.test(w)).length;

  if (words.length < 100) {
    if (longTokens >= 4) s += 38;
    if (gluedAllCaps >= 2) s += 48;
    if (gluedAllCaps >= 1 && longTokens >= 2) s += 28;
  }

  const lines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2);
  let slideish = 0;
  for (const line of lines.slice(0, 120)) {
    if (/^\d{1,2}\s+[A-Z\u2014]/.test(line)) slideish++;
    if (/\s+\d{1,2}\s*$/.test(line) && line.length <= 200 && /[A-Z]{5,}/.test(line)) slideish++;
  }
  s += Math.min(28, slideish * 7);

  const periodSentenceHints = (rawText.match(/\.\s+[A-Z]/g) ?? []).length;
  if (words.length > 150 && periodSentenceHints >= 10) s -= 22;

  /** Image decks still contain long financial strings in caption divs — don’t over-penalize. */
  if (s >= 40 && imgHeavySig >= 54 && periodSentenceHints >= 8) s -= 10;

  return Math.max(0, s);
}

/** Exported for unit tests / tuning. */
export function scoreEarningsHtmlPressReleaseLikelihood(html: string, filename: string): number {
  const $ = cheerio.load(html);
  const fn = (filename ?? "").toLowerCase();
  const t = $.text();
  const tl = t.toLowerCase();
  let s = 0;
  if (/press|release|news|prerelease|earnings_?release/i.test(fn)) s += 16;
  if (/press release|news release|earnings release/i.test(tl)) s += 24;
  if (/\b(?:today|yesterday)\b.*\bannounc/.test(tl)) s += 14;
  if (/\bfinancial results\b|\bresults for the\b|\bearnings call\b|\bconference call\b|\binvestor call\b/i.test(tl)) s += 32;
  if (/\bceo\b|\bchief executive\b|\bforward-?looking statements\b/i.test(tl)) s += 12;
  if (/\bnon[\s-]*gaap\b|\brevenue\b.*\$\d|\bnet income\b|\bdiluted\s+eps\b/i.test(tl)) s += 18;

  const words = tl.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 200) s += 18;
  else if (words.length >= 120) s += 12;
  if (/\.\s+[A-Z”]/.test(t) && words.length >= 180) s += 10;

  /** Investor decks embed GAAP table copy next to slide images — down-rank “press” when it’s clearly image-first. */
  const imgHeavy = scoreImageHeavySlideDeckSignals(html);
  if (imgHeavy >= 70) s = Math.max(0, s - 45);
  else if (imgHeavy >= 54) s = Math.max(0, s - 32);
  else if (imgHeavy >= 40) s = Math.max(0, s - 18);

  return s;
}

export function classifyEarningsExhibitHtml(html: string, filename: string): "press_release" | "slide_deck" {
  const sd = scoreEarningsHtmlSlideDeckLikelihood(html, filename);
  const sp = scoreEarningsHtmlPressReleaseLikelihood(html, filename);
  if (sd >= 52 && sd - sp >= 6) return "slide_deck";
  if (sp >= 38 && sp - sd >= 6) return "press_release";
  return sd > sp ? "slide_deck" : "press_release";
}

export type ClassifiedEarningsExhibitFilename = { filename: string; kind: "press_release" | "slide_deck" };

/** Pick first narrative exhibit as main; when main is prose, first other slide exhibit becomes `deck`. */
export function pickEarningsMainAndDeck(
  classified: ClassifiedEarningsExhibitFilename[]
): { main: number; deck?: number } | null {
  if (classified.length === 0) return null;
  let main = classified.findIndex((c) => c.kind === "press_release");
  if (main < 0) main = classified.findIndex((c) => c.kind === "slide_deck");
  if (main < 0) return null;
  const mainFn = classified[main]!.filename;
  if (classified[main]!.kind !== "press_release") return { main };
  const deck = classified.findIndex((c) => c.kind === "slide_deck" && c.filename !== mainFn);
  return deck >= 0 ? { main, deck } : { main };
}

export type IxbrlMdnaTablesPayload =
  | {
      ok: true;
      primaryDocument: string;
      /** Item 7 / Item 2 bounds detected with usable confidence (or uncertain mode). */
      mdnaHeadingFound: boolean;
      /** Segment note candidate found with usable confidence. */
      segmentHeadingFound: boolean;
      /** At least one table returned from MD&A or segment section. */
      mdnaTableHit: boolean;
      /**
       * Full MD&amp;A slice HTML (narrative + tables) when section bounds are available.
       * Tagged amounts are rendered like table extraction; tables are theme-normalized.
       */
      mdnaSectionHtml: string | null;
      mdnaSectionHtmlTruncated: boolean;
      tables: IxbrlHtmlTable[];
      diagnostics: IxbrlExtractionDiagnostics;
      ebitdaReconciliation: IxbrlEbitdaReconciliation;
    }
  | { ok: false; error: string };

const MAX_TABLES_RETURNED = 250;
/** Above this, skip HTML snapshot (still return row grid for dedupe / accessibility). */
const MAX_TABLE_HTML_CHARS = 400_000;
/** Cap serialized MD&amp;A HTML so responses stay bounded (full Item 7 can be very large). */
const MAX_MDNA_SECTION_HTML_CHARS = 1_200_000;

/**
 * SEC Inline XBRL often uses `<table>` for bullets or a single narrative row (layout, not a financial grid).
 * When there are no `ix:nonFraction` tags, require a minimal 2×2-style grid so we do not surface prose blocks.
 *
 * `narrativeFinancialSection`: tables already constrained to MD&A / segment slices are often **prose grids**
 * (no digits, long cells) — without this, most 10-Q MD&A tables are dropped as "not plausible".
 */
export function isPlausibleDataTable(
  rows: string[][],
  factCount: number,
  opts?: { narrativeFinancialSection?: boolean }
): boolean {
  if (factCount >= 1) return true;
  const narrative = opts?.narrativeFinancialSection === true;

  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const nonEmpty = rows.flat().map((c) => c.trim()).filter((c) => c.length > 0);
  const cellCount = nonEmpty.length;
  const maxCellLen = nonEmpty.length ? Math.max(...nonEmpty.map((c) => c.length)) : 0;

  /** Single-column bullet / disclosure tables common in MD&A HTML */
  if (narrative && colCount === 1 && rows.length >= 8 && cellCount >= 8 && maxCellLen <= 30000) return true;

  if (colCount < 2) return false;
  if (cellCount < 4) return false;

  /** Issuers like QVC use huge prose cells — accept wide 2-col MD&A grids already boundary-filtered */
  if (narrative) {
    if (rows.length >= 4 && colCount >= 2 && cellCount >= 8 && maxCellLen <= 200000) return true;
    if (rows.length >= 3 && colCount >= 2 && cellCount >= 6 && maxCellLen <= 200000) return true;
    if (rows.length >= 4 && colCount >= 3 && cellCount >= 12) return true;
    if (rows.length >= 3 && colCount >= 3 && cellCount >= 9) return true;
    if (rows.length >= 2 && colCount >= 3 && cellCount >= 6 && maxCellLen <= 8000) return true;
    if (rows.length >= 2 && colCount >= 2 && cellCount >= 4 && maxCellLen <= 5000 && rows.length >= 5) return true;
  }

  if (rows.length < 2) {
    if (rows.length !== 1) return false;
    if (colCount < 4) return false;
    if (maxCellLen > 72 && !narrative) return false;
    if (narrative && colCount >= 4 && cellCount >= 4) return true;
    if (maxCellLen > 72) return false;
    return true;
  }

  if (maxCellLen > 280 && cellCount <= 6 && !narrative) return false;

  const digitish = /(?:\d[\d,]{0,14}(?:\.\d+)?|\(\d[\d,]*\)|%|\$[0-9]|\b20\d{2}\b)/;
  const cellsWithNumberHint = nonEmpty.filter((c) => digitish.test(c)).length;
  if (rows.length >= 2 && colCount >= 2 && cellCount >= 4 && cellsWithNumberHint === 0 && maxCellLen > 120) {
    if (narrative && maxCellLen <= 200000 && rows.length >= 2 && colCount >= 2) return true;
    return false;
  }

  return true;
}

/**
 * SEC filings often render the Part I / Part II table of contents as an HTML `<table>`.
 * It passes `isPlausibleDataTable` (many short cells, "Page 12" gives digit hints). Skip it so MD&A
 * extraction only surfaces real financial / narrative grids.
 */
function isLikelyTableOfContents(rows: string[][]): boolean {
  const flat = rows.flat().map((c) => c.trim()).filter((c) => c.length > 0);
  if (flat.length < 8 || rows.length < 4) return false;

  let itemLike = 0;
  let pageRefs = 0;
  for (const c of flat) {
    if (/\bitem\s+\d+[a-z]?\b/i.test(c)) itemLike++;
    const t = c.toLowerCase();
    if (/\bpage\s*\d+\b/.test(t) || /\(\s*page\s*\d+/.test(t)) pageRefs++;
  }
  const itemRatio = itemLike / flat.length;

  if (itemRatio >= 0.42 && rows.length >= 5) return true;
  if (itemLike >= 6 && pageRefs >= 4) return true;

  const head = flat.slice(0, 14).join(" ").toLowerCase();
  if (/\bpart\s+i\b/.test(head) && itemLike >= 4 && itemRatio >= 0.3) return true;
  if (/\bpart\s+ii\b/.test(head) && itemLike >= 4 && itemRatio >= 0.3) return true;
  if (/\btable\s+of\s+contents?\b/.test(head)) return true;

  return false;
}

function accNoDashes(acc: string): string {
  return (acc ?? "").replace(/-/g, "");
}

function isNonFractionTag(name: string): boolean {
  const n = name.toLowerCase();
  return n === "ix:nonfraction" || n.endsWith(":nonfraction");
}

function fmtUsdMillions(usd: number): string {
  const millions = usd / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

function parseNonFractionUsd($: cheerio.CheerioAPI, el: DomElement): string | null {
  const $el = $(el);
  const raw = $el.text().replace(/,/g, "").trim();
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return null;
  let scale = parseInt(String($el.attr("scale") ?? "0"), 10);
  if (!Number.isFinite(scale)) scale = 0;
  let v = num * 10 ** scale;
  const signAttr = $el.attr("sign");
  if (signAttr === "-" || signAttr === "-1") v = -Math.abs(v);
  return fmtUsdMillions(v);
}

function normalizeCellText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function cellText($: cheerio.CheerioAPI, el: DomElement): string {
  const parts: string[] = [];
  const visit = (node: ChildNode) => {
    if (node.type === "text") {
      const t = (node.data ?? "").replace(/\u00a0/g, " ");
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.type === "tag") {
      const tag = node as DomElement;
      if (isNonFractionTag(tag.name ?? "")) {
        const f = parseNonFractionUsd($, tag);
        if (f !== null) parts.push(f);
        else parts.push($(tag).text().trim());
        return;
      }
      const kids = tag.children ?? [];
      for (const c of kids) visit(c);
    }
  };
  const kids = el.children ?? [];
  for (const c of kids) visit(c);
  return normalizeCellText(parts.join(" "));
}

function countNonFractionsInTable(table: DomElement): number {
  let n = 0;
  const walk = (node: ChildNode) => {
    if (node.type === "tag") {
      const t = node as DomElement;
      if (isNonFractionTag(t.name ?? "")) n++;
      for (const c of t.children ?? []) walk(c);
    }
  };
  walk(table);
  return n;
}

function extractTableGrid($: cheerio.CheerioAPI, table: DomElement): string[][] {
  const rows: string[][] = [];
  const $t = $(table);
  $t.find("tr").each((_, tr) => {
    const cells: string[] = [];
    $(tr)
      .find("th,td")
      .each((__, td) => {
        cells.push(cellText($, td as DomElement));
      });
    if (cells.some((c) => c.length > 0)) rows.push(mergeDollarOnlyCellsInRow(cells));
  });
  return rows;
}

function normalizeCellPlainText($frag: cheerio.CheerioAPI, el: DomElement): string {
  return $frag(el).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip NBSP / thin space so “$”-only currency columns still match. */
function compactForCurrencyProbe(s: string): string {
  return s.replace(/[\u00a0\u2009\u2007\u202f\ufeff]/g, "").replace(/\s+/g, "").trim();
}

function parseColspan($frag: cheerio.CheerioAPI, el: DomElement): number {
  const v = parseInt(String($frag(el).attr("colspan") ?? "1"), 10);
  return Number.isFinite(v) && v >= 1 ? v : 1;
}

function isDollarOnlyTextCell($frag: cheerio.CheerioAPI, el: DomElement): boolean {
  const compact = compactForCurrencyProbe($frag(el).text());
  return compact === "$";
}

function displayCellLooksLikeAmount($frag: cheerio.CheerioAPI, el: DomElement): boolean {
  if ($frag(el).find(".ixbrl-nf").length) return true;
  const t = normalizeCellPlainText($frag, el);
  if (!t) return false;
  if (/^\$/.test(t)) return true;
  return /[0-9]/.test(t);
}

function displayAmountCellAlreadyHasDollar($frag: cheerio.CheerioAPI, el: DomElement): boolean {
  if ($frag(el).find(".ixbrl-nf").length) return true;
  return /^\$/.test(normalizeCellPlainText($frag, el));
}

function isPercentOnlyTextCell($frag: cheerio.CheerioAPI, el: DomElement): boolean {
  const c = compactForCurrencyProbe($frag(el).text());
  return c === "%";
}

const CELL_SINGLE_CHILD_UNWRAP_TAGS = new Set(["div", "center", "font", "span"]);

/** SEC tables often nest &lt;div&gt;&lt;p&gt;$&lt;/p&gt;&lt;/div&gt;&lt;div&gt;&lt;p&gt;…&lt;/p&gt; — unwrap so intra-cell merges can see siblings. */
function unwrapSingleChildLayoutWrappersInCell($frag: cheerio.CheerioAPI, cell: DomElement): void {
  for (let g = 0; g < 48; g++) {
    const kids = $frag(cell).children().toArray() as DomElement[];
    let changed = false;
    for (const el of kids) {
      const tag = (el.name ?? "").toLowerCase();
      if (!CELL_SINGLE_CHILD_UNWRAP_TAGS.has(tag)) continue;
      const $el = $frag(el);
      if ($el.children().length !== 1) continue;
      const only = $el.children().first()[0];
      if (!only || only.type !== "tag") continue;
      $el.replaceWith($el.contents());
      changed = true;
      break;
    }
    if (!changed) break;
  }
}

/** Drop whitespace-only / br-only blocks so &quot;$&quot; + blank + amount collapse to adjacent siblings. */
function removeEmptyFormattingNodesInCell($frag: cheerio.CheerioAPI, cell: DomElement): void {
  const $cell = $frag(cell);
  const candidates = $cell.find("p, span, font, div").toArray().reverse() as DomElement[];
  for (const el of candidates) {
    const $el = $frag(el);
    if ($el.find("img, .ixbrl-nf").length) continue;
    $el.find("br").each((__, br) => {
      $frag(br).replaceWith(" ");
    });
    const plain = normalizeCellPlainText($frag, el);
    if (plain === "") $el.remove();
  }
}

/** &lt;td&gt;$…&lt;p&gt;123&lt;/p&gt; — currency run starts as a naked text node before the amount block. */
function mergeLeadingDollarTextNode($frag: cheerio.CheerioAPI, cell: DomElement): void {
  const $cell = $frag(cell);
  const ch = $cell.contents();
  if (ch.length < 2) return;
  const first = ch.first()[0];
  if (!first || first.type !== "text") return;
  const data = (first as Text).data ?? "";
  if (compactForCurrencyProbe(data) !== "$") return;
  const second = ch.eq(1)[0];
  if (!second || second.type !== "tag") return;
  const el2 = second as DomElement;
  if (!displayCellLooksLikeAmount($frag, el2)) return;
  if (displayAmountCellAlreadyHasDollar($frag, el2)) {
    ch.first().remove();
  } else {
    $frag(el2).prepend("$");
    ch.first().remove();
  }
}

function walkTextNodesInElement(el: DomElement, visit: (t: Text) => void): void {
  for (const c of el.children ?? []) {
    if (c.type === "text") visit(c as Text);
    else if (c.type === "tag") walkTextNodesInElement(c as DomElement, visit);
  }
}

/** Collapse EDGAR typography noise inside amount-ish text nodes (parentheticals, % , $ line breaks). */
function normalizeNumericCellTypography(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\u2212/g, "-")
    /** Numeric parentheses only — avoids touching prose like "(Less)". */
    .replace(/\(\s*(\$?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\)/g, "($1)")
    .replace(/\(\s+([\u22120-9,.-])/g, "($1")
    .replace(/([0-9,.-])\s+\)/g, "$1)")
    .replace(/(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+%/g, "$1%")
    .replace(/(\d)\s+(?=%)/g, "$1")
    .replace(/\$\s*\n+\s*/g, "$")
    .replace(/\$\s+(?=[0-9\u2010-\u2013\u2014(])/g, "$");
}

function looksLikeCoalescableAmountCellPlainText(t: string): boolean {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length === 0 || s.length > 160) return false;
  if (!/\d/.test(s)) return false;
  /** Header years and plain period labels */
  if (/^(19|20)\d{2}$/.test(s)) return false;
  if (/[A-Za-z]{4,}/.test(s)) return false;
  return /^[\s0-9$()+\-–—,.%\u2212]+$/u.test(s);
}

/** Insert a space before footnote markers like EBITDA(1) — not "(Less)" (no leading digit in parens). */
function normalizeLabelFootnoteSpacing($frag: cheerio.CheerioAPI, cell: DomElement): void {
  walkTextNodesInElement(cell, (tn) => {
    let d = tn.data;
    d = d.replace(/([A-Za-z])(\(\d+[a-z]?\))/g, "$1 $2");
    d = d.replace(/\s{2,}/g, " ");
    tn.data = d;
  });
}

/**
 * ixBRL often splits &quot;(&quot;, the number, and &quot;)&quot; across sibling blocks — each gets column width
 * and breaks decimal alignment. Collapse to one span when the cell has no rendered facts.
 */
function coalescePlainFinancialAmountCell($frag: cheerio.CheerioAPI, cell: DomElement): boolean {
  if ($frag(cell).find(".ixbrl-nf").length) return false;
  const raw = $frag(cell).text().replace(/\s+/g, " ").trim();
  if (!looksLikeCoalescableAmountCellPlainText(raw)) return false;
  const norm = normalizeNumericCellTypography(raw);
  if (!looksLikeCoalescableAmountCellPlainText(norm)) return false;
  $frag(cell).empty();
  $frag(cell).append($frag("<span></span>").addClass("ixbrl-amt-inline").text(norm));
  return true;
}

/**
 * Tesla-style ixbrl: &lt;td&gt;&lt;p&gt;$&lt;/p&gt;&lt;p&gt;2,561,881&lt;/p&gt;&lt;/td&gt; — same cell, not adjacent &lt;td&gt;s.
 * Merges a leading block that is only "$" into the following amount block so the grid does not stack vertically.
 */
function mergeIntraCellDollarPrefixBlocks($frag: cheerio.CheerioAPI, td: DomElement): void {
  const $td = $frag(td);
  for (let iter = 0; iter < 28; iter++) {
    const children = $td.children().toArray();
    let hit = false;
    for (let j = 0; j < children.length - 1; j++) {
      const a = children[j] as DomElement;
      const b = children[j + 1] as DomElement;
      if (!isDollarOnlyTextCell($frag, a)) continue;
      if (!displayCellLooksLikeAmount($frag, b)) continue;
      if (displayAmountCellAlreadyHasDollar($frag, b)) {
        $frag(a).remove();
      } else {
        $frag(b).prepend("$");
        $frag(a).remove();
      }
      hit = true;
      break;
    }
    if (!hit) break;
  }
}

/** &lt;p&gt;26&lt;/p&gt;&lt;p&gt;%&lt;/p&gt; in the same cell — keep on one line for alignment. */
function mergeIntraCellPercentSuffixBlocks($frag: cheerio.CheerioAPI, td: DomElement): void {
  const $td = $frag(td);
  for (let iter = 0; iter < 28; iter++) {
    const children = $td.children().toArray();
    let hit = false;
    for (let j = 1; j < children.length; j++) {
      const b = children[j] as DomElement;
      if (!isPercentOnlyTextCell($frag, b)) continue;
      const a = children[j - 1] as DomElement;
      if (!displayCellLooksLikeAmount($frag, a)) continue;
      const prevText = normalizeCellPlainText($frag, a);
      if (/%\s*$/.test(prevText)) continue;
      $frag(a).append("%");
      $frag(b).remove();
      hit = true;
      break;
    }
    if (!hit) break;
  }
}

function normalizeInlineFilingAmountPresentation($frag: cheerio.CheerioAPI, table: DomElement): void {
  $frag(table)
    .find("td, th")
    .each((_, cell) => {
      const el = cell as DomElement;
      for (let iter = 0; iter < 16; iter++) {
        unwrapSingleChildLayoutWrappersInCell($frag, el);
        $frag(el).find("br").each((__, br) => {
          $frag(br).replaceWith(" ");
        });
        removeEmptyFormattingNodesInCell($frag, el);
        mergeLeadingDollarTextNode($frag, el);
        mergeIntraCellDollarPrefixBlocks($frag, el);
        mergeIntraCellPercentSuffixBlocks($frag, el);
      }
    });

  /** Many SEC tables omit &lt;tbody&gt;; normalize all data cells, skip a solo label column heuristically. */
  $frag(table)
    .find("tr")
    .each((_, tr) => {
      const cells = $frag(tr as DomElement).find("th, td").toArray() as DomElement[];
      if (cells.length === 0) return;
      normalizeLabelFootnoteSpacing($frag, cells[0]!);
      for (let i = 1; i < cells.length; i++) {
        const el = cells[i]!;
        if (!coalescePlainFinancialAmountCell($frag, el)) {
          walkTextNodesInElement(el, (tn) => {
            tn.data = normalizeNumericCellTypography(tn.data);
          });
        }
      }
    });
}

/**
 * Some filings use a separate &lt;td&gt; for "$" before the amount, which breaks column alignment.
 * Merges that pair (or drops a redundant "$" cell when the amount already includes $).
 */
function mergeAdjacentDollarOnlyCellsInDisplayTable($frag: cheerio.CheerioAPI, table: DomElement): void {
  $frag(table)
    .find("tr")
    .each((_, tr) => {
      const $tr = $frag(tr as DomElement);
      for (let guard = 0; guard < 250; guard++) {
        const ch = $tr.children("th,td");
        if (ch.length < 2) break;
        let mergedOne = false;
        for (let i = 0; i < ch.length - 1; i++) {
          const a = ch.get(i) as DomElement;
          const b = ch.get(i + 1) as DomElement;
          const $a = $frag(a);
          const $b = $frag(b);
          if (($a.attr("colspan") ?? "1") !== "1" || ($a.attr("rowspan") ?? "1") !== "1") continue;
          if (($b.attr("colspan") ?? "1") !== "1" || ($b.attr("rowspan") ?? "1") !== "1") continue;
          if (!isDollarOnlyTextCell($frag, a)) continue;
          if (!displayCellLooksLikeAmount($frag, b)) continue;
          const spanCombined = parseColspan($frag, a) + parseColspan($frag, b);
          if (displayAmountCellAlreadyHasDollar($frag, b)) {
            $b.attr("colspan", String(spanCombined));
            $a.remove();
          } else {
            $b.attr("colspan", String(spanCombined));
            $b.prepend("$");
            $a.remove();
          }
          mergedOne = true;
          break;
        }
        if (!mergedOne) break;
      }
    });
}

function cellStringLooksLikeAmount(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^\$/.test(t)) return true;
  return /[0-9]/.test(t);
}

/**
 * Flattened row from {@link extractTableGrid}: merge a cell that is only "$" with the following amount cell.
 * Exported for unit tests.
 */
export function mergeDollarOnlyCellsInRow(row: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < row.length) {
    const cur = (row[i] ?? "").replace(/\u00a0/g, " ");
    const nextRaw = row[i + 1] ?? "";
    const next = nextRaw.replace(/\u00a0/g, " ");
    const curCompact = compactForCurrencyProbe(cur);
    if (curCompact === "$" && i + 1 < row.length && cellStringLooksLikeAmount(next)) {
      const nt = next.trim();
      if (/^\$/.test(nt)) {
        out.push(nextRaw.trim());
      } else {
        out.push(`$${nt}`);
      }
      i += 2;
      continue;
    }
    out.push(row[i] ?? "");
    i++;
  }
  return out;
}

function bumpReason(map: Record<string, number>, reason: string): void {
  map[reason] = (map[reason] ?? 0) + 1;
}

/**
 * Flatten visible text exactly like historical &lt;table&gt; offset indexing, and record each element’s
 * [start,end) span in that flattened space (end exclusive). `body` span covers the full walk.
 */
export function indexIxbrlBodyFlatText(body: DomElement): {
  flatText: string;
  elementSpans: Map<DomElement, { start: number; end: number }>;
  tableOffsets: Map<DomElement, number>;
} {
  let acc = "";
  const elementSpans = new Map<DomElement, { start: number; end: number }>();
  const tableOffsets = new Map<DomElement, number>();

  const walk = (node: ChildNode) => {
    if (node.type === "text" && node.data) {
      const t = node.data.replace(/\u00a0|\u2009|\u2007/g, " ").replace(/\s+/g, " ").trim();
      if (!t) return;
      /**
       * EDGAR iXBRL often splits "ITEM" across &lt;font&gt; nodes, e.g.
       * &lt;font&gt;I&lt;/font&gt;&lt;font&gt;TEM 2. …&lt;/font&gt; → flat string "I TEM 2." which breaks `\bITEM\s+2` MD&A
       * detection (Tesla 2018 Q1 10-Q and others). Collapse to "ITEM …" when safe (not "PART I" + "TEM…").
       */
      if (
        acc.length > 0 &&
        /(?<!\bPART\s)\bI$/i.test(acc) &&
        /^TEM\b/i.test(t)
      ) {
        acc = acc.slice(0, -1);
        const rest = t.slice(3).trimStart();
        acc += "ITEM" + (rest ? ` ${rest}` : "");
        return;
      }
      acc += (acc.length ? " " : "") + t;
      return;
    }
    if (node.type !== "tag") return;
    const el = node as DomElement;
    const tag = (el.name ?? "").toLowerCase();
    if (tag === "table") tableOffsets.set(el, acc.length);
    const start = acc.length;
    for (const c of el.children ?? []) walk(c);
    elementSpans.set(el, { start, end: acc.length });
  };

  for (const c of body.children ?? []) walk(c);
  elementSpans.set(body, { start: 0, end: acc.length });

  return { flatText: acc, elementSpans, tableOffsets };
}

function collectElementsInTextRange(
  el: DomElement,
  spans: Map<DomElement, { start: number; end: number }>,
  rangeStart: number,
  rangeEnd: number
): DomElement[] {
  const sp = spans.get(el);
  if (!sp) return [];
  const { start: s, end: e } = sp;
  if (e <= rangeStart || s >= rangeEnd) return [];
  if (s >= rangeStart && e <= rangeEnd) return [el];

  const out: DomElement[] = [];
  for (const c of el.children ?? []) {
    if (c.type === "tag") out.push(...collectElementsInTextRange(c as DomElement, spans, rangeStart, rangeEnd));
  }
  if (out.length === 0 && e > rangeStart && s < rangeEnd) return [el];
  return out;
}

function scanFilingTableZones(
  $: cheerio.CheerioAPI,
  form: string,
  includeUncertainBoundaries: boolean
): {
  flatText: string;
  mdnaRange: { start: number; end: number } | null;
  segmentRange: { start: number; end: number } | null;
  mdnaMeta: MdnaBounds | null;
  segmentMeta: SegmentNotePick | null;
  notesMeta: NotesSectionBounds | null;
  tableOffsets: Map<DomElement, number>;
  body: DomElement | null;
  elementSpans: Map<DomElement, { start: number; end: number }>;
} {
  const empty = {
    flatText: "",
    mdnaRange: null as { start: number; end: number } | null,
    segmentRange: null as { start: number; end: number } | null,
    mdnaMeta: null as MdnaBounds | null,
    segmentMeta: null as SegmentNotePick | null,
    notesMeta: null as NotesSectionBounds | null,
    tableOffsets: new Map<DomElement, number>(),
    body: null as DomElement | null,
    elementSpans: new Map<DomElement, { start: number; end: number }>(),
  };

  /** Some EDGAR iXBRL shells use a sparse or missing `body`; fall back to `html`. */
  const body = ($("body").get(0) ?? $("html").get(0)) as DomElement | undefined;
  if (!body) return empty;

  const indexed = indexIxbrlBodyFlatText(body);
  const acc = indexed.flatText;

  const mdnaMeta = findMdnaBounds(acc, form);
  let mdnaRange: { start: number; end: number } | null = null;
  if (mdnaMeta && (includeUncertainBoundaries || mdnaMeta.confidence !== "low")) {
    mdnaRange = { start: mdnaMeta.start, end: mdnaMeta.end };
  }

  const notesMeta = buildNotesSectionBounds(acc, form);
  const segmentPick = notesMeta ? findBestSegmentNoteRange(acc, notesMeta) : null;
  let segmentRange: { start: number; end: number } | null = null;
  if (segmentPick && (includeUncertainBoundaries || segmentPick.confidence !== "low")) {
    segmentRange = { start: segmentPick.start, end: segmentPick.end };
  }

  return {
    flatText: acc,
    mdnaRange,
    segmentRange,
    mdnaMeta,
    segmentMeta: segmentPick,
    notesMeta,
    tableOffsets: indexed.tableOffsets,
    body,
    elementSpans: indexed.elementSpans,
  };
}

function truncateCaption(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Heading text often sits in a block immediately before the `<table>` (or multiple blocks up). */
function tableCaption($: cheerio.CheerioAPI, table: DomElement): string | null {
  const $t = $(table);
  const cap = $t.find("> caption").first().text().trim();
  if (cap) return truncateCaption(cap, 200);

  const blockTags = new Set([
    "p",
    "div",
    "font",
    "span",
    "strong",
    "b",
    "center",
    "em",
    "i",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ]);
  let sib = $t.prev();
  for (let i = 0; i < 12 && sib.length; i++) {
    const el = sib.get(0) as DomElement | undefined;
    const tag = (el?.name ?? "").toLowerCase();
    if (blockTags.has(tag)) {
      const t = sib.text().replace(/\s+/g, " ").trim();
      const minLen = /^h[1-6]$/.test(tag) ? 6 : 10;
      if (t.length >= minLen && t.length < 360 && !/^\d{1,2}\s*$/.test(t)) {
        return truncateCaption(t, 240);
      }
    }
    sib = sib.prev();
  }
  return null;
}

/**
 * Filing tables use `class="…"` tied to a document stylesheet we do not ship; leftover rules + inline
 * backgrounds on nested tags produce black bands and heavy borders on a dark app theme.
 */
/**
 * Press releases / iXBRL tables often insert spacer columns (empty &lt;td&gt;s) before the label column or
 * between labels and amounts. Our viewer styles `td:first-child` as the label column and right-aligns other
 * cells — spacers must be removed or labels render right-aligned with a huge gap.
 *
 * Iteratively drops column index `c` when every cell in that column (on a uniform grid) or every cell on
 * **widest** rows (when header/footer ragged) is effectively empty. Removal runs on **each** row so short
 * header rows lose the same gutter columns when their cells are empty.
 */
function collapseUniformEmptyColumnsInDisplayTable($frag: cheerio.CheerioAPI, table: DomElement): void {
  const $table = $frag(table);
  const rows = $table.find("tr").toArray();
  if (rows.length === 0) return;

  const maxPasses = 64;
  for (let pass = 0; pass < maxPasses; pass++) {
    const widths = rows.map((tr) => $frag(tr).children("td, th").length);
    const maxW = Math.max(0, ...widths);
    const minW = Math.min(...widths);
    if (maxW <= 1) break;

    const uniformGrid = minW === maxW;
    const wideRowIdx = widths.map((w, i) => (w === maxW ? i : -1)).filter((i) => i >= 0);
    if (!uniformGrid && wideRowIdx.length === 0) break;

    let removeCol: number | null = null;
    for (let c = 0; c < maxW; c++) {
      let allEmpty = true;
      if (uniformGrid) {
        for (const tr of rows) {
          const cells = $frag(tr).children("td, th");
          const cell = cells.get(c) as DomElement | undefined;
          if (!cell || !isEffectivelyEmptySimpleCell($frag, cell)) {
            allEmpty = false;
            break;
          }
        }
      } else {
        for (const i of wideRowIdx) {
          const tr = rows[i]!;
          const cells = $frag(tr).children("td, th");
          const cell = cells.get(c) as DomElement | undefined;
          if (!cell || !isEffectivelyEmptySimpleCell($frag, cell)) {
            allEmpty = false;
            break;
          }
        }
      }
      if (allEmpty) {
        removeCol = c;
        break;
      }
    }
    if (removeCol == null) break;

    for (const tr of rows) {
      const cells = $frag(tr).children("td, th");
      if (removeCol >= cells.length) continue;
      const el = cells.get(removeCol) as DomElement | undefined;
      if (el && isSimpleOneByOneCell($frag, el) && isEffectivelyEmptySimpleCell($frag, el)) {
        cells.eq(removeCol).remove();
      }
    }
  }
}

function parseGridSpan(raw: string | undefined): number {
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function isSimpleOneByOneCell($frag: cheerio.CheerioAPI, cell: DomElement): boolean {
  const $c = $frag(cell);
  return parseGridSpan($c.attr("colspan")) === 1 && parseGridSpan($c.attr("rowspan")) === 1;
}

function isEffectivelyEmptySimpleCell($frag: cheerio.CheerioAPI, cell: DomElement): boolean {
  if (!isSimpleOneByOneCell($frag, cell)) return false;
  const $c = $frag(cell);
  if ($c.find("img, svg, picture, span.ixbrl-nf").length > 0) return false;

  let h = ($c.html() ?? "")
    .replace(/&nbsp;|&#160;|&#x0*A0;/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/\s*p\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2000-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (h.length === 0) return true;
  /** Gutters: dash, bullet, middot, thin space run */
  if (/^[-–—.\u2022•·⋅…\s]+$/u.test(h)) return true;
  return false;
}

function stripTablePresentationForTableRoot($frag: cheerio.CheerioAPI, table: DomElement): void {
  $frag(table)
    .find("*")
    .addBack()
    .each((_, node) => {
    if (node.type !== "tag") return;
    const el = node as DomElement;
    const $el = $frag(el);
    const tag = (el.name ?? "").toLowerCase();

    $el.removeAttr("bgcolor");

    if (tag === "caption") {
      $el.removeAttr("style").removeAttr("class").addClass("ixbrl-table-caption");
      return;
    }
    if (tag === "table") {
      $el.removeAttr("class");
      $el.removeAttr("style");
      $el.removeAttr("border");
      $el.removeAttr("cellpadding");
      $el.removeAttr("cellspacing");
      $el.removeAttr("width");
      $el.removeAttr("align");
      return;
    }
    if (tag === "span" && /\bixbrl-nf\b/.test($el.attr("class") ?? "")) {
      $el.removeAttr("style");
      return;
    }

    if (tag === "td" || tag === "th" || tag === "col" || tag === "colgroup" || tag === "tr") {
      $el.removeAttr("width");
    }
    if (tag === "td" || tag === "th") {
      $el.removeAttr("align");
    }

    $el.removeAttr("class");
    $el.removeAttr("style");
  });
}

/**
 * Serialize the filing `<table>` so colspan/rowspan stay intact. Strip scripts/event handlers; replace
 * `ix:nonFraction` nodes with formatted $M text (plain `<span>`) for display.
 */
/** Same scrub applied to extracted `tableHtml` snapshots; exported for Vitest. */
export function buildDisplayTableHtml(
  $: cheerio.CheerioAPI,
  table: DomElement,
  opts?: BuildDisplayTableHtmlOptions
): string | null {
  let raw: string;
  try {
    raw = $.html(table);
  } catch {
    return null;
  }
  if (!raw || raw.length > MAX_TABLE_HTML_CHARS) return null;

  let $frag: cheerio.CheerioAPI;
  try {
    $frag = cheerio.load(`<div class="ixbrl-table-wrap">${raw}</div>`);
  } catch {
    return null;
  }

  const wrap = $frag("div.ixbrl-table-wrap");
  if (!wrap.length) return null;

  scrubIxbrlFragmentForDisplay($frag, wrap, opts);

  const inner = wrap.html();
  return inner && inner.length > 0 ? inner : null;
}

type ScrubIxbrlFragmentOptions = BuildDisplayTableHtmlOptions;

/** Drop `text-indent: -…` from inline `style` so hanging-indent row labels are not clipped after margin resets. */
function stripNegativeTextIndentFromInlineStyle($frag: cheerio.CheerioAPI, el: DomElement): void {
  const $el = $frag(el);
  const style = ($el.attr("style") ?? "").trim();
  if (!style || !/text-indent\s*:\s*-/i.test(style)) return;
  const parts = style
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((decl) => !/^text-indent\s*:/i.test(decl));
  const next = parts.join("; ").trim();
  if (next) $el.attr("style", next);
  else $el.removeAttr("style");
}

/**
 * Legacy EDGAR tables use hanging indents on row labels: `text-indent` negative with `margin-left` positive, often on
 * `p` but also `div` / `font` / `span`. Strip negative `text-indent` from cells and any styled descendants.
 */
function stripNegativeTextIndentInTableCells($frag: cheerio.CheerioAPI, root: cheerio.Cheerio<DomElement>): void {
  root.find("table td, table th").each((_, node) => {
    if (node.type !== "tag") return;
    const cell = node as DomElement;
    stripNegativeTextIndentFromInlineStyle($frag, cell);
    $frag(cell)
      .find("*")
      .each((_, child) => {
        if (child.type !== "tag") return;
        stripNegativeTextIndentFromInlineStyle($frag, child as DomElement);
      });
  });
}

function scrubIxbrlFragmentForDisplay(
  $frag: cheerio.CheerioAPI,
  root: cheerio.Cheerio<DomElement>,
  opts?: ScrubIxbrlFragmentOptions
): void {
  root.find("script,style,iframe,object,embed,link,meta,base").remove();
  root.find("form").remove();

  root.find("*").each((_, node) => {
    if (node.type !== "tag") return;
    const el = node as DomElement;
    const $el = $frag(el);
    const attribs = el.attribs ?? {};
    for (const key of Object.keys(attribs)) {
      if (/^on/i.test(key)) {
        $el.removeAttr(key);
        continue;
      }
      if (key === "href" && /^\s*javascript:/i.test(String(attribs[key] ?? ""))) {
        $el.removeAttr("href");
      }
      if (key === "src" && /^\s*javascript:/i.test(String(attribs[key] ?? ""))) {
        $el.removeAttr("src");
      }
    }
  });

  const nfEls: DomElement[] = [];
  root.find("*").each((_, node) => {
    if (node.type !== "tag") return;
    const el = node as DomElement;
    if (isNonFractionTag(el.name ?? "")) nfEls.push(el);
  });
  for (const el of nfEls) {
    const fmt = parseNonFractionUsd($frag, el);
    if (fmt != null) $frag(el).replaceWith(`<span class="ixbrl-nf">${fmt}</span>`);
  }

  stripNegativeTextIndentInTableCells($frag, root);

  if (opts?.fidelity === "filing") return;

  root.find("table").each((_, tbl) => {
    const t = tbl as DomElement;
    stripTablePresentationForTableRoot($frag, t);
    /** Merge $ + amount cells before column collapse so spacer &lt;td&gt;s between amount columns disappear. */
    mergeAdjacentDollarOnlyCellsInDisplayTable($frag, t);
    collapseUniformEmptyColumnsInDisplayTable($frag, t);
    normalizeInlineFilingAmountPresentation($frag, t);
  });
}

export function buildMdnaSectionDisplayHtml(
  $: cheerio.CheerioAPI,
  body: DomElement,
  spans: Map<DomElement, { start: number; end: number }>,
  mdnaRange: { start: number; end: number } | null
): { html: string | null; truncated: boolean } {
  if (!mdnaRange) return { html: null, truncated: false };

  const parts = collectElementsInTextRange(body, spans, mdnaRange.start, mdnaRange.end);
  if (parts.length === 0) return { html: null, truncated: false };

  const chunks: string[] = [];
  for (const p of parts) {
    try {
      const h = $.html(p);
      if (h) chunks.push(h);
    } catch {
      /* skip */
    }
  }

  const joined = chunks.join("");
  if (!joined.trim()) return { html: null, truncated: false };

  let $frag: cheerio.CheerioAPI;
  try {
    $frag = cheerio.load(`<div class="ixbrl-mdna-section-root">${joined}</div>`);
  } catch {
    return { html: null, truncated: false };
  }

  const root = $frag("div.ixbrl-mdna-section-root");
  if (!root.length) return { html: null, truncated: false };

  /** Same as press-release / EBITDA viewers: keep issuer `colspan` / `rowspan` and width hints — “app” transforms flatten complex MD&A segment tables. */
  scrubIxbrlFragmentForDisplay($frag, root, { fidelity: "filing" });

  let inner = root.html() ?? "";
  let truncated = false;
  if (inner.length > MAX_MDNA_SECTION_HTML_CHARS) {
    inner =
      inner.slice(0, MAX_MDNA_SECTION_HTML_CHARS) +
      `<p class="ixbrl-mdna-truncated-note" style="opacity:0.75">… truncated (${inner.length.toLocaleString()} characters)</p>`;
    truncated = true;
  }

  return { html: inner.length ? `<div class="ixbrl-mdna-section-root">${inner}</div>` : null, truncated };
}

function boundaryConfRank(c: string | undefined): number {
  if (c === "high") return 3;
  if (c === "medium") return 2;
  return 1;
}

function inferTableConfidence(
  section: IxbrlFilingSection,
  mdnaMeta: MdnaBounds | null,
  segmentMeta: SegmentNotePick | null,
  rows: string[][],
  factCount: number
): TableConfidence {
  const b =
    section === "mdna"
      ? boundaryConfRank(mdnaMeta?.confidence)
      : boundaryConfRank(segmentMeta?.confidence);
  const plausible = isPlausibleDataTable(rows, factCount, { narrativeFinancialSection: true });
  const strongFacts = factCount >= 1 || /\d/.test(rows.flat().join(" "));
  const dataRank = strongFacts ? 3 : plausible ? 2 : 1;
  const r = Math.min(b, dataRank);
  return r >= 3 ? "high" : r >= 2 ? "medium" : "low";
}

function inclusionReasonLine(section: IxbrlFilingSection, conf: TableConfidence): string {
  return `${section === "mdna" ? "MD&A" : "Segment note"} · ${conf} confidence · inside validated section bounds`;
}

/**
 * Replace Unicode hyphen / dash characters with ASCII `-` so phrases like `Non–GAAP` / `Non‑GAAP`
 * match `non-gaap` patterns (SEC HTML often uses en dash or non-breaking hyphen).
 * Exported for unit tests.
 */
export function normalizeFilingPhraseHyphens(s: string): string {
  return s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\u00ad]/g, "-");
}

/** `non`, optional dash/space run, `gaap` — after {@link normalizeFilingPhraseHyphens}. */
const RE_NON_GAAP_GAP = "non[-\\s]*gaap";

/**
 * Detects common non-GAAP / adjusted earnings measures (EBITDA family and EPS / operating income / net income wording).
 * Exported for unit tests.
 */
export function filingTextMentionsEbitdaMeasures(s: string): boolean {
  if (!s || s.length < 4) return false;
  const t = normalizeFilingPhraseHyphens(s).toLowerCase();
  const hasNonGaap = new RegExp(`\\b${RE_NON_GAAP_GAP}\\b`).test(t);
  if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+net\\s+income\\b`).test(t)) return true;
  if (/\bnet\s+income\s*\([^)]*non[-\s]*gaap/.test(t)) return true;
  if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+operating\\s+income\\b`).test(t)) return true;
  if (/\badjusted\s+operating\s+income\b/.test(t)) return true;
  if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+earnings\\b`).test(t)) return true;
  if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+(diluted\\s+)?eps\\b`).test(t)) return true;
  /** Words between (e.g. "Non-GAAP diluted earnings per share") */
  if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+[^.\\n]{0,48}\\bearnings\\s+per\\s+share\\b`).test(t)) return true;
  /** Reconciliation tables often label "GAAP net income" / "GAAP diluted EPS" with a Non-GAAP total in the same grid. */
  if (/\bgaap\s+net\s+income\b/.test(t) && hasNonGaap) return true;
  if (
    (/\bgaap\s+diluted\s+earnings\s+per\s+share\b/.test(t) || /\bgaap\s+diluted\s+eps\b/.test(t)) &&
    hasNonGaap
  ) {
    return true;
  }
  /**
   * Cash-flow bridge in the same grid as Non-GAAP earnings (multi-section earnings tables: net income + EPS + FCF).
   */
  if (
    hasNonGaap &&
    /\bfree\s+cash\s+flow\b/.test(t) &&
    /\bnet\s+cash\s+provided\s+by\s+operating\s+activities\b/.test(t)
  ) {
    return true;
  }
  if (/\boibtda\b/.test(t)) return true;
  if (/\badj\.?\s*ebitda\b/.test(t)) return true;
  if (/\badjusted\s+ebitda\b/.test(t)) return true;
  if (/\bai\s*ebitda\b/.test(t)) return true;
  if (/\boperating\s+ebitda\b/.test(t)) return true;
  if (/\bebitda\b/.test(t)) return true;
  return false;
}

/** Caption + table grid text (long files: head + tail) so EBITDA rows below row 12 are still detected. */
function tableHaystackForEbitda($: cheerio.CheerioAPI, table: DomElement, rows: string[][]): string {
  const cap = tableCaption($, table) ?? "";
  const fromRows = rows.map((r) => r.join(" ")).join("\n");
  const wholeTableText = normalizeCellText($(table).text());
  let body = fromRows === wholeTableText ? fromRows : `${fromRows}\n${wholeTableText}`;
  const maxLen = 16_000;
  if (body.length > maxLen) {
    const head = body.slice(0, 12_000);
    const tail = body.slice(-3500);
    body = `${head}\n…\n${tail}`;
  }
  return `${cap}\n${body}`;
}

function scoreEbitdaCandidate(haystack: string, inMdna: boolean, factCount: number): number {
  const h = normalizeFilingPhraseHyphens(haystack).toLowerCase();
  const hasNonGaap = new RegExp(`\\b${RE_NON_GAAP_GAP}\\b`).test(h);
  const gaapNet = /\bgaap\s+net\s+income\b/.test(h);
  const gaapDilEps =
    /\bgaap\s+diluted\s+earnings\s+per\s+share\b/.test(h) || /\bgaap\s+diluted\s+eps\b/.test(h);
  let score = 0;
  if (/\badjusted\b/.test(h) && /\bebitda\b/.test(h)) score += 45;
  else if (/\badj\.?\s*ebitda\b/.test(h)) score += 42;
  else if (/\boibtda\b/.test(h)) score += 40;
  else if (
    new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+net\\s+income\\b`).test(h) ||
    /\bnet\s+income\s*\([^)]*non[-\s]*gaap/.test(h)
  ) {
    score += 34;
  } else if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+operating\\s+income\\b`).test(h)) score += 34;
  else if (/\badjusted\s+operating\s+income\b/.test(h)) score += 34;
  else if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+earnings\\b`).test(h)) score += 32;
  else if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+(diluted\\s+)?eps\\b`).test(h)) score += 32;
  else if (new RegExp(`\\b${RE_NON_GAAP_GAP}\\s+[^.\\n]{0,48}\\bearnings\\s+per\\s+share\\b`).test(h)) score += 32;
  else if (gaapNet && hasNonGaap) score += 33;
  else if (gaapDilEps && hasNonGaap) score += 33;
  else if (/\boperating\s+ebitda\b/.test(h)) score += 35;
  else if (/\bebitda\b/.test(h)) score += 28;
  else if (
    hasNonGaap &&
    /\bfree\s+cash\s+flow\b/.test(h) &&
    /\bnet\s+cash\s+provided\s+by\s+operating\s+activities\b/.test(h)
  ) {
    score += 30;
  }
  if (hasNonGaap && /\bebitda\b/.test(h)) score += 12;
  if (/reconcil/.test(h) && /\bebitda\b/.test(h)) score += 10;
  if (/reconcil/.test(h) && hasNonGaap) score += 8;
  if (inMdna) score += 18;
  score += Math.min(20, factCount * 4);
  return score;
}

type EbitdaCand = {
  off: number;
  score: number;
  caption: string | null;
  tableHtml: string | null;
  inMdna: boolean;
  factCount: number;
};

function buildEbitdaReconciliationPayload(
  $: cheerio.CheerioAPI,
  tableOffsets: Map<DomElement, number>,
  mdnaRange: { start: number; end: number } | null,
  flatText: string
): IxbrlEbitdaReconciliation {
  /** One candidate per &lt;table&gt; (text offset). Never dedupe by row JSON — distinct EBITDA tables often share similar “revenue / net income” header rows and were collapsing to a single result. */
  const byOff = new Map<number, EbitdaCand>();

  for (const [tbl, off] of Array.from(tableOffsets.entries())) {
    const rows = extractTableGrid($, tbl);
    if (rows.length === 0) continue;

    const factCount = countNonFractionsInTable(tbl);
    if (!isPlausibleDataTable(rows, factCount, { narrativeFinancialSection: true })) continue;
    if (isLikelyTableOfContents(rows)) continue;

    const hay = tableHaystackForEbitda($, tbl, rows);
    if (!filingTextMentionsEbitdaMeasures(hay)) continue;

    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (factCount < 1 && (rows.length < 2 || colCount < 2)) continue;

    const inMdna = mdnaRange !== null && off >= mdnaRange.start && off < mdnaRange.end;
    const score = scoreEbitdaCandidate(hay, inMdna, factCount);
    if (score < 26) continue;

    const caption = tableCaption($, tbl);
    const tableHtml = buildDisplayTableHtml($, tbl, { fidelity: "filing" });
    if (!tableHtml) continue;
    const cand: EbitdaCand = { off, score, caption, tableHtml, inMdna, factCount };
    const prev = byOff.get(off);
    if (!prev || cand.score > prev.score) byOff.set(off, cand);
  }

  const sorted = [...byOff.values()].sort((a, b) => b.score - a.score || a.off - b.off);

  if (sorted.length > 0) {
    return {
      status: "tables",
      tables: sorted.map((c) => ({
        caption: c.caption,
        tableHtml: c.tableHtml,
        inMdna: c.inMdna,
        factCount: c.factCount,
        textOffset: c.off,
      })),
    };
  }

  const mdnaSlice =
    mdnaRange !== null && flatText.length > 0
      ? flatText.slice(mdnaRange.start, Math.min(mdnaRange.end, flatText.length))
      : "";

  if (filingTextMentionsEbitdaMeasures(mdnaSlice) || filingTextMentionsEbitdaMeasures(flatText)) {
    return { status: "mention_only", tables: [] };
  }

  return { status: "none", tables: [] };
}

/**
 * Scan a single EDGAR HTML document for EBITDA / Adjusted EBITDA–style reconciliation tables.
 * Used for periodic filings and for supplemental earnings 8-K exhibits.
 */
export function extractEbitdaReconciliationFromIxbrlHtml(
  html: string,
  form: string,
  opts?: { includeUncertainBoundaries?: boolean }
): IxbrlEbitdaReconciliation {
  if (!html || html.length < 500) return { status: "none", tables: [] };
  const $ = cheerio.load(html);
  const formUpper = (form ?? "").toUpperCase();
  const is10q = formUpper.includes("10-Q");
  const includeUncertainBoundaries =
    opts?.includeUncertainBoundaries === true ? true : opts?.includeUncertainBoundaries === false ? false : is10q;
  const { mdnaRange, tableOffsets, flatText } = scanFilingTableZones($, form, includeUncertainBoundaries);
  return buildEbitdaReconciliationPayload($, tableOffsets, mdnaRange, flatText);
}

export async function fetchIxbrlMdnaTablesFromFiling(params: {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  form: string;
  /** Include MD&A / segment spans when boundary confidence is Low. Defaults to true; pass false to require high/medium only. */
  includeUncertainBoundaries?: boolean;
  /** Include tables whose combined structure confidence is Low. Omit on 10-Q to default on; pass false to opt out. */
  includeLowConfidenceTables?: boolean;
}): Promise<IxbrlMdnaTablesPayload> {
  const doc = (params.primaryDocument ?? "").trim();
  if (!doc) return { ok: false, error: "Missing primary document" };

  const accClean = accNoDashes(params.accessionNumber);
  if (!accClean) return { ok: false, error: "Invalid accession" };

  const folderCiks = edgarArchivesFolderCikCandidates(params.cik, params.accessionNumber);
  if (folderCiks.length === 0) return { ok: false, error: "Invalid CIK" };

  let html: string | null = null;
  let lastHttpStatus: number | null = null;
  for (const cikPad of folderCiks) {
    const pathCik = parseInt(cikPad.replace(/\D/g, ""), 10);
    if (!Number.isFinite(pathCik) || pathCik <= 0) continue;
    const url = `https://www.sec.gov/Archives/edgar/data/${pathCik}/${accClean}/${encodeURIComponent(doc)}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "text/html,*/*" } });
      if (!res.ok) {
        lastHttpStatus = res.status;
        continue;
      }
      const t = await res.text();
      if (t && t.length >= 500) {
        html = t;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!html) {
    return {
      ok: false,
      error:
        lastHttpStatus != null ? `SEC fetch failed (${lastHttpStatus})` : "SEC fetch failed (no reachable archive folder)",
    };
  }

  /**
   * Default: include MD&A / segment spans even when heading heuristics mark confidence Low (still bounded
   * by Item 7/7A/8-style anchors). Annual reports used to default off for 10-K only, which dropped whole
   * MD&A HTML/table slices for some issuers unless callers passed `?uncertain=1`.
   */
  const includeUncertainBoundaries = params.includeUncertainBoundaries !== false;
  const formUpper = (params.form ?? "").toUpperCase();
  const is10q = formUpper.includes("10-Q");
  const includeLowConfidenceTables =
    params.includeLowConfidenceTables === false
      ? false
      : params.includeLowConfidenceTables === true
        ? true
        : is10q;

  const $ = cheerio.load(html);
  const { mdnaRange, segmentRange, mdnaMeta, segmentMeta, notesMeta, tableOffsets, body, elementSpans, flatText } =
    scanFilingTableZones($, params.form, includeUncertainBoundaries);

  const ebitdaReconciliation = buildEbitdaReconciliationPayload($, tableOffsets, mdnaRange, flatText);

  const mdnaSectionBlock =
    body ? buildMdnaSectionDisplayHtml($, body, elementSpans, mdnaRange) : { html: null as string | null, truncated: false };

  const mdnaHeadingFound = mdnaMeta !== null;
  const segmentHeadingFound = segmentMeta !== null;

  const rejectionReasons: Record<string, number> = {};
  let taggedInMdna = 0;
  let taggedInSegment = 0;
  for (const [, off] of tableOffsets) {
    if (mdnaRange && off >= mdnaRange.start && off < mdnaRange.end) taggedInMdna++;
    if (segmentRange && off >= segmentRange.start && off < segmentRange.end) taggedInSegment++;
  }

  type Tagged = { el: DomElement; offset: number; section: IxbrlFilingSection };
  const picked: Tagged[] = [];

  for (const [tbl, off] of Array.from(tableOffsets.entries())) {
    let section: IxbrlFilingSection | null = null;
    if (mdnaRange && off >= mdnaRange.start && off < mdnaRange.end) section = "mdna";
    else if (segmentRange && off >= segmentRange.start && off < segmentRange.end) section = "segment";
    if (section) picked.push({ el: tbl, offset: off, section });
  }

  picked.sort((a, b) => a.offset - b.offset);

  const seen = new Set<string>();
  const out: IxbrlHtmlTable[] = [];
  let idx = 0;
  let rejected = 0;

  for (const { el, offset: off, section } of picked) {
    if (out.length >= MAX_TABLES_RETURNED) break;
    const rows = extractTableGrid($, el);
    if (rows.length === 0) {
      bumpReason(rejectionReasons, "empty_grid");
      rejected++;
      continue;
    }

    const factCount = countNonFractionsInTable(el);
    if (!isPlausibleDataTable(rows, factCount, { narrativeFinancialSection: true })) {
      bumpReason(rejectionReasons, "not_plausible_data_table");
      rejected++;
      continue;
    }
    if (isLikelyTableOfContents(rows)) {
      bumpReason(rejectionReasons, "likely_table_of_contents");
      rejected++;
      continue;
    }

    const sig = JSON.stringify(rows).slice(0, 6000);
    if (seen.has(sig)) {
      bumpReason(rejectionReasons, "duplicate_table");
      rejected++;
      continue;
    }
    seen.add(sig);

    const tConf = inferTableConfidence(section, mdnaMeta, segmentMeta, rows, factCount);
    if (!includeLowConfidenceTables && tConf === "low") {
      bumpReason(rejectionReasons, "low_confidence_table");
      rejected++;
      continue;
    }

    const caption = tableCaption($, el);
    const tableHtml = buildDisplayTableHtml($, el);

    out.push({
      id: `ix-html-${idx++}`,
      caption,
      rows,
      tableHtml,
      factCount,
      section,
      textOffset: off,
      confidence: tConf,
      inclusionReason: inclusionReasonLine(section, tConf),
    });
  }

  const diagnostics: IxbrlExtractionDiagnostics = {
    form: params.form,
    mdna: {
      found: mdnaMeta !== null,
      startOffset: mdnaMeta?.start,
      endOffset: mdnaMeta?.end,
      startLabel: mdnaMeta?.startMatchLabel,
      endLabel: mdnaMeta?.endMatchLabel,
      confidence: mdnaMeta?.confidence,
      warnings: mdnaMeta?.warnings ?? [],
      rangeUsedForExtraction: mdnaRange !== null,
    },
    notes: {
      found: notesMeta !== null,
      startOffset: notesMeta?.start,
      endOffset: notesMeta?.end,
      headingFound: notesMeta?.notesHeadingFound,
    },
    segmentNote: {
      found: segmentMeta !== null,
      heading: segmentMeta?.headingText,
      score: segmentMeta?.score,
      confidence: segmentMeta?.confidence,
      warnings: segmentMeta?.warnings ?? [],
      rangeUsedForExtraction: segmentRange !== null,
    },
    tables: {
      totalInDocument: tableOffsets.size,
      taggedInMdnaRange: taggedInMdna,
      taggedInSegmentRange: taggedInSegment,
      included: out.length,
      rejected,
    },
    rejectionReasons,
  };

  return {
    ok: true,
    primaryDocument: doc,
    mdnaHeadingFound,
    segmentHeadingFound,
    mdnaTableHit: out.length > 0,
    mdnaSectionHtml: mdnaSectionBlock.html,
    mdnaSectionHtmlTruncated: mdnaSectionBlock.truncated,
    tables: out,
    diagnostics,
    ebitdaReconciliation,
  };
}
