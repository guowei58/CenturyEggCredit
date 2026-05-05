/**
 * Extract HTML tables from MD&A and segment-information notes in the filing's primary Inline XBRL document.
 * Resolves ix:nonFraction values (scale/sign) to USD for display when present.
 */

import * as cheerio from "cheerio";
import type { ChildNode, Element as DomElement } from "domhandler";

import { getSecEdgarUserAgent } from "@/lib/sec-edgar";
import type { MdnaBounds, NotesSectionBounds, SegmentNotePick } from "@/lib/sec-ixbrl-mdna-boundaries";
import {
  buildNotesSectionBounds,
  findBestSegmentNoteRange,
  findMdnaBounds,
} from "@/lib/sec-ixbrl-mdna-boundaries";

export type IxbrlFilingSection = "mdna" | "segment";

export type TableConfidence = "high" | "medium" | "low";

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
      tables: IxbrlHtmlTable[];
      diagnostics: IxbrlExtractionDiagnostics;
    }
  | { ok: false; error: string };

const MAX_TABLES_RETURNED = 250;
/** Above this, skip HTML snapshot (still return row grid for dedupe / accessibility). */
const MAX_TABLE_HTML_CHARS = 400_000;

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

/**
 * Some filings use a separate &lt;td&gt; for "$" before the amount, which breaks column alignment.
 * Merges that pair (or drops a redundant "$" cell when the amount already includes $).
 */
function mergeAdjacentDollarOnlyCellsInDisplayFragment($frag: cheerio.CheerioAPI, wrap: cheerio.Cheerio<DomElement>): void {
  const $tbl = wrap.find("table").first();
  if (!$tbl.length) return;

  $tbl.find("tr").each((_, tr) => {
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
} {
  const empty = {
    flatText: "",
    mdnaRange: null as { start: number; end: number } | null,
    segmentRange: null as { start: number; end: number } | null,
    mdnaMeta: null as MdnaBounds | null,
    segmentMeta: null as SegmentNotePick | null,
    notesMeta: null as NotesSectionBounds | null,
    tableOffsets: new Map<DomElement, number>(),
  };

  /** Some EDGAR iXBRL shells use a sparse or missing `body`; fall back to `html`. */
  const body = ($("body").get(0) ?? $("html").get(0)) as DomElement | undefined;
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
    tableOffsets,
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
  mergeAdjacentDollarOnlyCellsInDisplayFragment($frag, wrap);

  const inner = wrap.html();
  return inner && inner.length > 0 ? inner : null;
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

export async function fetchIxbrlMdnaTablesFromFiling(params: {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  form: string;
  /** Include tables when MD&A / segment _boundary_ confidence is Low. Omit or leave unset on 10-Q to default on; pass false to opt out. */
  includeUncertainBoundaries?: boolean;
  /** Include tables whose combined structure confidence is Low. Omit on 10-Q to default on; pass false to opt out. */
  includeLowConfidenceTables?: boolean;
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
    const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "text/html,*/*" } });
    if (!res.ok) return { ok: false, error: `SEC fetch failed (${res.status})` };
    html = await res.text();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  }

  if (!html || html.length < 500) return { ok: false, error: "Empty or invalid HTML" };

  /** Quarterly filings often get “low” MD&A/segment boundary confidence; default uncertain on for 10-Q unless caller opts out. */
  const formUpper = (params.form ?? "").toUpperCase();
  const is10q = formUpper.includes("10-Q");
  const includeUncertainBoundaries =
    params.includeUncertainBoundaries === false
      ? false
      : params.includeUncertainBoundaries === true
        ? true
        : is10q;
  const includeLowConfidenceTables =
    params.includeLowConfidenceTables === false
      ? false
      : params.includeLowConfidenceTables === true
        ? true
        : is10q;

  const $ = cheerio.load(html);
  const { mdnaRange, segmentRange, mdnaMeta, segmentMeta, notesMeta, tableOffsets } = scanFilingTableZones(
    $,
    params.form,
    includeUncertainBoundaries
  );

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
    tables: out,
    diagnostics,
  };
}
