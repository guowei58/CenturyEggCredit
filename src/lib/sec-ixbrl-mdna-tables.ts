/**
 * Extract HTML tables from MD&A and segment-information notes in the filing's primary Inline XBRL document.
 * Resolves ix:nonFraction values (scale/sign) to USD for display when present.
 */

import * as cheerio from "cheerio";
import type { ChildNode, Element as DomElement } from "domhandler";

import { SEC_EDGAR_USER_AGENT } from "@/lib/sec-edgar";

export type IxbrlFilingSection = "mdna" | "segment";

export type IxbrlHtmlTable = {
  id: string;
  caption: string | null;
  /** Plain-text / formatted numeric cells (row-major); colspan/rowspan are flattened so columns may misalign. */
  rows: string[][];
  /** When set, prefer this in the UI — preserves colspan/rowspan from the filing. */
  tableHtml: string | null;
  factCount: number;
  section: IxbrlFilingSection;
};

export type IxbrlMdnaTablesPayload =
  | {
      ok: true;
      primaryDocument: string;
      /** Item 7 / Item 2 bounds detected (or loose MD&A title fallback). */
      mdnaHeadingFound: boolean;
      /** Segment-style note heading found after the financial statements item (when detectable). */
      segmentHeadingFound: boolean;
      /** At least one table returned from MD&A or segment section. */
      mdnaTableHit: boolean;
      tables: IxbrlHtmlTable[];
    }
  | { ok: false; error: string };

const MAX_TABLES_RETURNED = 250;
/** Above this, skip HTML snapshot (still return row grid for dedupe / accessibility). */
const MAX_TABLE_HTML_CHARS = 400_000;

/**
 * SEC Inline XBRL often uses `<table>` for bullets or a single narrative row (layout, not a financial grid).
 * When there are no `ix:nonFraction` tags, require a minimal 2×2-style grid so we do not surface prose blocks.
 */
function isPlausibleDataTable(rows: string[][], factCount: number): boolean {
  if (factCount >= 1) return true;

  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const nonEmpty = rows.flat().map((c) => c.trim()).filter((c) => c.length > 0);
  const cellCount = nonEmpty.length;
  const maxCellLen = nonEmpty.length ? Math.max(...nonEmpty.map((c) => c.length)) : 0;

  if (colCount < 2) return false;
  if (cellCount < 4) return false;

  if (rows.length < 2) {
    if (rows.length !== 1) return false;
    if (colCount < 4) return false;
    if (maxCellLen > 72) return false;
    return true;
  }

  if (maxCellLen > 280 && cellCount <= 6) return false;

  const digitish = /(?:\d[\d,]{0,14}(?:\.\d+)?|\(\d[\d,]*\)|%|\$[0-9]|\b20\d{2}\b)/;
  const cellsWithNumberHint = nonEmpty.filter((c) => digitish.test(c)).length;
  if (rows.length >= 2 && colCount >= 2 && cellCount >= 4 && cellsWithNumberHint === 0 && maxCellLen > 120) {
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
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  });
  return rows;
}

/** Real MD&A narrative is much longer than a single TOC row (Item 7 … page 46 …). */
const MIN_MDNA_SPAN_CHARS = 4000;

/**
 * Many 10-Ks cite "Item 8. Financial Statements and Supplementary Data" inside MD&A (cross-references to notes).
 * Those matches must not end the MD&A range — only the real Part II Item 8 heading / transition should.
 */
function isItem8FinancialStatementsCrossReference(acc: string, item8MatchStart: number): boolean {
  const w = acc.slice(item8MatchStart, item8MatchStart + 200);
  const m = w.match(/\bITEM\s+8[\.\u2014\u2013\-]\s*Financial\s+Statements\s+and\s+Supplementary\s+Data/i);
  if (!m) return false;
  const rel = w.slice((m.index ?? 0) + m[0].length);
  const t = rel.trimStart();
  if (/^[,;]/.test(t)) return true;
  if (/^["\u201c\u201d]/.test(t)) return true;
  if (/^\.\s*[\u201c\u201d\u2018\u2019"]+\s*[A-Za-z]/.test(t)) return true;
  if (/^\.\s+[a-z]/.test(t)) return true;
  return false;
}

function findMdnaEndCharIndex(acc: string, form: string, start: number): number {
  const is10K = form.includes("10-K");
  const tail = acc.slice(start + 1);

  if (is10K) {
    const strong = /\bITEM\s+8[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi;
    let sm: RegExpExecArray | null;
    while ((sm = strong.exec(tail)) !== null) {
      const abs = start + 1 + sm.index;
      if (!isItem8FinancialStatementsCrossReference(acc, abs)) return abs;
    }
  } else {
    const strong = /\bITEM\s+3[\.\u2014\-]\s*QUANTITATIVE\b/gi;
    const sm = strong.exec(tail);
    if (sm && sm.index >= 0) return start + 1 + sm.index;
  }

  const stopN = is10K ? "8" : "3";
  const weak = new RegExp(`\\bITEM\\s+${stopN}\\b`, "gi");
  let wm: RegExpExecArray | null;
  const proseStop = new RegExp(`^item\\s+${stopN}\\s+of\\b`, "i");
  while ((wm = weak.exec(tail)) !== null) {
    const abs = start + 1 + wm.index;
    const after = acc.slice(abs, abs + 28).toLowerCase();
    if (proseStop.test(after)) continue;
    return abs;
  }

  return acc.length;
}

function findMdnaCharRangeInFlatText(acc: string, form: string): { start: number; end: number } | null {
  const is10K = form.includes("10-K");
  const itemN = is10K ? "7" : "2";
  const itemStartRe = new RegExp(`\\bITEM\\s+${itemN}\\b`, "gi");

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemStartRe.exec(acc)) !== null) {
    starts.push(m.index);
    if (starts.length > 64) break;
  }
  if (starts.length === 0) return null;

  const proseLead = new RegExp(`item\\s+${itemN}\\s+of\\b`, "i");

  let best: { start: number; end: number; span: number } | null = null;

  for (const start of starts) {
    const lead = acc.slice(start, start + 36).toLowerCase();
    if (proseLead.test(lead)) continue;

    if (is10K) {
      const head = acc.slice(start, start + 480);
      if (/RESULTS\s+OF\s+OPERATIONS\s+\d{1,3}\b/i.test(head)) continue;
      // TOC row: "Item 7 … Management's Discussion … Page N" — almost no MD&A substance before the page ref
      const pageHit = head.search(/\bpage\s*\d{1,3}\b/i);
      if (pageHit > 0 && pageHit < 240) {
        const before = head.slice(0, pageHit).toLowerCase();
        const hasMdnaCue =
          /\b(results\s+of\s+operations|liquidity|capital\s+resources|critical\s+accounting|market\s+risk|covid|macroeconomic)\b/.test(
            before
          );
        if (!hasMdnaCue && before.replace(/\s+/g, " ").trim().length < 170) continue;
      }
    }

    const end = findMdnaEndCharIndex(acc, form, start);
    const span = end - start;
    if (span < MIN_MDNA_SPAN_CHARS) continue;

    if (!best || span > best.span) best = { start, end, span };
  }

  return best ? { start: best.start, end: best.end } : null;
}

/**
 * First "Management's Discussion and Analysis" in many 10-Ks is inside the **table of contents**,
 * with the next `ITEM 8` match also in the TOC — producing a tiny range that still contains the TOC `<table>`.
 * Scan all anchor occurrences and require the same minimum span as strict matching so we bind to the real MD&A body.
 */
function findMdnaCharRangeLoose(acc: string, form: string): { start: number; end: number } | null {
  const anchor = /\bManagement'?s\s+Discussion\s+and\s+Analysis\b/gi;
  let best: { start: number; end: number; span: number } | null = null;
  let am: RegExpExecArray | null;
  while ((am = anchor.exec(acc)) !== null) {
    const start = Math.max(0, am.index - 800);
    const end = findMdnaEndCharIndex(acc, form, am.index);
    if (end <= am.index) continue;
    const span = end - start;
    if (span < MIN_MDNA_SPAN_CHARS) continue;
    if (!best || span > best.span) best = { start, end, span };
  }
  return best ? { start: best.start, end: best.end } : null;
}

/** First Item 8 / Item 1 financial statements heading in the body (skips early TOC when possible). */
function findFinancialStatementsSectionStart(acc: string, form: string): number | null {
  if (form.includes("10-K")) {
    const re = /\bITEM\s+8[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi;
    const hits: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(acc)) !== null) {
      if (!isItem8FinancialStatementsCrossReference(acc, m.index)) hits.push(m.index);
    }
    const bodyHits = hits.filter((i) => i > 35_000);
    if (bodyHits.length) return Math.min(...bodyHits);
    return hits[0] ?? null;
  }
  const q10q = [
    /\bITEM\s+1[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi,
    /\bPART\s+I[\s,]+ITEM\s+1\b/gi,
  ];
  for (const re of q10q) {
    const mm = re.exec(acc);
    if (mm) return mm.index;
  }
  return null;
}

/** Segment notes are long only in pathological cases; caps runaway ranges when Item 9 / next note fail to match. */
const MAX_SEGMENT_RANGE_CHARS = 180_000;

/**
 * End of segment-note slice: next note title, Item 9 (flexible), exhibits / signatures — never "rest of filing"
 * when those anchors exist (fixes exhibit-index tables tagged as segment when Item 9 text doesn't match `ITEM 9.`).
 */
function findSegmentRangeEndRel(rel: string, form: string): number {
  const candidates: number[] = [];

  const noteHead = /\b(?:NOTE|Note)\s+\d+[A-Za-z]?\b/g;
  let nm: RegExpExecArray | null;
  const noteHits: number[] = [];
  while ((nm = noteHead.exec(rel)) !== null) noteHits.push(nm.index);
  if (noteHits.length >= 2 && noteHits[1] > 8) candidates.push(noteHits[1]);

  if (form.includes("10-K")) {
    const item9Section = [
      /\bITEM\s+9[\.\u2014\-]\s*/i,
      /\bITEM\s+9\s+CHANGES\b/i,
      /\bITEM\s+9\s+FINANCIAL\b/i,
      /\bITEM\s+9\s+LEGAL\b/i,
      /\bITEM\s+9\s+OTHER\b/i,
      /\bITEM\s+9\s+DISCLOSURE\b/i,
    ];
    for (const re of item9Section) {
      const m = re.exec(rel);
      if (m && m.index > 8) candidates.push(m.index);
    }
    const exhibitStops = [
      /\bITEM\s+15[\.\u2014\-\s]/i,
      /\bITEM\s+15\b/i,
      /\bEXHIBIT\s+INDEX\b/i,
      /\bLIST\s+(?:OF\s+)?EXHIBITS?\b/i,
      /\bLISTED\s+BELOW\s+ARE\s+THE\s+EXHIBITS\b/i,
      /\bPART\s+IV\b/i,
      /\bSIGNATURES?\b/i,
    ];
    for (const re of exhibitStops) {
      const m = re.exec(rel);
      if (m && m.index > 8) candidates.push(m.index);
    }
  } else {
    const p2 = /\bPART\s+II\b/i.exec(rel);
    if (p2 && p2.index > 8) candidates.push(p2.index);
  }

  const best = candidates.length ? Math.min(...candidates) : Math.min(rel.length, MAX_SEGMENT_RANGE_CHARS);
  return Math.min(best, rel.length, MAX_SEGMENT_RANGE_CHARS);
}

/**
 * Note-level segment disclosure (usually under Item 8 / Item 1 FS). Ends at the next note title or Item 9 / Part II.
 */
function findSegmentCharRangeInFlatText(
  acc: string,
  form: string,
  mdnaEndFallback: number | null
): { start: number; end: number } | null {
  const fsStart = findFinancialStatementsSectionStart(acc, form) ?? (mdnaEndFallback != null && mdnaEndFallback > 0 ? mdnaEndFallback : null);
  if (fsStart == null) return null;

  const searchSlice = acc.slice(fsStart + 50);
  const segmentNoteRes = [
    /\b(?:Note|NOTE)\s+\d+[A-Za-z]?\s*[—–\-\.:]?\s*.{0,120}?\bSegment\s+Information\b/i,
    /\b(?:Note|NOTE)\s+\d+[A-Za-z]?\s*[—–\-\.:]?\s*.{0,120}?\bOperating\s+Segments\b/i,
    /\b(?:Note|NOTE)\s+\d+[A-Za-z]?\s*[—–\-\.:]?\s*.{0,120}?\bSegment\s+Reporting\b/i,
    /\b(?:Note|NOTE)\s+\d+[A-Za-z]?\s*[—–\-\.:]?\s*.{0,120}?\bDisaggregated\s+Revenue\b/i,
  ];

  let absStart: number | null = null;
  for (const re of segmentNoteRes) {
    const sm = re.exec(searchSlice);
    if (sm && sm.index >= 0) {
      const abs = fsStart + 50 + sm.index;
      if (absStart === null || abs < absStart) absStart = abs;
    }
  }
  if (absStart === null) return null;

  const rel = acc.slice(absStart);
  const endRel = findSegmentRangeEndRel(rel, form);
  if (endRel < 80) return null;
  return { start: absStart, end: absStart + endRel };
}

function scanFilingTableZones($: cheerio.CheerioAPI, form: string): {
  flatText: string;
  mdnaRange: { start: number; end: number } | null;
  segmentRange: { start: number; end: number } | null;
  tableOffsets: Map<DomElement, number>;
} {
  const empty = {
    flatText: "",
    mdnaRange: null as { start: number; end: number } | null,
    segmentRange: null as { start: number; end: number } | null,
    tableOffsets: new Map<DomElement, number>(),
  };

  const body = $("body").get(0) as DomElement | undefined;
  if (!body) return empty;

  let acc = "";
  const tableOffsets = new Map<DomElement, number>();

  const walk = (node: ChildNode) => {
    if (node.type === "text" && node.data) {
      const t = node.data.replace(/\u00a0|\u2009|\u2007/g, " ").replace(/\s+/g, " ").trim();
      if (t) acc += (acc.length ? " " : "") + t;
      return;
    }
    if (node.type !== "tag") return;
    const el = node as DomElement;
    const tag = (el.name ?? "").toLowerCase();
    if (tag === "table") tableOffsets.set(el, acc.length);
    for (const c of el.children ?? []) walk(c);
  };

  for (const c of body.children ?? []) walk(c);

  let mdnaRange = findMdnaCharRangeInFlatText(acc, form);
  if (!mdnaRange && acc.length > 6000) mdnaRange = findMdnaCharRangeLoose(acc, form);

  const segmentRange = findSegmentCharRangeInFlatText(acc, form, mdnaRange?.end ?? null);

  return { flatText: acc, mdnaRange, segmentRange, tableOffsets };
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
function stripTablePresentationForAppTheme($frag: cheerio.CheerioAPI, wrap: ReturnType<cheerio.CheerioAPI>): void {
  const $tbl = wrap.find("table").first();
  if (!$tbl.length) return;

  $tbl.find("*").addBack().each((_, node) => {
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
      return;
    }
    if (tag === "span" && /\bixbrl-nf\b/.test($el.attr("class") ?? "")) {
      $el.removeAttr("style");
      return;
    }

    $el.removeAttr("class");
    $el.removeAttr("style");
  });
}

/**
 * Serialize the filing `<table>` so colspan/rowspan stay intact. Strip scripts/event handlers; replace
 * `ix:nonFraction` nodes with formatted $M text (plain `<span>`) for display.
 */
function buildDisplayTableHtml($: cheerio.CheerioAPI, table: DomElement): string | null {
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

  wrap.find("script,style,iframe,object,embed,link,meta,base").remove();
  wrap.find("form").remove();

  wrap.find("*").each((_, node) => {
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
  wrap.find("*").each((_, node) => {
    if (node.type !== "tag") return;
    const el = node as DomElement;
    if (isNonFractionTag(el.name ?? "")) nfEls.push(el);
  });
  for (const el of nfEls) {
    const fmt = parseNonFractionUsd($frag, el);
    if (fmt != null) $frag(el).replaceWith(`<span class="ixbrl-nf">${fmt}</span>`);
  }

  stripTablePresentationForAppTheme($frag, wrap);

  const inner = wrap.html();
  return inner && inner.length > 0 ? inner : null;
}

export async function fetchIxbrlMdnaTablesFromFiling(params: {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  form: string;
}): Promise<IxbrlMdnaTablesPayload> {
  const cikNum = parseInt(params.cik.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return { ok: false, error: "Invalid CIK" };

  const doc = (params.primaryDocument ?? "").trim();
  if (!doc) return { ok: false, error: "Missing primary document" };

  const accClean = accNoDashes(params.accessionNumber);
  if (!accClean) return { ok: false, error: "Invalid accession" };

  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/${encodeURIComponent(doc)}`;
  let html: string;
  try {
    const res = await fetch(url, { headers: { "User-Agent": SEC_EDGAR_USER_AGENT, Accept: "text/html,*/*" } });
    if (!res.ok) return { ok: false, error: `SEC fetch failed (${res.status})` };
    html = await res.text();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  }

  if (!html || html.length < 500) return { ok: false, error: "Empty or invalid HTML" };

  const $ = cheerio.load(html);
  const { mdnaRange, segmentRange, tableOffsets } = scanFilingTableZones($, params.form);

  const mdnaHeadingFound = mdnaRange !== null;
  const segmentHeadingFound = segmentRange !== null;

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

  for (const { el, section } of picked) {
    if (out.length >= MAX_TABLES_RETURNED) break;
    const rows = extractTableGrid($, el);
    if (rows.length === 0) continue;

    const factCount = countNonFractionsInTable(el);
    if (!isPlausibleDataTable(rows, factCount)) continue;
    if (isLikelyTableOfContents(rows)) continue;

    const sig = JSON.stringify(rows).slice(0, 6000);
    if (seen.has(sig)) continue;
    seen.add(sig);

    const caption = tableCaption($, el);
    const tableHtml = buildDisplayTableHtml($, el);

    out.push({
      id: `ix-html-${idx++}`,
      caption,
      rows,
      tableHtml,
      factCount,
      section,
    });
  }

  return {
    ok: true,
    primaryDocument: doc,
    mdnaHeadingFound,
    segmentHeadingFound,
    mdnaTableHit: out.length > 0,
    tables: out,
  };
}
