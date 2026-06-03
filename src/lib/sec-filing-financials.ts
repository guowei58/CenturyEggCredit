import * as cheerio from "cheerio";
import type { ChildNode, Element } from "domhandler";
import {
  filingSummaryMemberUrl,
  filingSummaryXmlUrl,
  parseFilingSummaryReports,
  type FilingSummaryReportRef,
} from "@/lib/secDebtFootnote/filingSummary";
import {
  extractInlineIxForMatrixAmountCell,
  findInlineIxInRowByVisibleText,
  isIxNonFractionTag,
  listInlineIxOnRow,
  type InlineIxCellMeta,
} from "@/lib/sec-ixbrl-inline-cell";
import { getSecEdgarUserAgent, parseFilerCikFromAccession } from "@/lib/sec-edgar";
import {
  scoreShapeTemplateSimilarity,
  type PrimaryFaceShapeTemplates,
} from "@/lib/sec-filing-financials-shape-templates";

export type { PrimaryFaceShapeTemplate, PrimaryFaceShapeTemplates } from "@/lib/sec-filing-financials-shape-templates";
export {
  buildPrimaryFaceShapeTemplateFromStatement,
  mergePrimaryFaceShapeTemplates,
  normalizeRowLabelForShape,
  scoreShapeTemplateSimilarity,
  updatePrimaryFaceShapeTemplatesFromStatements,
} from "@/lib/sec-filing-financials-shape-templates";

export type PrimaryStatementParseOptions = {
  form: string;
  primaryDocument?: string;
  sourceUrl?: string;
  /** Optional per-ticker row-shape templates — additive score boost when picking tables. */
  shapeTemplates?: PrimaryFaceShapeTemplates;
};

/** Padded 10-digit issuer/filer CIK for consistent URL building (`buildPrimaryDocumentUrl` applies parseInt). */
function paddedCik10(digitsOrCik: string): string {
  return digitsOrCik.replace(/\D/g, "").padStart(10, "0");
}

function archivesDataSegmentFromDocUrl(docUrl: string): string | null {
  const m = docUrl.trim().match(/\/Archives\/edgar\/data\/(\d+)\//i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

/**
 * SEC stores each filing under `/Archives/edgar/data/{cik}/{accession_digits}/`.
 * Tickers resolving to today's issuer CIK often differ from the filing folder when predecessor issuers are merged into one picker.
 */
export function resolveEdgarArchivesDataCikForSubmission(input: {
  issuerCik: string;
  accessionNumber: string;
  docUrl?: string | null;
}): string {
  const fromUrl = input.docUrl ? archivesDataSegmentFromDocUrl(input.docUrl) : null;
  if (fromUrl) return paddedCik10(fromUrl);
  const fromAcc = parseFilerCikFromAccession(input.accessionNumber);
  if (fromAcc) return paddedCik10(fromAcc);
  return paddedCik10(input.issuerCik);
}

export type FilingHtmlStatementRow = {
  concept: string;
  label: string;
  depth: number;
  rowKind: "data" | "heading" | "total";
  valueFormat?: "usd_millions" | "native";
  values: Record<string, number | null>;
  displayValues: Record<string, string>;
  /** Inline XBRL metadata keyed by period (filled during table parse). */
  ixByPeriod?: Record<string, InlineIxCellMeta | null>;
};

export type FilingHtmlStatement = {
  id: string;
  title: string;
  role: string;
  units?: string;
  sourceHtmlFile?: string;
  sourceHtmlUrl?: string;
  /** Flat-text offset of the chosen `<table>` in the primary filing HTML (for ix enrichment). */
  sourceTableOffset?: number;
  periods: Array<{ key: string; label: string; shortLabel?: string }>;
  rows: FilingHtmlStatementRow[];
  /** Matrix column indices for period amounts (same indices used in `extractTableMatrix`). */
  valueColumnIndices?: number[];
  dataStartRowIndex?: number;
};

type StatementKind = "is" | "bs" | "cf";
type FilingSectionBounds = { start: number; end: number };

const KIND_TITLES: Record<StatementKind, string> = {
  is: "Income Statement",
  bs: "Balance Sheet",
  cf: "Cash Flow",
};

function normalizeSpace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b([A-Z])\s+([a-z]{2,})\b/g, "$1$2")
    .trim();
}

function dedupeAdjacent(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (out[out.length - 1] === part) continue;
    out.push(part);
  }
  return out;
}

function fetchText(url: string): Promise<string> {
  return fetchTextWithRetry(url);
}

const SEC_FETCH_RETRY_DELAYS_MS = [400, 1200, 2500, 5200];

function secFetchInit(): RequestInit {
  return {
    headers: {
      "User-Agent": getSecEdgarUserAgent(),
      Accept: "*/*",
    },
    cache: "no-store",
  };
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSecFetchStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableSecFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /fetch failed/i.test(error.message) || /ECONN|ENOTFOUND|ETIMEDOUT|socket|network/i.test(error.message);
}

async function fetchTextWithRetry(url: string): Promise<string> {
  for (let attempt = 0; attempt <= SEC_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch(url, secFetchInit());
      if (!res.ok) {
        const error = Object.assign(new Error(`SEC fetch failed (${res.status})`), { status: res.status });
        if (isRetryableSecFetchStatus(res.status) && attempt < SEC_FETCH_RETRY_DELAYS_MS.length) {
          await sleepMs(SEC_FETCH_RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw error;
      }
      return await res.text();
    } catch (error) {
      if (attempt >= SEC_FETCH_RETRY_DELAYS_MS.length || !isRetryableSecFetchError(error)) {
        throw error instanceof Error ? error : new Error("SEC fetch failed");
      }
      await sleepMs(SEC_FETCH_RETRY_DELAYS_MS[attempt]!);
    }
  }
  throw new Error("SEC fetch failed");
}

function accNoDashes(value: string): string {
  return (value ?? "").replace(/-/g, "").trim();
}

function buildPrimaryDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const cikNum = String(Number.parseInt(cik.replace(/\D/g, ""), 10));
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes(accessionNumber)}/${encodeURIComponent(primaryDocument)}`;
}

function buildFilingIndexJsonUrl(cik: string, accessionNumber: string): string {
  const cikNum = String(Number.parseInt(cik.replace(/\D/g, ""), 10));
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes(accessionNumber)}/index.json`;
}

function sourceFileNameFromUrl(url: string, fallback?: string): string | undefined {
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").pop() ?? "";
    const name = decodeURIComponent(raw).trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

function findNextHtmlTableStart(html: string, fromIndex: number): number {
  const upper = html.indexOf("<TABLE", fromIndex);
  const lower = html.indexOf("<table", fromIndex);
  if (upper < 0) return lower;
  if (lower < 0) return upper;
  return Math.min(upper, lower);
}

function findNextHtmlTableEnd(html: string, fromIndex: number): number {
  const upper = html.indexOf("</TABLE>", fromIndex);
  const lower = html.indexOf("</table>", fromIndex);
  if (upper < 0) return lower;
  if (lower < 0) return upper;
  return Math.min(upper, lower);
}

function collectNearbyTableRanges(
  html: string,
  headingIndex: number,
  opts?: { maxDistance?: number; limit?: number }
): Array<{ start: number; end: number }> {
  const maxDistance = opts?.maxDistance ?? 12_000;
  const limit = opts?.limit ?? 4;
  const out: Array<{ start: number; end: number }> = [];
  let searchFrom = headingIndex;

  while (out.length < limit) {
    const tableStart = findNextHtmlTableStart(html, searchFrom);
    if (tableStart < 0 || tableStart - headingIndex > maxDistance) break;
    const tableEnd = findNextHtmlTableEnd(html, tableStart);
    if (tableEnd < 0) break;
    out.push({ start: tableStart, end: tableEnd + 8 });
    searchFrom = tableStart + 6;
  }

  return out;
}

function collectRawHtmlMatchIndices(html: string, patterns: RegExp[]): number[] {
  const out: number[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (let match = re.exec(html); match; match = re.exec(html)) out.push(match.index);
  }
  return out.sort((a, b) => a - b);
}

function extractHeadingAnchoredStatementSnippet(html: string, kind: StatementKind): string | null {
  const headingMatches = collectRawHtmlMatchIndices(html, statementHeadingPatterns(kind)).filter(
    (hit) => !(kind === "cf" && isPhantomCashFlowHeadingHtmlRawMatch(html, hit))
  );
  for (const headingIndex of headingMatches) {
    const tableRange = collectNearbyTableRanges(html, headingIndex, { maxDistance: 8_000, limit: 1 })[0];
    if (!tableRange) continue;
    return `<html><body>${html.slice(Math.max(0, headingIndex - 600), tableRange.end)}</body></html>`;
  }
  return null;
}

function parseHeadingAnchoredStatementTable(
  html: string,
  opts: { kind: StatementKind; form?: string; primaryDocument?: string; sourceUrl?: string }
): FilingHtmlStatement | null {
  const headingMatches = collectRawHtmlMatchIndices(html, statementHeadingPatterns(opts.kind)).filter(
    (hit) =>
      !(opts.kind === "cf" && isPhantomCashFlowHeadingHtmlRawMatch(html, hit)) &&
      !isParentheticalStatementHeadingHtml(html, hit)
  );
  const form = (opts.form ?? "").toUpperCase();
  let best: { parsed: FilingHtmlStatement; score: number; headingIndex: number; tableStart: number } | null = null;

  for (const headingIndex of headingMatches) {
    const tableRanges = collectNearbyTableRanges(html, headingIndex, { maxDistance: 12_000, limit: 4 });
    for (const tableRange of tableRanges) {
      const tableHtml = `<html><body>${html.slice(tableRange.start, tableRange.end)}</body></html>`;
      const $doc = cheerio.load(tableHtml);
      const $table = $doc("table").first();
      if ($table.length === 0) continue;
      if (!isPrimaryFaceTableCandidate($doc, { el: $table.get(0)! }, opts.kind)) continue;

      const unitsHint = extractUnitsFromText(html.slice(Math.max(0, headingIndex - 2_000), tableRange.start));
      const parsed = parsePrimaryStatementTable(
        $doc,
        $table,
        opts.kind,
        unitsHint,
        opts.primaryDocument,
        opts.sourceUrl,
        tableRange.start
      );
      const validated = returnParsedPrimaryStatementIfValid(parsed, form);
      if (!validated) continue;

      const textSlice = normalizeSpace($table.text()).slice(0, 6_000);
      const axes = parsedPrimaryStatementAxes($doc, $table, opts.kind);
      const score =
        scoreStatementTableText(textSlice, opts.kind) +
        scoreParsedTableStructure($doc, $table, opts.kind) -
        trendSummaryPenaltyForTenK(opts.kind, form, textSlice, axes) -
        cashFlowsCrossReferenceFootnotePenalty(opts.kind, textSlice);
      if (
        !best ||
        headingIndex < best.headingIndex ||
        (headingIndex === best.headingIndex && tableRange.start < best.tableStart) ||
        (headingIndex === best.headingIndex && tableRange.start === best.tableStart && score > best.score)
      ) {
        best = { parsed: validated, score, headingIndex, tableStart: tableRange.start };
      }
    }
  }

  return best?.parsed ?? null;
}

function statementHeadingPatterns(kind: StatementKind): RegExp[] {
  if (kind === "bs") {
    return [
      /condensed\s+consolidated\s+balance\s+sheets/i,
      /consolidated\s+balance\s+sheets/i,
      /condensed\s+consolidated\s+balance\s+sheet/i,
      /consolidated\s+balance\s+sheet/i,
      /condensed\s+consolidated\s+statements?\s+of\s+financial\s+position/i,
      /consolidated\s+statements?\s+of\s+financial\s+position/i,
    ];
  }
  if (kind === "is") {
    return [
      /condensed\s+consolidated\s+income\s+statements?/i,
      /consolidated\s+income\s+statements?/i,
      /condensed\s+consolidated\s+statements?\s+of\s+operations/i,
      /consolidated\s+statements?\s+of\s+operations/i,
      /condensed\s+consolidated\s+statements?\s+of\s+income/i,
      /consolidated\s+statements?\s+of\s+income/i,
      /condensed\s+consolidated\s+statements?\s+of\s+earnings/i,
      /consolidated\s+statements?\s+of\s+earnings/i,
      /condensed\s+consolidated\s+statements?\s+of\s+operations\s+and\s+comprehensive\s+(?:income|loss)/i,
      /consolidated\s+statements?\s+of\s+operations\s+and\s+comprehensive\s+(?:income|loss)/i,
    ];
  }
  return [
    /condensed\s+consolidated\s+statements?\s+of\s+cash\s+flows/i,
    /consolidated\s+statements?\s+of\s+cash\s+flows/i,
  ];
}

function lateCrossRefEmbeddedHeadingPatterns(kind: StatementKind): RegExp[] {
  if (kind === "bs") {
    return [
      ...statementHeadingPatterns(kind),
      /\bstatement\s+of\s+financial\s+position\b/i,
      /\bbalance\s+sheet\b/i,
      /\bbalance\s+sheets\b/i,
    ];
  }
  if (kind === "is") {
    return [
      ...statementHeadingPatterns(kind),
      /\bstatement\s+of\s+operations\b/i,
      /\bstatements?\s+of\s+operations\b/i,
      /\bstatement\s+of\s+earnings\b/i,
      /\bstatement\s+of\s+income\b/i,
    ];
  }
  return [
    ...statementHeadingPatterns(kind),
    /\bstatement\s+of\s+cash\s+flows\b/i,
    /\bstatements?\s+of\s+cash\s+flows\b/i,
  ];
}

function findAllMatchIndices(text: string, pattern: RegExp): number[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const out: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m.index);
  return out;
}

function buildFlatTextAndTableOffsets($: cheerio.CheerioAPI): {
  acc: string;
  tables: Array<{ el: Element; offset: number }>;
} {
  const body = ($("body").get(0) ?? $("html").get(0)) as Element | undefined;
  const tables: Array<{ el: Element; offset: number }> = [];
  let acc = "";

  const appendText = (raw: string) => {
    const t = normalizeSpace(raw);
    if (!t) return;
    acc += (acc.length ? " " : "") + t;
  };

  const walk = (node: ChildNode) => {
    if (node.type === "text" && node.data) {
      appendText(node.data);
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    if ((el.name ?? "").toLowerCase() === "table") tables.push({ el, offset: acc.length });
    for (const child of el.children ?? []) walk(child);
  };

  if (body) {
    for (const child of body.children ?? []) walk(child);
  }

  return { acc, tables };
}

function collectMatches(acc: string, patterns: RegExp[], minIndex: number): number[] {
  const out: number[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (let m = re.exec(acc); m; m = re.exec(acc)) {
      if ((m.index ?? 0) >= minIndex) out.push(m.index);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Index / TOC excerpt can share statement headings + many small numbers; distinguish from real statements by period headers (“Three months ended…”, balance-sheet “As of…” dates). */
function looksLikeFinancialStatementPeriodPreambleAhead(ahead: string): boolean {
  return (
    /\b(?:three|nine|six|twelve|[1-4])\s+months\s+ended\b/i.test(ahead) ||
    /\bmonths\s+ended\b/i.test(ahead) ||
    /\bquarter(?:s)?\s+ended\b/i.test(ahead) ||
    /\byear(?:s)?\s+ended\b/i.test(ahead) ||
    /\bas\s+of\b/i.test(ahead)
  );
}

function isLikelyIndexListingContext(acc: string, index: number): boolean {
  const back = acc.slice(Math.max(0, index - 220), index);
  const ahead = acc.slice(index, Math.min(acc.length, index + 700));
  if (/\b(index\s+page|table\s+of\s+contents)\b/i.test(back) || /\b(index\s+page|table\s+of\s+contents)\b/i.test(ahead)) {
    return true;
  }
  const pageCount = ahead.match(/\b\d{1,3}\b/g)?.length ?? 0;
  if (
    pageCount >= 3 &&
    /\b(consolidated\s+balance\s+sheets?|consolidated\s+statements?\s+of\s+operations|consolidated\s+statements?\s+of\s+cash\s+flows|notes\s+to\s+(?:the\s+)?consolidated\s+financial\s+statements)\b/i.test(
      ahead
    ) &&
    !looksLikeFinancialStatementPeriodPreambleAhead(ahead)
  ) {
    return true;
  }
  return false;
}

/** Multiple `statementHeadingPatterns` can match one visible title at nearby offsets (e.g. “Condensed …” vs substring “Consolidated …”). Keeping multiple hits shrinks heading→heading windows so tightly that the real table falls outside `[heading,nextHeading)`. */
function collapseNearbySameKindHeadingHits(
  hits: Array<{ kind: StatementKind; offset: number }>,
  maxGapChars = 40
): Array<{ kind: StatementKind; offset: number }> {
  const sorted = [...hits].sort((a, b) => a.offset - b.offset || a.kind.localeCompare(b.kind));
  const out: typeof hits = [];
  for (const hit of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === hit.kind && prev.offset === hit.offset) continue;
    if (
      prev &&
      hit.kind === prev.kind &&
      hit.offset > prev.offset &&
      hit.offset - prev.offset <= maxGapChars
    ) {
      continue;
    }
    out.push(hit);
  }
  return out;
}

function collapseNearbyHeadingOffsets(offsets: readonly number[], maxGapChars = 40): number[] {
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const off of sorted) {
    const prev = out[out.length - 1];
    if (prev !== undefined && off > prev && off - prev <= maxGapChars) continue;
    out.push(off);
  }
  return out;
}

/** Flattened “Consolidated … Statements of Cash Flows” substrings inside “Total as presented in … tie-out captions match heading regexes; treat as non-headings (Entravision / EVC filings). */
function isPhantomCashFlowHeadingMatchInFlattenedAcc(acc: string, offset: number): boolean {
  const back = normalizeSpace(acc.slice(Math.max(0, offset - 96), offset)).toLowerCase();
  return /\btotal\s+as\s+presented\s+in\b/.test(back);
}

function dropPhantomCashFlowHeadingMatches(acc: string, offsets: number[]): number[] {
  return offsets.filter((off) => !isPhantomCashFlowHeadingMatchInFlattenedAcc(acc, off));
}

function isPhantomCashFlowHeadingHtmlRawMatch(html: string, index: number): boolean {
  const slice = normalizeSpace(html.slice(Math.max(0, index - 200), Math.min(html.length, index + 60))).toLowerCase();
  return /\btotal\s+as\s+presented\s+in\b/.test(slice) && /\bcash\s+flows?\b/.test(slice);
}

function isLikelyStatementIndexTableText(text: string): boolean {
  const normalized = normalizeSpace(text).toLowerCase();
  if (!normalized) return false;
  const statementHits =
    [
      /condensed consolidated balance sheets?/,
      /condensed consolidated statements? of operations/,
      /condensed consolidated statements? of cash flows/,
      /consolidated balance sheets?/,
      /consolidated statements? of operations/,
      /consolidated statements? of cash flows/,
      /notes to (?:the )?(?:condensed )?consolidated financial statements/,
    ].filter((re) => re.test(normalized)).length;
  const pageCount = normalized.match(/\b\d{1,3}\b/g)?.length ?? 0;
  return statementHits >= 3 && pageCount >= 3;
}

function isLikelyEpsNoteTableText(text: string): boolean {
  const normalized = normalizeSpace(text).toLowerCase();
  if (!normalized) return false;
  const cues = [
    /\bnumerator for basic and diluted earnings per common share\b/,
    /\bbasic weighted-average common shares outstanding\b/,
    /\bdiluted weighted-average common(?: and common equivalent)? shares outstanding\b/,
    /\bshares\s*\(denominator\)\b/,
    /\bbasic and diluted (?:earnings|loss) per share\b/,
  ];
  return cues.filter((re) => re.test(normalized)).length >= 2;
}

function isLikelyRevenueDisaggregationTableText(text: string): boolean {
  const normalized = normalizeSpace(text).toLowerCase();
  if (!normalized) return false;
  const rowCues = [
    /\bdistribution revenue\b/,
    /\bcore advertising revenue\b/,
    /\bpolitical advertising revenue\b/,
    /\bother media(?:, non-media)?(?:, and intercompany)? revenues\b/,
    /\btotal revenues\b/,
  ];
  const periodCues = [/\blocal media\b/, /\btennis\b/, /\beliminations\b/, /\bother(?: & corporate)?\b/, /\bconsolidated\b/];
  return rowCues.filter((re) => re.test(normalized)).length >= 3 && periodCues.filter((re) => re.test(normalized)).length >= 2;
}

/** Cash bridge / summarized cash-movement tables often mistaken for balance sheets when a $ Change column is present. */
function isLikelyCashBridgeTableForBalanceSheet(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  const hasTriad =
    /\boperating activities\b/.test(t) && /\binvesting activities\b/.test(t) && /\bfinancing activities\b/.test(t);
  const hasNetCashMove =
    /\bnet change in cash\b/.test(t) ||
    /\bnet increase\b.*\bcash\b/.test(t) ||
    /\bnet decrease\b.*\bcash\b/.test(t);
  const weakBsCue = !/\btotal assets\b/.test(t) && !/\b(total )?liabilities\b/.test(t) && !/\bshareholders?'? equity\b/.test(t);
  return hasTriad && hasNetCashMove && weakBsCue;
}

function looksLikePrimaryCashFlowLayout(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  return (
    /\bcash\s+flows?\s+from\s+(?:operating|investing|financing)\b/i.test(t) ||
    /\boperating\s+activities\s*[\(:]/i.test(t) ||
    /\bconsolidated\s+statements?\s+of\s+cash\s+flows\b/i.test(t)
  );
}

/** “Cash paid for interest/taxes” and supplemental non‑cash disclosures — not the consolidated statement of cash flows. */
function isLikelySupplementalCashFlowDetailTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  const primaryCf = looksLikePrimaryCashFlowLayout(t);
  if (/\bsupplemental\b/.test(t) && /\bcash\s+flow\b/.test(t)) return !primaryCf;
  /* Interest / taxes “cash paid during the period” tables under the primary statement. */
  if (!primaryCf && /\bcash\s+paid\b/.test(t) && /\bduring\s+the\s+period\b/.test(t)) return true;
  return false;
}

/** “Total as presented in the … Consolidated Statements of Cash Flows” roll-forwards — not the primary CF/BS tables (common in filings like Entravision). */
export function isLikelyCashRollupCrossReferenceToCashFlowStatement(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  return (
    /\btotal\s+as\s+presented\s+in\s+(?:the\s+)?(?:condensed\s+)?consolidated\s+statements?\s+of\s+cash\s+flows\b/.test(t) ||
    /\btotal\s+as\s+presented\s+on\s+(?:the\s+)?(?:condensed\s+)?consolidated\s+statements?\s+of\s+cash\s+flows\b/.test(t)
  );
}

function cashFlowsCrossReferenceFootnotePenalty(kind: StatementKind, text: string): number {
  return kind === "bs" || kind === "cf"
    ? isLikelyCashRollupCrossReferenceToCashFlowStatement(text)
      ? 520
      : 0
    : 0;
}

/** Segment P&L rollups in Item 8 / notes (e.g. “Segment revenues”) — not the consolidated income statement. */
function isLikelySegmentReportingIncomeTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  if (/\bsegment revenues?\b/.test(t)) return true;
  const segmentHits =
    (/\bsegment operating (?:income|loss|expenses?)\b/.test(t) ? 1 : 0) +
    (/\bsegment (?:net )?(?:income|loss)\b/.test(t) ? 1 : 0);
  if (segmentHits < 2) return false;
  if (/\b(cost of (?:revenues?|sales)|gross profit|research and development|selling, general)\b/.test(t)) return false;
  if (/\bnet (?:income|loss)\b/.test(t) && !/\bsegment net/.test(t)) return false;
  return true;
}

/** Lease footnote / ASC 842 roll-forward tables titled like balance sheets but without total assets. */
function isLikelyLeaseFootnoteBalanceSheetTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  const hasPrimaryBsTotals =
    /\btotal assets\b/.test(t) ||
    /\btotal current assets\b/.test(t) ||
    (/\bcurrent assets\b/.test(t) && /\bcash and cash equivalents\b/.test(t));
  const hasEquity =
    /\b(total )?stockholders?'? equity\b/.test(t) || /\b(total )?shareholders?'? equity\b/.test(t);
  const hasTotalLiabilities = /\btotal liabilities\b/.test(t);
  if (hasPrimaryBsTotals && hasEquity) return false;
  /* Split iXBRL balance sheets often put equity in the next table; lease lines on the face are not footnotes. */
  if (hasPrimaryBsTotals && hasTotalLiabilities) return false;
  const broadAssetLines =
    (/\bcash and cash equivalents\b/.test(t) ? 1 : 0) +
    (/\baccounts receivable\b/.test(t) ? 1 : 0) +
    (/\bgoodwill\b/.test(t) ? 1 : 0) +
    (/\binventory\b/.test(t) ? 1 : 0) +
    (/\bproperty,? plant and equipment\b/.test(t) ? 1 : 0);
  if (hasPrimaryBsTotals && broadAssetLines >= 2) return false;

  const leaseHits =
    (/\boperating lease\b/.test(t) ? 1 : 0) +
    (/\bfinance lease\b/.test(t) ? 1 : 0) +
    (/\blease liabilities?\b/.test(t) ? 1 : 0) +
    (/\bright-of-use\b/.test(t) ? 1 : 0) +
    (/\btotal lease liabilities\b/.test(t) ? 1 : 0) +
    (/\btotal lease assets\b/.test(t) ? 1 : 0);
  if (leaseHits >= 2) return true;
  if (/\boperating leases\b/.test(t) && /\bfinance leases\b/.test(t) && !hasPrimaryBsTotals) return true;
  return false;
}

function tableTextHasCue(text: string, cue: RegExp): boolean {
  return cue.test(normalizeSpace(text).toLowerCase());
}

/** Minimum ix tags or plain numeric cells required before a table can be a primary face statement. */
const PRIMARY_FACE_MIN_NUMERIC_CELLS: Record<StatementKind, number> = {
  bs: 20,
  is: 12,
  cf: 20,
};

function minNumericCellsForPrimaryStatement(kind: StatementKind): number {
  return PRIMARY_FACE_MIN_NUMERIC_CELLS[kind];
}

function cellLooksLikeFinancialAmount(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t || t === "$" || t === "—" || t === "-") return false;
  const normalized = t.replace(/^\$\s*/, "").replace(/^\(\s*|\s*\)$/g, "");
  if (/^(?:19|20)\d{2}$/.test(normalized)) return false;
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)) return true;
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return true;
  return false;
}

export function __test_countStatementTableNumericCellsOrTags(
  $: cheerio.CheerioAPI,
  table: { el: Element }
): number {
  return countStatementTableNumericCellsOrTags($, table);
}

function countStatementTableNumericCellsOrTags($: cheerio.CheerioAPI, table: { el: Element }): number {
  let count = 0;
  $(table.el)
    .find("tr")
    .each((_, tr) => {
      $(tr)
        .find("td, th")
        .each((_, cell) => {
          const $cell = $(cell);
          const ixTags = $cell
            .find("*")
            .toArray()
            .filter((node) => node.type === "tag" && isIxNonFractionTag((node as Element).name ?? ""));
          if (ixTags.length > 0) {
            count += ixTags.length;
            return;
          }
          if (cellLooksLikeFinancialAmount($cell.text())) count += 1;
        });
    });
  return count;
}

function statementTableMeetsMinNumericDensity(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  kind: StatementKind
): boolean {
  return countStatementTableNumericCellsOrTags($, table) >= minNumericCellsForPrimaryStatement(kind);
}

/** Max `<table>` scans inside Item 1 / Item 8 — stop early once IS+BS+CF are found. */
const PRIMARY_ITEM_SECTION_MAX_SCAN_TABLES_10Q = 40;
const PRIMARY_ITEM_SECTION_MAX_SCAN_TABLES_10K = 120;

function primaryItemSectionMaxScanTables(form: string): number {
  return form.toUpperCase().includes("10-K")
    ? PRIMARY_ITEM_SECTION_MAX_SCAN_TABLES_10K
    : PRIMARY_ITEM_SECTION_MAX_SCAN_TABLES_10Q;
}
/** Each detected period column must contain more than this many numeric cells. */
const MIN_NUMBERS_PER_PERIOD_COLUMN = 10;
/** CF tables are often shorter; allow a slightly lower per-column floor. */
const MIN_NUMBERS_PER_PERIOD_COLUMN_CF = 6;
/** When per-column gate fails, accept tables with strong kind score and this many numerics. */
const MIN_TOTAL_NUMERIC_CELLS_GATE_FALLBACK = 35;

/** Positive-only classification score — no rejection / footnote filters. */
function simpleStatementKindScore(text: string, kind: StatementKind): number {
  const t = normalizeSpace(text).toLowerCase();
  if (kind === "bs") {
    return (
      (/\btotal current assets\b/.test(t) ? 4 : 0) +
      (/\btotal assets\b/.test(t) ? 3 : 0) +
      (/\btotal liabilities\b/.test(t) ? 2 : 0) +
      (/\bstockholders'? equity\b/.test(t) || /\bshareholders'? equity\b/.test(t) ? 2 : 0) +
      (/\bcash and cash equivalents\b/.test(t) ? 1 : 0)
    );
  }
  if (kind === "is") {
    return (
      (/\b(total )?revenues?\b/.test(t) || /\bnet sales\b/.test(t) || /\boperating revenue\b/.test(t) ? 3 : 0) +
      (/\bnet income\b/.test(t) || /\bnet loss\b/.test(t) ? 3 : 0) +
      (/\boperating income\b/.test(t) || /\bgross profit\b/.test(t) ? 2 : 0)
    );
  }
  return (
    (/\boperating activities\b/.test(t) ? 4 : 0) +
    (/\binvesting activities\b/.test(t) ? 3 : 0) +
    (/\bfinancing activities\b/.test(t) ? 3 : 0) +
    (/\bnet cash provided\b/.test(t) || /\bnet cash used\b/.test(t) ? 2 : 0) +
    (/\bcash flows?\b/.test(t) ? 1 : 0)
  );
}

/** Minimum positive score before a table can be tagged IS / BS / CF. */
const MIN_STATEMENT_KIND_SCORE = 3;

function statementTableContentLooksLikePrimaryFace(text: string, kind: StatementKind): boolean {
  return simpleStatementKindScore(text, kind) >= MIN_STATEMENT_KIND_SCORE;
}

function statementTableTextLooksLikePrimaryFace(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  kind: StatementKind
): boolean {
  if (!statementTableMeetsMinNumericDensity($, table, kind)) return false;
  return statementTableContentLooksLikePrimaryFace(tableClassificationText($, table), kind);
}

function countNumericCellsInTableColumn(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<Element>,
  matrix: string[][],
  dataStart: number,
  col: number
): number {
  const trs = $table.find("tr").toArray();
  let count = 0;
  for (let r = dataStart; r < Math.min(matrix.length, trs.length); r += 1) {
    const cellText = matrix[r]?.[col] ?? "";
    const tr = trs[r] as Element | undefined;
    const cells = tr ? directRowCells($, tr) : [];
    const $cell = cells[col] ? $(cells[col]) : null;
    const ixTags =
      $cell
        ?.find("*")
        .toArray()
        .filter((node) => node.type === "tag" && isIxNonFractionTag((node as Element).name ?? "")) ?? [];
    if (ixTags.length > 0) {
      count += ixTags.length;
      continue;
    }
    if (cellLooksLikeFinancialAmount(cellText)) count += 1;
  }
  return count;
}

function dedupeMirroredValueColumns(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<Element>,
  matrix: string[][],
  dataStart: number,
  valueCols: number[]
): number[] {
  if (valueCols.length <= 4) return valueCols;

  const colCounts = valueCols.map((col) => {
    let count = 0;
    for (let r = dataStart; r < matrix.length; r += 1) {
      const cell = matrix[r]?.[col] ?? "";
      if (cellLooksLikeFinancialAmount(cell)) count += 1;
    }
    return count;
  });
  const maxCount = Math.max(...colCounts, 0);
  if (maxCount <= 0) return valueCols;

  const threshold = Math.max(8, Math.floor(maxCount * 0.65));
  const strong = valueCols.filter((_, idx) => colCounts[idx]! >= threshold);
  if (strong.length >= 2 && strong.length < valueCols.length) return strong.slice(0, 4);
  return valueCols;
}

function statementTableMeetsMinNumbersPerPeriodColumnForKind(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  kind: StatementKind | null,
  minPerColumnExclusive = MIN_NUMBERS_PER_PERIOD_COLUMN
): boolean {
  const $table = $(table.el);
  const matrix = extractTableMatrix($, $table);
  const dataStart = detectDataStart(matrix);
  if (dataStart < 0) return false;
  let valueCols = inferValueColumnIndices(matrix, dataStart);
  valueCols = dedupeMirroredValueColumns($, $table, matrix, dataStart, valueCols);
  if (valueCols.length === 0) return false;

  const perColMin =
    kind === "cf" ? Math.min(minPerColumnExclusive, MIN_NUMBERS_PER_PERIOD_COLUMN_CF) : minPerColumnExclusive;

  const colCounts = valueCols.map((col) =>
    countNumericCellsInTableColumn($, $table, matrix, dataStart, col)
  );
  const qualifyingCols = valueCols.filter((_, idx) => colCounts[idx]! > perColMin);
  if (qualifyingCols.length === 0) return false;

  const requiredPeriodCols = Math.min(2, valueCols.length);
  return qualifyingCols.length >= requiredPeriodCols;
}

function statementTableMeetsMinNumbersPerPeriodColumn(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  minPerColumnExclusive = MIN_NUMBERS_PER_PERIOD_COLUMN
): boolean {
  return statementTableMeetsMinNumbersPerPeriodColumnForKind($, table, null, minPerColumnExclusive);
}

function statementTableMeetsPrimaryFaceSizeGate(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  kind: StatementKind | null
): boolean {
  if (statementTableMeetsMinNumbersPerPeriodColumnForKind($, table, kind)) return true;
  if (!kind) return false;
  const total = countStatementTableNumericCellsOrTags($, table);
  if (total < MIN_TOTAL_NUMERIC_CELLS_GATE_FALLBACK) return false;
  const text = tableClassificationText($, table);
  return simpleStatementKindScore(text, kind) >= MIN_STATEMENT_KIND_SCORE;
}

export function __test_statementTableMeetsMinNumbersPerPeriodColumn(
  $: cheerio.CheerioAPI,
  table: { el: Element }
): boolean {
  return statementTableMeetsMinNumbersPerPeriodColumn($, table);
}

function tableClassificationText($: cheerio.CheerioAPI, table: { el: Element }): string {
  const matrix = extractTableMatrix($, $(table.el));
  return normalizeSpace(matrix.flat().filter(Boolean).join(" ")).slice(0, 8_000);
}

export function __test_tableClassificationText($: cheerio.CheerioAPI, table: { el: Element }): string {
  return tableClassificationText($, table);
}

function inferPrimaryFaceStatementKind($: cheerio.CheerioAPI, table: { el: Element }): StatementKind | null {
  const text = tableClassificationText($, table);
  let best: { kind: StatementKind; score: number } | null = null;
  for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
    const score = simpleStatementKindScore(text, kind);
    if (score < MIN_STATEMENT_KIND_SCORE) continue;
    if (!best || score > best.score) best = { kind, score };
  }
  return best?.kind ?? null;
}

export function __test_inferPrimaryFaceStatementKind(
  $: cheerio.CheerioAPI,
  table: { el: Element }
): StatementKind | null {
  return inferPrimaryFaceStatementKind($, table);
}

export function __test_statementTableContentLooksLikePrimaryFace(text: string, kind: StatementKind): boolean {
  return statementTableContentLooksLikePrimaryFace(text, kind);
}

export function __test_debugBalanceSheetFaceRejection(_text: string): string | null {
  return null;
}

function extractPrimaryFaceRowLabelsForShape(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  limit = 28
): string[] {
  const $table = $(table.el);
  const matrix = extractTableMatrix($, $table);
  const dataStart = detectDataStart(matrix);
  if (dataStart < 0) return [];
  const valueCols = inferValueColumnIndices(matrix, dataStart);
  const labelColEnd = valueCols[0] ?? matrix[dataStart]?.length ?? 0;
  const labels: string[] = [];
  const trs = $table.find("tr").toArray();
  for (let rowIdx = dataStart; rowIdx < Math.min(matrix.length, trs.length) && labels.length < limit; rowIdx += 1) {
    const row = matrix[rowIdx] ?? [];
    const label = normalizeSpace(
      dedupeAdjacent(
        row
          .slice(0, labelColEnd)
          .map((cell) => normalizeSpace(cell))
          .filter((cell) => !isBlankCellText(cell) && cell !== "$")
      ).join(" ")
    );
    if (!label || /^\(?\d[\d,.\s]*\)?$/.test(label.replace(/\$/g, ""))) continue;
    labels.push(label);
  }
  return labels;
}

function pickPrimaryFaceTablesFromCandidates(
  ctx: ParsedFilingHtmlContext,
  tables: Array<{ el: Element; offset: number }>,
  maxScan: number,
  pickOpts?: { form?: string; section?: FilingSectionBounds; shapeTemplates?: PrimaryFaceShapeTemplates }
): Partial<Record<StatementKind, { el: Element; offset: number }>> {
  const section = pickOpts?.section ?? { start: 0, end: ctx.acc.length };
  const form = pickOpts?.form ?? "";
  const shapeTemplates = pickOpts?.shapeTemplates;
  const hasTemplates = Boolean(shapeTemplates && (shapeTemplates.is || shapeTemplates.bs || shapeTemplates.cf));
  const bestByKind: Partial<Record<StatementKind, { table: { el: Element; offset: number }; score: number }>> = {};
  const picked: Partial<Record<StatementKind, { el: Element; offset: number }>> = {};

  let scanned = 0;
  for (const table of tables) {
    if (scanned >= maxScan) break;
    scanned += 1;

    if (hasTemplates) {
      for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
        if (!statementTableTextLooksLikePrimaryFace(ctx.$, table, kind)) continue;
        const score = scoreTableCandidate(ctx.$, ctx.acc, table, section, kind, form, shapeTemplates);
        if (score < 40) continue;
        const prev = bestByKind[kind];
        if (!prev || score > prev.score) bestByKind[kind] = { table, score };
      }
      continue;
    }

    const kindHint = inferPrimaryFaceStatementKind(ctx.$, table);
    const meetsGate =
      kindHint != null
        ? statementTableMeetsPrimaryFaceSizeGate(ctx.$, table, kindHint)
        : statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, table);
    const kind = meetsGate ? kindHint ?? inferPrimaryFaceStatementKind(ctx.$, table) : null;
    if (!kind || picked[kind]) continue;
    picked[kind] = table;
    if (picked.is && picked.bs && picked.cf) break;
  }

  if (hasTemplates) {
    for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
      const hit = bestByKind[kind];
      if (hit) picked[kind] = hit.table;
    }
  }

  return picked;
}

function parsePrimaryFinancialStatementsInItemSection(
  ctx: ParsedFilingHtmlContext,
  opts: PrimaryStatementParseOptions
): FilingHtmlStatement[] {
  const form = opts.form.toUpperCase();
  const scanCap = primaryItemSectionMaxScanTables(form);
  let section = findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, form);
  const pickCtx = { form, section: section ?? { start: 0, end: ctx.acc.length }, shapeTemplates: opts.shapeTemplates };

  let candidateTables: Array<{ el: Element; offset: number }>;
  if (section) {
    candidateTables = ctx.tables.filter((table) => table.offset >= section!.start && table.offset < section!.end);
  } else {
    candidateTables = [];
  }

  let picked = pickPrimaryFaceTablesFromCandidates(ctx, candidateTables, scanCap, pickCtx);

  const needsMore = !picked.is || !picked.bs || !picked.cf;
  if (needsMore && !section && collectMatches(ctx.acc, startPatternsForForm(form), 0).length > 0) {
    picked = pickPrimaryFaceTablesFromCandidates(ctx, ctx.tables, scanCap, {
      ...pickCtx,
      section: { start: 0, end: ctx.acc.length },
    });
  } else if (needsMore && section && Object.keys(picked).length === 0) {
    picked = pickPrimaryFaceTablesFromCandidates(ctx, ctx.tables, scanCap, {
      ...pickCtx,
      section: { start: 0, end: ctx.acc.length },
    });
  }

  const sectionStart = section?.start ?? 0;

  return (["is", "bs", "cf"] as StatementKind[])
    .map((kind) => {
      const hit = picked[kind];
      if (!hit) return null;
      const unitsHint = extractUnitsFromText(
        ctx.acc.slice(Math.max(sectionStart, hit.offset - 500), hit.offset)
      );
      return parsePrimaryStatementTable(
        ctx.$,
        ctx.$(hit.el),
        kind,
        unitsHint,
        opts.primaryDocument,
        opts.sourceUrl,
        hit.offset
      );
    })
    .filter((stmt): stmt is FilingHtmlStatement => Boolean(stmt));
}

/** Unified gate: per-kind numeric floor plus primary-face content checks (OCI, parenthetical, etc.). */
function isPrimaryFaceTableCandidate(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  kind: StatementKind
): boolean {
  return statementTableTextLooksLikePrimaryFace($, table, kind);
}

function earliestPrimaryFaceTableInSection(
  $: cheerio.CheerioAPI,
  tables: Array<{ el: Element; offset: number }>,
  sectionStart: number,
  ceiling: number,
  kind: StatementKind
): { el: Element; offset: number } | null {
  for (const table of tables) {
    if (table.offset < sectionStart || table.offset >= ceiling) continue;
    if (isPrimaryFaceTableCandidate($, table, kind)) return table;
  }
  return null;
}

export function __test_statementTableTextLooksLikePrimaryFace(
  $: cheerio.CheerioAPI,
  table: { el: Element },
  kind: StatementKind
): boolean {
  return statementTableTextLooksLikePrimaryFace($, table, kind);
}

/** Narrow “high‑level operating results” blocks (often below the consolidated income statement) mistaken for primary IS picks. */
function isLikelyMinimalOperatingResultsIncomeTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  if (/\btotal operating revenues?\b/.test(t) || /\bservice\b/.test(t) || /\bmedia revenues\b/.test(t)) return false;
  if (!/\brevenues\b/.test(t)) return false;
  if (!/\boperating income\b/.test(t) && !/\bincome from operations\b/.test(t)) return false;
  if (!/\bnet (?:income|loss)\b/.test(t)) return false;
  const hasDetail =
    /\b(cost of (?:revenues?|sales)|gross (?:profit|margin)|research and development|r&d\b|sales, general|\bsg&a\b|general and administrative)\b/i.test(t);
  return !hasDetail;
}

/** OCI / comprehensive-income continuation blocks below the consolidated income statement — not the primary IS face. */
function isLikelyOtherComprehensiveIncomeOnlyTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  const hasOci =
    /\bother comprehensive (?:income|loss)\b/.test(t) ||
    /\btotal other comprehensive income\b/.test(t) ||
    /\bcomprehensive (?:income|loss)\b/.test(t);
  if (!hasOci) return false;
  if (primaryFaceOperatingRevenueCue(t)) return false;
  const hasIsStructure =
    (tableTextHasCue(t, /(?:^|\s)(?:total )?revenues?/) ||
      tableTextHasCue(t, /net sales/) ||
      tableTextHasCue(t, /cost of (?:revenues?|sales)|cost of goods sold/)) &&
    (tableTextHasCue(t, /gross profit/) ||
      tableTextHasCue(t, /operating income/) ||
      tableTextHasCue(t, /income from operations/));
  return !hasIsStructure;
}

function primaryFaceOperatingRevenueCue(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (/\bsegment revenues?\b/.test(t)) return false;
  return (
    tableTextHasCue(t, /(?:^|\s)(?:total )?revenues?/) ||
    tableTextHasCue(t, /net sales/) ||
    tableTextHasCue(t, /total net sales/) ||
    /\boperating revenues?\b/.test(t) ||
    /\btotal operating revenues?\b/.test(t)
  );
}

/** Parenthetical / held-for-sale balance sheet schedules — not the consolidated balance sheet face. */
function isLikelyParentheticalOrHeldForSaleBalanceSheetTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  const hasFullBsTotals =
    (/\btotal assets\b/.test(t) && !/\btotal assets held for sale\b/.test(t)) ||
    /\btotal current assets\b/.test(t);
  const hasTotalLiabilities =
    /\btotal liabilities\b/.test(t) && !/\btotal liabilities held for sale\b/.test(t);
  const hasEquity = /\b(total )?(?:stockholders?|shareholders?)'?\s+equity\b/.test(t);
  /* Consolidated faces often include held-for-sale line items or split equity to the next table. */
  if (hasFullBsTotals && (hasTotalLiabilities || hasEquity)) return false;

  if (/\bparenthetical\b/.test(t)) return true;
  if (/\bassets and liabilities held for sale\b/.test(t)) return true;
  if (/\btotal assets held for sale\b/.test(t)) return true;
  if (/\btotal liabilities held for sale\b/.test(t)) return true;
  if (/\bheld for sale\b/.test(t) && !hasFullBsTotals) return true;
  return false;
}

function isParentheticalStatementHeadingHtml(html: string, headingIndex: number): boolean {
  const slice = normalizeSpace(html.slice(Math.max(0, headingIndex - 120), headingIndex + 400)).toLowerCase();
  return /\b(?:held for sale|parenthetical)\b/.test(slice);
}

/** Item 6–style “selected financial data” income summary (revenues + net income only) — not the face income statement. */
function isLikelyHighLevelIncomeSummaryTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (/\bselected (?:consolidated )?financial data\b/.test(t)) return true;
  const hasSummaryRevenue =
    /\btotal revenues\b/.test(t) || /\bnet sales\b/.test(t) || /\btotal net sales\b/.test(t);
  if (!hasSummaryRevenue || !/\bnet (?:income|loss)\b/.test(t)) return false;
  if (/\bcost of (?:revenues?|sales)\b/.test(t) || /\bgross profit\b/.test(t)) return false;
  if (/\boperating income\b/.test(t) || /\bincome from operations\b/.test(t)) return false;
  return true;
}

/** Item 6–style “selected financial data” balance sheet (few lines, many years) — not the face balance sheet. */
function isLikelySelectedFinancialDataBalanceSheetSnippet(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  if (!/\btotal assets\b/.test(t)) return false;
  if (!/\b(total )?stockholders?'? equity\b/.test(t) && !/\b(total )?shareholders?'? equity\b/.test(t)) return false;
  if (
    /\bcash, cash equivalents,? and marketable securities\b/.test(t) &&
    /\btotal (?:long-term )?liabilities\b/.test(t)
  ) {
    return true;
  }
  if (/\bselected (?:consolidated )?financial data\b/.test(t)) return true;
  if (/\bbalance sheet data\b/.test(t)) return true;
  return false;
}

/** Two-line operating / investing cash “highlights” rows (not the consolidated statement of cash flows). */
function isLikelyCashFlowOperatingInvestingHighlightsOnly(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  if (!/\bnet cash provided by operating activities\b/.test(t)) return false;
  if (!/\bnet cash used in investing activities\b/.test(t)) return false;
  if (/\bfinancing activities\b/.test(t)) return false;
  if (/\bcash flows? from financing\b/.test(t)) return false;
  if (/\bincrease.*cash and cash equivalents\b/.test(t) || /\bdecrease.*cash and cash equivalents\b/.test(t)) return false;
  return true;
}

/** Only the three net activity lines (MD&A / liquidity rollups) — not a reconciled consolidated statement of cash flows. */
function isLikelyTripleNetCashActivitiesRollup(text: string, rowCount: number): boolean {
  if (rowCount > 6) return false;
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  const hasOp = /\bnet cash (?:provided by|used in) operating activities\b/.test(t);
  const hasInv = /\bnet cash (?:provided by|used in) investing activities\b/.test(t);
  const hasFin = /\bnet cash (?:provided by|used in) financing activities\b/.test(t);
  if (!hasOp || !hasInv || !hasFin) return false;
  if (/\bnet income\b/.test(t) || /\bnet loss\b/.test(t)) return false;
  if (/\bdepreciation\b/.test(t) || /\bamortization\b/.test(t)) return false;
  if (/\bstock[- ]based compensation\b/.test(t)) return false;
  if (/\bdeferred \w* ?tax/.test(t)) return false;
  return true;
}

function parsedPrimaryStatementAxes(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<Element>,
  kind: StatementKind
): { periods: number; rows: number } | null {
  const matrix = extractTableMatrix($, $table);
  const dataStart = detectDataStart(matrix);
  if (dataStart < 0) return null;
  const valueCols = inferValueColumnIndices(matrix, dataStart);
  if (valueCols.length === 0) return null;
  const periods = inferPeriods(matrix, dataStart, valueCols);
  const rows = parseStatementRows($, $table, matrix, dataStart, valueCols, periods);
  if (rows.length === 0) return null;
  return { periods: periods.length, rows: rows.length };
}

/** Penalize Item 6 / MD&A multi-year trend tables when picking primary 10‑K statements (face IS/BS are shorter). */
function trendSummaryPenaltyForTenK(
  kind: StatementKind,
  form: string,
  textForPenalty: string,
  axes: { periods: number; rows: number } | null
): number {
  if (!form.toUpperCase().includes("10-K") || !axes) return 0;
  let penalty = 0;
  if (kind === "bs" && axes.periods >= 4) penalty += 340;
  if (kind === "is" && axes.periods >= 5) penalty += 340;
  if (kind === "cf" && isLikelyTripleNetCashActivitiesRollup(textForPenalty, axes.rows)) penalty += 420;
  return penalty;
}

/** Supplemental “earnings metrics” summaries (FRE/DE-only) mistaken for condensed income statements. */
function isLikelySupplementalEarningsMetricsIncomeTable(text: string): boolean {
  const t = normalizeSpace(text).toLowerCase();
  if (!t) return false;
  let metricHits = 0;
  if (/\bfee[- ]related earnings\b/.test(t)) metricHits += 1;
  if (/\bdistributable earnings\b/.test(t)) metricHits += 1;
  if (/\bnet income attributable\b/.test(t)) metricHits += 1;
  if (/\badjusted net income\b/.test(t)) metricHits += 1;
  const looksLikeOperatingStatement =
    /\b(expenses|cost of revenues?|cost of goods sold|gross profit|operating expenses|segment reporting)\b/.test(t);
  return metricHits >= 2 && !looksLikeOperatingStatement;
}

function endPatternsForForm(form: string): RegExp[] {
  if (form.includes("10-Q")) {
    return [
      /\bITEM\s+2[\.\u2014\u2013\-]?\s*MANAGEMENT'?S\s+DISCUSSION\b/gi,
      /\bPART\s+II\b/gi,
      /\bITEM\s+2[\.\u2014\u2013\-]/gi,
    ];
  }
  return [
    /\bITEM\s+9[\.\u2014\u2013\-]?\s*CHANGES\s+IN\s+AND\s+DISAGREEMENTS\s+WITH\s+ACCOUNTANTS\b/gi,
    /\bITEM\s+9A[\.\u2014\u2013\-]?\s*CONTROLS\s+AND\s+PROCEDURES\b/gi,
    /\bITEM\s+9B[\.\u2014\u2013\-]?\s*OTHER\s+INFORMATION\b/gi,
    /\bITEM\s+9C[\.\u2014\u2013\-]?\s*DISCLOSURE\s+REGARDING\s+FOREIGN\s+JURISDICTIONS\b/gi,
    /\bSIGNATURES?\b/gi,
  ];
}

/** Punctuation / whitespace between "Item 8" and the financial-statements title. */
const ITEM8_HEADING_SEP = String.raw`(?:\s*[\.\u2014\u2013\-:]+\s*|\s+)`;

/** 10-K Item 8 heading variants (TOC entries filtered downstream). */
const ITEM8_FINANCIAL_STATEMENTS_START_PATTERNS: RegExp[] = [
  // Item 8 [.—:] Consolidated Financial Statements [and Supplementary Data|Information|…]
  new RegExp(
    String.raw`\bITEM\s+8${ITEM8_HEADING_SEP}(?:INDEX\s+TO\s+(?:THE\s+)?)?(?:(?:CONDENSED|CONSOLIDATED|COMBINED|UNAUDITED|AUDITED|ANNUAL)\s+){0,4}FINANCIAL\s+STATEMENTS?\b(?:\s+(?:AND|&)\s+(?:(?:SUPPLEMENTARY|SUPPLEMENTAL)\s+(?:DATA|INFORMATION|SCHEDULES?)|OTHER\s+FINANCIAL\s+INFORMATION))?`,
    "gi"
  ),
  // Item 8 [.—:] Index to (Consolidated) Financial Statements
  new RegExp(
    String.raw`\bITEM\s+8${ITEM8_HEADING_SEP}INDEX\s+TO\s+(?:THE\s+)?(?:(?:CONDENSED|CONSOLIDATED|COMBINED|UNAUDITED|AUDITED|ANNUAL)\s+){0,4}FINANCIAL\s+STATEMENTS\b`,
    "gi"
  ),
  // Item 8 [.—:] Financial Statements (minimal statutory caption)
  new RegExp(String.raw`\bITEM\s+8${ITEM8_HEADING_SEP}FINANCIAL\s+STATEMENTS?\b`, "gi"),
];

function startPatternsForForm(form: string): RegExp[] {
  if (form.includes("10-Q")) {
    return [/\bITEM\s+1[\.\u2014\u2013\-]?\s*(?:(?:condensed|consolidated|combined|unaudited)\s+){0,4}FINANCIAL\s+STATEMENTS\b/gi];
  }
  return ITEM8_FINANCIAL_STATEMENTS_START_PATTERNS;
}

function partSectionSearchStart(acc: string, form: string): number {
  const re = form.includes("10-Q") ? /\bPART\s+I\b/gi : /\bPART\s+II\b/gi;
  const hits = findAllMatchIndices(acc, re);
  if (hits.length === 0) return 0;
  const earlyThreshold = form.includes("10-Q") ? 15_000 : 35_000;
  /** Skip first Part hit only when the next hit is far enough to be body (not TOC Part I → Part II). */
  const minSkipGap = form.includes("10-Q") ? 5_000 : 8_000;
  if (
    hits.length >= 2 &&
    hits[0]! < earlyThreshold &&
    hits[1]! - hits[0]! >= minSkipGap &&
    hits[1]! - hits[0]! < 120_000
  ) {
    return hits[1] ?? hits[0]!;
  }
  return hits[0]!;
}

function strongBodyAnchorPatternsForForm(form: string): RegExp[] {
  if (form.includes("10-K")) {
    return [
      /\bindex\s+to\s+consolidated\s+financial\s+statements\b/gi,
      /\breport\s+of\s+independent\s+registered\s+public\s+accounting\s+firm\b/gi,
    ];
  }
  return [];
}

function findBodyAnchor(acc: string, form: string): number | null {
  const searchStart = partSectionSearchStart(acc, form);
  const headingPatterns = (["bs", "is", "cf"] as StatementKind[]).flatMap((kind) => statementHeadingPatterns(kind));
  const bodyAnchorPatterns = [
    /\bindex\s+to\s+consolidated\s+financial\s+statements\b/gi,
    /\breport\s+of\s+independent\s+(?:registered\s+public\s+)?accounting\s+firm\b/gi,
    /\breport\s+of\s+independent\s+auditors\b/gi,
  ];
  if (form.includes("10-K")) {
    const item8Starts = collectMatches(acc, startPatternsForForm(form), searchStart);
    const bodyItem8Start = item8Starts[item8Starts.length - 1] ?? searchStart;
    for (const anchorStart of [bodyItem8Start, searchStart, 0]) {
      const anchorMatches = collectMatches(acc, bodyAnchorPatterns, anchorStart).filter(
        (index) => !isLikelyIndexListingContext(acc, index) || index >= bodyItem8Start + 5_000
      );
    if (anchorMatches.length > 0) return anchorMatches[0] ?? null;
    }
  }
  const strongMatches = collectMatches(acc, strongBodyAnchorPatternsForForm(form), searchStart).filter(
    (index) => !isLikelyIndexListingContext(acc, index)
  );
  if (strongMatches.length > 0) return strongMatches[0] ?? null;
  const fallbackMatches = collectMatches(acc, headingPatterns, searchStart).filter(
    (index) => !isLikelyIndexListingContext(acc, index) && !isPhantomCashFlowHeadingMatchInFlattenedAcc(acc, index)
  );
  if (fallbackMatches.length > 0) return fallbackMatches[0] ?? null;
  if (searchStart > 0) {
    const fullDocFallbackMatches = collectMatches(acc, headingPatterns, 0).filter(
      (index) => !isLikelyIndexListingContext(acc, index) && !isPhantomCashFlowHeadingMatchInFlattenedAcc(acc, index)
    );
    if (fullDocFallbackMatches.length > 0) return fullDocFallbackMatches[0] ?? null;
  }
  return null;
}

function hasLateCrossReferenceStart(
  acc: string,
  form: string,
  itemStarts: number[],
  tables: Array<{ el: Element; offset: number }>
): boolean {
  if (itemStarts.length === 0) return false;
  const firstItemStart = itemStarts[0]!;
  const lateThreshold = Math.floor(acc.length * (form.includes("10-Q") ? 0.72 : 0.8));
  if (firstItemStart < lateThreshold) return false;
  const buffer = Math.min(form.includes("10-Q") ? 8_000 : 12_000, Math.max(1_200, Math.floor(acc.length * 0.35)));
  const headingCutoff = firstItemStart - buffer;
  if (headingCutoff <= 0) return false;
  const hasEarlierHeadings = (["bs", "is", "cf"] as StatementKind[]).every((kind) => {
    const raw = collectMatches(acc, statementHeadingPatterns(kind), 0);
    const offs = kind === "cf" ? dropPhantomCashFlowHeadingMatches(acc, raw) : raw;
    return offs.some(
      (offset) =>
        offset < headingCutoff && !isLikelyIndexListingContext(acc, offset)
    );
  });
  if (hasEarlierHeadings) return true;
  const earlierTableCount = tables.filter((table) => table.offset < headingCutoff).length;
  return earlierTableCount >= 3;
}

function findSectionEnd(acc: string, form: string, start: number): number {
  const minDistance = form.includes("10-Q") ? 1200 : 3000;
  const softMinDistance = form.includes("10-Q") ? 250 : 800;
  const candidates = collectMatches(acc, endPatternsForForm(form), start);
  const strictEnd = candidates.find((idx) => idx >= start + minDistance);
  if (strictEnd != null) return strictEnd;
  const softEnd = candidates.find((idx) => idx >= start + softMinDistance);
  return softEnd ?? acc.length;
}

function isLikelyTocItemMarker(acc: string, start: number, form: string): boolean {
  const earlyPreview = acc.slice(start, Math.min(acc.length, start + 1200));
  const previewItemCount = earlyPreview.match(/\bitem\s+\d+[a-z]?\b/gi)?.length ?? 0;
  if (/\b(index\s+page|table\s+of\s+contents)\b/i.test(earlyPreview)) return true;
  /** TOC lines often list consecutive items with a page number between them. */
  if (previewItemCount >= 2) return true;
  if (/\bfinancial\s+statements\b[\s\S]{0,48}?\b\d{1,3}\b[\s\S]{0,48}?\bitem\s+\d+\b/i.test(earlyPreview)) return true;
  if (form.includes("10-K") && /\bpart\s+iii\b/i.test(earlyPreview)) return true;
  return false;
}

function tenQStatementHeadingPreviewCues(preview: string): { hasIs: boolean; hasBs: boolean; hasCf: boolean } {
  const hasIs =
    /\b(?:condensed\s+)?consolidated\s+statements?\s+of\s+(?:operations|income)\b/i.test(preview) ||
    /\bconsolidated\s+statements?\s+of\s+operations\b/i.test(preview);
  const hasBs =
    /\b(?:condensed\s+)?consolidated\s+balance\s+sheets?\b/i.test(preview) ||
    /\bconsolidated\s+balance\s+sheets?\b/i.test(preview);
  const hasCf =
    /\b(?:condensed\s+)?consolidated\s+statements?\s+of\s+cash\s+flows?\b/i.test(preview) ||
    /\bconsolidated\s+statements?\s+of\s+cash\s+flows?\b/i.test(preview);
  return { hasIs, hasBs, hasCf };
}

/** Canonical Part I Item 1 (10-Q) or Part II Item 8 (10-K) bounds for primary statements. */
function resolvePrimaryFinancialStatementsItemStart(acc: string, form: string): number | null {
  const normalized = form.toUpperCase();
  const searchStart = partSectionSearchStart(acc, normalized);
  let itemStarts = collectMatches(acc, startPatternsForForm(normalized), searchStart);
  if (itemStarts.length === 0 && searchStart > 0) {
    itemStarts = collectMatches(acc, startPatternsForForm(normalized), 0);
  }
  if (itemStarts.length === 0) return null;

  if (normalized.includes("10-K")) {
    const bodyAnchor = findBodyAnchor(acc, normalized);
    const filtered = itemStarts.filter((start) => {
      if (isLikelyTocItemMarker(acc, start, normalized)) return false;
      if (bodyAnchor != null && start < bodyAnchor - 5_000) {
        const preview = acc.slice(start, Math.min(acc.length, start + 1200));
        if (
          /\b(index\s+page|index\s+to\s+consolidated\s+financial\s+statements|table\s+of\s+contents)\b/i.test(
            preview
          ) ||
          (preview.match(/\bitem\s+\d+[a-z]?\b/gi)?.length ?? 0) >= 2
        ) {
          return false;
        }
      }
      return true;
    });
    const candidates = filtered.length ? filtered : itemStarts.filter((start) => !isLikelyTocItemMarker(acc, start, normalized));
    if (bodyAnchor != null) {
      const nearBody = candidates.filter((start) => start >= bodyAnchor - 2_000 && start <= bodyAnchor + 20_000);
      if (nearBody.length > 0) return nearBody[0]!;
    }
    return candidates[candidates.length - 1] ?? itemStarts[itemStarts.length - 1] ?? null;
  }

  if (normalized.includes("10-Q")) {
    for (let idx = 0; idx < itemStarts.length; idx += 1) {
      const start = itemStarts[idx]!;
      if (isLikelyTocItemMarker(acc, start, normalized)) continue;
      const nextItem = itemStarts[idx + 1] ?? acc.length;
      const preview = acc.slice(start, Math.min(nextItem, start + 15_000));
      const { hasIs, hasBs, hasCf } = tenQStatementHeadingPreviewCues(preview);
      if (hasIs && hasBs && hasCf) return start;
      if (hasIs) return start;
    }
  }

  for (const start of itemStarts) {
    if (!isLikelyTocItemMarker(acc, start, normalized)) return start;
  }
  return itemStarts[0] ?? null;
}

function findPrimaryFinancialStatementsItemSectionBounds(acc: string, form: string): FilingSectionBounds | null {
  const start = resolvePrimaryFinancialStatementsItemStart(acc, form);
  if (start == null) return null;
  const end = findSectionEnd(acc, form, start);
  if (end <= start) return null;
  return { start, end };
}

export function __test_findPrimaryFinancialStatementsItemSectionBounds(
  acc: string,
  form: string
): FilingSectionBounds | null {
  return findPrimaryFinancialStatementsItemSectionBounds(acc, form);
}

export function __test_flatAccFromHtml(html: string): string {
  const $ = cheerio.load(html);
  return buildFlatTextAndTableOffsets($).acc;
}

function statementFromClusterHit(
  $: cheerio.CheerioAPI,
  acc: string,
  section: FilingSectionBounds,
  hit: StatementTableCandidate,
  kind: StatementKind,
  form: string,
  primaryDocument?: string,
  sourceUrl?: string
): FilingHtmlStatement | null {
  const unitsHint = extractUnitsFromText(acc.slice(Math.max(section.start, hit.table.offset - 500), hit.table.offset));
  return returnParsedPrimaryStatementIfValid(
    parsePrimaryStatementTable($, $(hit.table.el), kind, unitsHint, primaryDocument, sourceUrl, hit.table.offset),
    form
  );
}

function parseAllStatementsFromCluster(
  ctx: ParsedFilingHtmlContext,
  cluster: StatementCluster,
  section: FilingSectionBounds,
  opts: { form: string; primaryDocument?: string; sourceUrl?: string }
): FilingHtmlStatement[] {
  const form = opts.form.toUpperCase();
  return (["is", "bs", "cf"] as StatementKind[])
    .map((kind) => {
      const hit = kind === "bs" ? cluster.bs : kind === "is" ? cluster.is : cluster.cf;
      return statementFromClusterHit(ctx.$, ctx.acc, section, hit, kind, form, opts.primaryDocument, opts.sourceUrl);
    })
    .filter((stmt): stmt is FilingHtmlStatement => Boolean(stmt));
}

function findStatementClusterInPrimaryItemSection(
  ctx: ParsedFilingHtmlContext,
  form: string
): { cluster: StatementCluster; section: FilingSectionBounds } | null {
  const section = findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, form);
  if (!section) return null;
  const cluster = findStatementClusterInSection(ctx.$, ctx.acc, ctx.tables, section, form);
  if (!cluster) return null;
  return { cluster, section };
}

const NOTES_HEADING_PATTERNS: RegExp[] = [
  /\bnotes\s+to\s+(?:the\s+)?(?:unaudited\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:the\s+)?consolidated\s+financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:the\s+)?financial\s+statements\b/gi,
];

/** Max chars after Item 8 start to scan for decoy clusters in 10-K filings. */
const PRIMARY_FACE_CHAR_WINDOW_10K = 28_000;
/** Max `<table>` anchors to scan as cluster anchors in 10-K Item 8. */
const PRIMARY_FACE_MAX_TABLES_10K = 10;
/** Max offset span between first and last primary statement table in 10-K. */
const PRIMARY_FACE_CLUSTER_MAX_SPAN_10K = 32_000;

function isPrimaryFaceStatementHeading(acc: string, offset: number, form: string): boolean {
  if (isLikelyIndexListingContext(acc, offset)) return false;
  const preview = acc.slice(offset, Math.min(acc.length, offset + 160));
  const matchesKnownHeading = (["is", "bs", "cf"] as StatementKind[]).some((kind) =>
    statementHeadingPatterns(kind).some((re) => {
      re.lastIndex = 0;
      return re.test(preview);
    })
  );
  if (!matchesKnownHeading) return false;
  if (form.includes("10-Q")) {
    return (
      /\bcondensed\s+consolidated\b/i.test(preview) ||
      /\bconsolidated\s+(?:balance\s+sheets?|statements?\s+of)\b/i.test(preview)
    );
  }
  if (form.includes("10-K")) return /\bconsolidated\b/i.test(preview);
  return true;
}

function firstPrimaryFaceStatementAnchor(acc: string, section: FilingSectionBounds, form: string): number {
  const hits = (["is", "bs", "cf"] as StatementKind[])
    .flatMap((kind) => {
      const raw = collectMatches(acc, statementHeadingPatterns(kind), section.start);
      const offs = kind === "cf" ? dropPhantomCashFlowHeadingMatches(acc, raw) : raw;
      return offs.filter((offset) => offset < section.end && isPrimaryFaceStatementHeading(acc, offset, form));
    })
    .sort((a, b) => a - b);
  return hits[0] ?? section.start;
}

function primaryStatementsCeiling(acc: string, section: FilingSectionBounds, form: string): number {
  const cfFiltered = dropPhantomCashFlowHeadingMatches(acc, collectMatches(acc, statementHeadingPatterns("cf"), section.start));
  const firstCashFlowHeading = cfFiltered.find((offset) => {
    if (offset >= section.end) return false;
    if (form.includes("10-Q") || form.includes("10-K")) {
      return isPrimaryFaceStatementHeading(acc, offset, form);
    }
    return !isLikelyIndexListingContext(acc, offset);
  });
  const firstStatementAnchor = firstPrimaryFaceStatementAnchor(acc, section, form);
  const notesSearchStart =
    firstCashFlowHeading ??
    collectMatches(acc, statementHeadingPatterns("bs"), section.start).find((offset) =>
      isPrimaryFaceStatementHeading(acc, offset, form)
    ) ??
    Math.max(section.start + 800, firstStatementAnchor);
  const notes = collectMatches(acc, NOTES_HEADING_PATTERNS, notesSearchStart).find(
    (offset) => offset < section.end && !isLikelyIndexListingContext(acc, offset)
  );
  return notes ?? section.end;
}

/** Tighter window for cluster scan anchors — not for heading→table binding. */
function primaryFaceClusterScanCeiling(
  acc: string,
  section: FilingSectionBounds,
  form: string,
  tables: Array<{ el: Element; offset: number }>
): number {
  const notesCeiling = primaryStatementsCeiling(acc, section, form);
  if (!form.includes("10-K")) return notesCeiling;

  const localTables = tables
    .filter((t) => t.offset >= section.start && t.offset < notesCeiling)
    .sort((a, b) => a.offset - b.offset);

  const charCap = section.start + PRIMARY_FACE_CHAR_WINDOW_10K;
  const tableCap =
    localTables.length >= PRIMARY_FACE_MAX_TABLES_10K
      ? localTables[PRIMARY_FACE_MAX_TABLES_10K - 1]!.offset + 8_000
      : notesCeiling;

  const consolidatedIsHeadings = collectMatches(acc, statementHeadingPatterns("is"), section.start).filter(
    (offset) => offset < notesCeiling && isPrimaryFaceStatementHeading(acc, offset, form)
  );
  const fromFirstIs =
    consolidatedIsHeadings[0] != null ? consolidatedIsHeadings[0]! + 28_000 : notesCeiling;

  return Math.min(notesCeiling, charCap, tableCap, fromFirstIs);
}

function primaryFaceTablePickCeiling(acc: string, section: FilingSectionBounds, form: string): number {
  return primaryStatementsCeiling(acc, section, form);
}

function findHeadingTableInSection(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  section: FilingSectionBounds,
  kind: StatementKind,
  form: string
): { headingOffset: number; table: { el: Element; offset: number } } | null {
  const statementCeiling = primaryFaceTablePickCeiling(acc, section, form);
  const bsH = collapseNearbyHeadingOffsets(collectMatches(acc, statementHeadingPatterns("bs"), section.start));
  const isH = collapseNearbyHeadingOffsets(collectMatches(acc, statementHeadingPatterns("is"), section.start));
  const cfH = collapseNearbyHeadingOffsets(
    dropPhantomCashFlowHeadingMatches(acc, collectMatches(acc, statementHeadingPatterns("cf"), section.start))
  );
  const allHeadings = [...bsH, ...isH, ...cfH].filter((offset) => offset < statementCeiling).sort((a, b) => a - b);
  const headings = (
    kind === "cf" ? cfH : collapseNearbyHeadingOffsets(collectMatches(acc, statementHeadingPatterns(kind), section.start))
  )
    .filter((offset) => offset < statementCeiling && isPrimaryFaceStatementHeading(acc, offset, form));
  const headingCandidates: Array<{ headingOffset: number; table: { el: Element; offset: number }; score: number }> = [];
  for (const headingOffset of headings) {
    const nextHeading = allHeadings.find((offset) => offset > headingOffset) ?? statementCeiling;
    const candidates = tables.filter(
      (t) =>
        t.offset >= Math.max(section.start, headingOffset - 250) &&
        t.offset < nextHeading &&
        t.offset < statementCeiling &&
        t.offset - headingOffset < 40_000 &&
        isPrimaryFaceTableCandidate($, t, kind)
    );
    if (candidates.length === 0) continue;
    const scored = candidates
      .map((table) => {
        const text = normalizeSpace($(table.el).text()).slice(0, 6_000);
        const axes = parsedPrimaryStatementAxes($, $(table.el), kind);
        return {
          table,
          score:
            scoreStatementTableText(text, kind) +
            scoreParsedTableStructure($, $(table.el), kind) -
            trendSummaryPenaltyForTenK(kind, form, text, axes) -
            cashFlowsCrossReferenceFootnotePenalty(kind, text),
        };
      })
      .sort((a, b) => b.score - a.score || a.table.offset - b.table.offset);
    const pick = scored[0];
    if (pick && pick.score >= 20) headingCandidates.push({ headingOffset, table: pick.table, score: pick.score + 20 });
  }

  const fallback = tables
    .filter(
      (t) =>
        t.offset >= section.start &&
        t.offset < statementCeiling &&
        isPrimaryFaceTableCandidate($, t, kind)
    )
    .map((table) => {
      const text = normalizeSpace($(table.el).text()).slice(0, 6_000);
      const context = acc.slice(Math.max(section.start, table.offset - 700), table.offset);
      const axes = parsedPrimaryStatementAxes($, $(table.el), kind);
      let score =
        scoreStatementTableText(text, kind) +
        scoreParsedTableStructure($, $(table.el), kind) -
        trendSummaryPenaltyForTenK(kind, form, text, axes) -
        cashFlowsCrossReferenceFootnotePenalty(kind, text);
      if (statementHeadingPatterns(kind).some((re) => re.test(context))) score += 80;
      const otherKinds = (["bs", "is", "cf"] as StatementKind[]).filter((k) => k !== kind);
      if (otherKinds.some((k) => statementHeadingPatterns(k).some((re) => re.test(context)))) score -= 50;
      return { table, score };
    })
    .sort((a, b) => b.score - a.score || a.table.offset - b.table.offset)[0];

  const bestHeading = headingCandidates.sort((a, b) => b.score - a.score || a.table.offset - b.table.offset)[0];
  if (bestHeading && (!fallback || bestHeading.score >= fallback.score)) {
    return { headingOffset: bestHeading.headingOffset, table: bestHeading.table };
  }
  if (fallback && fallback.score >= 40) return { headingOffset: section.start, table: fallback.table };

  const earliestFace = earliestPrimaryFaceTableInSection($, tables, section.start, statementCeiling, kind);
  if (earliestFace) return { headingOffset: section.start, table: earliestFace };
  return null;
}

function findFinancialSectionBounds(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  form: string
): FilingSectionBounds | null {
  const searchStart = partSectionSearchStart(acc, form);
  const baseStarts = collectMatches(acc, startPatternsForForm(form), searchStart);
  const bodyAnchor = findBodyAnchor(acc, form);
  const starts = Array.from(new Set([...baseStarts, ...(bodyAnchor != null ? [bodyAnchor] : [])])).sort((a, b) => a - b);
  let best: { bounds: FilingSectionBounds; score: number } | null = null;

  for (const start of starts) {
    const earlyPreview = acc.slice(start, Math.min(acc.length, start + 1200));
    const previewItemCount = earlyPreview.match(/\bitem\s+\d+[a-z]?\b/gi)?.length ?? 0;
    if (
      form.includes("10-K") &&
      bodyAnchor != null &&
      start < bodyAnchor - 5_000 &&
      (
        /\b(index\s+page|index\s+to\s+consolidated\s+financial\s+statements|table\s+of\s+contents)\b/i.test(earlyPreview) ||
        previewItemCount >= 2 ||
        /\bpart\s+iii\b/i.test(earlyPreview)
      )
    ) {
      continue;
    }
    const end =
      form.includes("10-K") && bodyAnchor != null && start >= bodyAnchor
        ? acc.length
        : findSectionEnd(acc, form, start);
    if (end <= start) continue;
    const bounds = { start, end };
    const cluster = findStatementClusterInSection($, acc, tables, bounds, form);
    const hits = cluster ? 3 : 0;
    const tableCount = tables.filter((t) => t.offset >= start && t.offset < end).length;
    const span = end - start;
    const preview = acc.slice(start, Math.min(end, start + 1600));
    const bodyCueScore =
      (/\breport\s+of\s+independent\s+registered\s+public\s+accounting\s+firm\b/i.test(preview) ? 300 : 0) +
      (/\bindex\s+to\s+consolidated\s+financial\s+statements\b/i.test(preview) ? 200 : 0) +
      (/\bnotes\s+to\s+(?:the\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/i.test(preview) ? 120 : 0);
    const tocPenalty =
      /\bitem\s+9a?[\.\u2014\u2013\-]/i.test(preview) && start < 100_000
        ? 450
        : /\btable\s+of\s+contents\b/i.test(preview)
          ? 300
          : 0;
    const clusterScore = cluster ? cluster.score : 0;
    const score = hits * 500 + clusterScore * 4 + Math.min(tableCount, 15) * 15 + Math.min(Math.floor(span / 4000), 20) + bodyCueScore - tocPenalty;
    if (!best || score > best.score || (score === best.score && start > best.bounds.start)) {
      best = { bounds, score };
    }
  }

  return best?.bounds ?? null;
}

function parseSpan(value: string | undefined): number {
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function directRowCells($: cheerio.CheerioAPI, tr: Element): Element[] {
  return $(tr)
    .children("th,td")
    .toArray()
    .filter((node): node is Element => node.type === "tag");
}

function isBlankCellText(text: string): boolean {
  return text === "" || text === "—" || text === "-";
}

function extractTableMatrix($: cheerio.CheerioAPI, $table: cheerio.Cheerio<Element>): string[][] {
  const grid: string[][] = [];
  const carry: Array<{ text: string; rowsLeft: number } | null> = [];

  $table.find("tr").each((_, tr) => {
    const row: string[] = [];
    let col = 0;

    const fillCarry = () => {
      while (carry[col]) {
        const slot = carry[col]!;
        row[col] = slot.text;
        slot.rowsLeft -= 1;
        if (slot.rowsLeft <= 0) carry[col] = null;
        col += 1;
      }
    };

    fillCarry();
    for (const cell of directRowCells($, tr as Element)) {
      fillCarry();
      while (row[col] !== undefined) col += 1;
      const $cell = $(cell);
      const text = normalizeSpace($cell.text());
      const colspan = parseSpan($cell.attr("colspan"));
      const rowspan = parseSpan($cell.attr("rowspan"));
      for (let i = 0; i < colspan; i += 1) {
        row[col + i] = text;
        if (rowspan > 1) carry[col + i] = { text, rowsLeft: rowspan - 1 };
      }
      col += colspan;
    }
    grid.push(row);
  });

  return grid;
}

function amountToken(value: string): string {
  return normalizeSpace(value).replace(/\$/g, "").replace(/,/g, "").replace(/\s+/g, "");
}

function looksLikeAmount(value: string): boolean {
  const token = amountToken(value);
  if (!token) return false;
  if (token === "-" || token === "—") return true;
  return /^\(?\d+(?:\.\d+)?\)?$/.test(token);
}

function parseDisplayedNumber(text: string): number | null {
  const raw = normalizeSpace(text);
  if (!raw || raw === "—" || raw === "-") return null;
  let normalized = raw.replace(/\$/g, "").replace(/,/g, "").replace(/\s+/g, "");
  const negative = /^\(.*\)$/.test(normalized);
  normalized = normalized.replace(/[()]/g, "");
  if (!/^-?\d*\.?\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function composeRawAmount(row: string[], col: number): string {
  const prev2 = col > 1 ? normalizeSpace(row[col - 2] ?? "") : "";
  const prev = col > 0 ? normalizeSpace(row[col - 1] ?? "") : "";
  const curr = normalizeSpace(row[col] ?? "");
  const next = normalizeSpace(row[col + 1] ?? "");
  const next2 = normalizeSpace(row[col + 2] ?? "");

  if (curr === "$" && next) {
    if (looksLikeAmount(next)) return `$${next}`;
    if (next === "(" && looksLikeAmount(next2)) return `($${next2})`;
  }
  if (curr === "(" && looksLikeAmount(next)) return `(${next})`;
  if (looksLikeAmount(curr)) {
    if (prev === "$" && curr.startsWith("(") && !curr.endsWith(")")) return `($${curr.slice(1)})`;
    if ((prev === "$(" || prev2 === "$" && prev === "(") && next === ")") return `($${curr})`;
    if (prev === "(" && next === ")") return `(${curr})`;
    if (prev === "$") return `$${curr}`;
    if (curr.startsWith("(") && !curr.endsWith(")")) return `${curr})`;
    return curr;
  }
  if (!curr && prev === "$" && looksLikeAmount(next)) return `$${next}`;
  return curr;
}

function looksLikePeriodText(value: string): boolean {
  const text = normalizeSpace(value);
  if (!text || text === "$") return false;
  return /\b(ended|ending|year|years|quarter|quarters|month|months|week|weeks|period|periods|fiscal|as of)\b/i.test(text)
    || /\b(20\d{2}|19\d{2})\b/.test(text)
    || /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text);
}

function looksLikeSubstantialAmount(value: string): boolean {
  if (!looksLikeAmount(value)) return false;
  const raw = normalizeSpace(value);
  if (/,/.test(raw)) return true;
  const parsed = parseDisplayedNumber(raw);
  return parsed != null && Math.abs(parsed) >= 100;
}

function isHeaderOnlyLabel(value: string): boolean {
  const text = normalizeSpace(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/^\((?:in|unaudited|dollars?)/i.test(text)) return true;
  if (/^for\s+the\s+\b(?:year|years|quarter|quarters|month|months|week|weeks)\s+ended\b/i.test(text)) return true;
  if (/^\b(?:year|years|quarter|quarters|month|months|week|weeks)\s+ended\b/i.test(text)) return true;
  if (/^\bat\s+[a-z]+\s+\d{1,2},?\b/i.test(text)) return true;
  if (/^(?:as\s+of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?(?:\s*\([^)]*\))?$/i.test(text)) {
    return true;
  }
  if (lower === "year ended" || lower === "years ended" || lower === "three months ended" || lower === "six months ended" || lower === "nine months ended") {
    return true;
  }
  return false;
}

function detectDataStart(matrix: string[][]): number {
  const classic = detectDataStartClassic(matrix);
  const enhanced = detectDataStartWithValueColumns(matrix);
  if (classic < 0) return enhanced;
  if (enhanced < 0) return classic;
  // Mirrored HTML tables can satisfy col-0 + 2 amounts only on trailing supplemental rows.
  if (classic >= Math.floor(matrix.length * 0.7) && enhanced < classic) return enhanced;
  return classic;
}

function rowPrimaryLabel(row: string[]): string {
  for (let c = 0; c < Math.min(5, row.length); c += 1) {
    const labelCell = normalizeSpace(row[c] ?? "");
    if (!labelCell || labelCell === "$") continue;
    if (looksLikeAmount(labelCell) && !isHeaderOnlyLabel(labelCell)) continue;
    if (isHeaderOnlyLabel(labelCell)) continue;
    if (/^(?:19|20)\d{2}$/.test(labelCell)) continue;
    if (looksLikePeriodText(labelCell)) continue;
    return labelCell;
  }
  return "";
}

function countNumericCellsInRow(row: string[], cols: number[]): number {
  return cols.filter((col) => {
    const cell = row[col] ?? "";
    return looksLikeAmount(cell) && !isBlankCellText(cell);
  }).length;
}

function detectDataStartWithValueColumns(matrix: string[][]): number {
  const valueCols = inferValueColumnIndices(matrix, 0);
  if (valueCols.length === 0) return -1;

  for (let i = 0; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const label = rowPrimaryLabel(row);
    if (!label) continue;
    const inValueCols = countNumericCellsInRow(row, valueCols);
    const anywhere = row.filter((cell) => looksLikeAmount(cell) && !isBlankCellText(cell)).length;
    if (inValueCols >= 2 || (inValueCols >= 1 && anywhere >= 2)) return i;
  }
  return -1;
}

function detectDataStartClassic(matrix: string[][]): number {
  for (let i = 0; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const amountCount = row.filter((cell) => looksLikeAmount(cell) && !isBlankCellText(cell)).length;
    const labelCell = normalizeSpace(row[0] ?? "");
    if (labelCell && !looksLikeAmount(labelCell) && !isHeaderOnlyLabel(labelCell) && amountCount >= 2) return i;
  }
  return -1;
}

export function __test_detectDataStart(matrix: string[][]): number {
  return detectDataStart(matrix);
}

function inferValueColumnIndices(matrix: string[][], dataStart: number): number[] {
  const width = Math.max(...matrix.map((row) => row.length), 0);
  const counts = new Array<number>(width).fill(0);
  const substantialCounts = new Array<number>(width).fill(0);
  for (let r = dataStart; r < matrix.length; r += 1) {
    for (let c = 1; c < width; c += 1) {
      const cell = matrix[r]?.[c] ?? "";
      if (looksLikeAmount(cell) && !isBlankCellText(cell)) counts[c] += 1;
      if (looksLikeSubstantialAmount(cell) && !isBlankCellText(cell)) substantialCounts[c] += 1;
    }
  }
  const cols = counts
    .map((count, idx) => ({ count, substantial: substantialCounts[idx] ?? 0, idx }))
    .filter(({ count, substantial }) => count >= 2 && substantial >= 2)
    .map(({ idx }) => idx);
  /* Condensed filings often state amounts under $100m (still real statement columns — EVC-scale fixtures). Prefer substantial columns when any exist; otherwise use consistent numeric columns. */
  if (cols.length > 0) return cols;
  return counts
    .map((count, idx) => ({ count, idx }))
    .filter(({ count }) => count >= 2)
    .map(({ idx }) => idx);
}

function inferPeriods(matrix: string[][], dataStart: number, valueCols: number[]): Array<{ key: string; label: string; shortLabel?: string }> {
  const inferred = valueCols.map((col, idx) => {
    const parts = dedupeAdjacent(
      matrix
        .slice(0, Math.max(dataStart, 0))
        .map((row) => {
          const direct = normalizeSpace(row[col] ?? "");
          if (direct && direct !== "$" && (looksLikePeriodText(direct) || !looksLikeAmount(direct))) return direct;
          for (let distance = 1; distance <= 3; distance += 1) {
            for (const c of [col - distance, col + distance]) {
              if (c < 0) continue;
              const probe = normalizeSpace(row[c] ?? "");
              if (looksLikePeriodText(probe)) return probe;
            }
          }
          return "";
        })
        .filter(Boolean)
    );
    const label = parts.join(" ").trim() || `Period ${idx + 1}`;
    return { key: `p${idx + 1}`, label, shortLabel: label };
  });

  const headerYears = dedupeAdjacent(
    matrix
      .slice(0, Math.max(dataStart, 0))
      .flatMap((row) => row.map((cell) => normalizeSpace(cell)))
      .filter((cell) => /^(?:19|20)\d{2}$/.test(cell))
  );
  if (headerYears.length >= inferred.length) {
    return inferred.map((period, idx) => {
      if (/\b(?:19|20)\d{2}\b/.test(period.label)) return period;
      const year = headerYears[idx];
      if (!year) return period;
      const label = `${period.label} ${year}`.trim();
      return { ...period, label, shortLabel: label };
    });
  }

  return inferred;
}

function rowKeepsNativeUnits(label: string, kind: StatementKind): boolean {
  if (kind !== "is") return false;
  const normalized = normalizeSpace(label).toLowerCase().replace(/[.:]+$/g, "").trim();
  /** Face income statements often use only "Basic" / "Diluted" for EPS (no "per share" in the row label). */
  if (/^(?:basic|diluted)$/.test(normalized)) return true;
  if (/\bearnings\s+per\s+(?:common\s+)?share\b/.test(normalized)) return true;
  if (/\b(?:basic|diluted)\s+(?:and\s+)?(?:diluted\s+)?(?:earnings|income|loss)\s+per\s+(?:common\s+)?share\b/.test(normalized)) {
    return true;
  }
  return /\bper\s+share\b/.test(normalized) || /\bweighted\s+average\b/.test(normalized) || /\bshares?\b/.test(normalized);
}

function unitsToMillionsFactor(units?: string): number | null {
  const normalized = normalizeSpace(units ?? "").toLowerCase();
  if (!normalized) return null;
  if (/\bbillion/.test(normalized)) return 1000;
  if (/\bmillion/.test(normalized)) return 1;
  if (/\bthousand/.test(normalized)) return 0.001;
  return null;
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function scoreStatementTableText(text: string, kind: StatementKind): number {
  const t = normalizeSpace(text).toLowerCase();
  const cueCount = (parts: string[]) => parts.reduce((sum, part) => sum + (t.includes(part) ? 1 : 0), 0);
  const bs = cueCount(["current assets", "total assets", "liabilities", "stockholders' equity", "shareholders' equity"]);
  const bsAssets = cueCount(["current assets", "total assets", "cash and cash equivalents", "accounts receivable", "inventory"]);
  const is = cueCount(["revenues", "revenue", "net sales", "sales", "gross profit", "income before", "net income", "net loss", "operating income", "loss from operations"]);
  const isProfit = cueCount(["net income", "net loss", "income before", "loss before", "total net sales", "net sales"]);
  const cf = cueCount(["operating activities", "investing activities", "financing activities", "net cash", "cash and cash equivalents"]);
  const cfCore = cueCount(["operating activities", "investing activities", "financing activities", "net cash"]);
  const epsNotePenalty = isLikelyEpsNoteTableText(t) ? 280 : 0;
  const revenueDisaggregationPenalty = isLikelyRevenueDisaggregationTableText(t) ? 280 : 0;
  const summaryPenalty =
    (/\bstatement(?:s)? of operations data\b/.test(t) ? 90 : 0) +
    (/\bbalance sheet data\b/.test(t) ? 90 : 0) +
    (/\bselected (?:consolidated )?financial data\b/.test(t) ? 140 : 0) +
    (/\bfive (?:years?|fiscal years?)\s+ended\b/.test(t) ? 110 : 0) +
    (/\b(as a percentage of revenues|adjusted ebitda|transaction days)\b/.test(t) ? 60 : 0) +
    (/\b\d{4}\s+vs\.\s+\d{4}\b/.test(t) || /\bchange\b[^.]{0,60}\b%\b/.test(t) ? 50 : 0);
  if (kind === "bs") {
    let score = bs * 20 - is * 6 - cf * 8 - summaryPenalty;
    if (isLikelyParentheticalOrHeldForSaleBalanceSheetTable(t)) score -= 520;
    if (bsAssets === 0) score -= 80;
    /* Prefer classic asset‑first snapshots; tails that start mid‑liabilities are common mis‑picks on older HTML filings. */
    const idxTa = t.search(/\btotal assets\b/);
    const idxTl = t.search(/\btotal liabilities\b/);
    if (idxTa >= 0 && idxTl >= 0 && idxTa > idxTl) score -= 120;
    else if (
      /\b(non-)?current liabilities\b/.test(t) &&
      /\b(shareholders?'? equity|stockholders?'? equity|retained earnings)\b/.test(t) &&
      !/\b(total assets|current assets|total current assets)\b/.test(t)
    ) {
      score -= 100;
    }
    if (/\bgross lease receivables\b/.test(t) || /\bnet investment in sales-type leases\b/.test(t) || /\breported as:\b/.test(t)) {
      score -= 80;
    }
    return score;
  }
  if (kind === "is") {
    let score = is * 20 - bs * 8 - cf * 6 - summaryPenalty - epsNotePenalty;
    if (isLikelyOtherComprehensiveIncomeOnlyTable(t)) score -= 520;
    if (/\bmanagement fees\b/.test(t) || /\badvisory (and transaction )?fees\b/.test(t) || /\btotal revenues?,?\s*net\b/.test(t)) {
      score += 24;
    }
    if (isProfit === 0) score -= 50;
    return score;
  }
  let score = cf * 22 - bs * 6 - is * 6 - summaryPenalty - revenueDisaggregationPenalty;
  if (cfCore === 0) score -= 140;
  return score;
}

type StatementTableCandidate = {
  kind: StatementKind;
  table: { el: Element; offset: number };
  score: number;
};

type StatementCluster = {
  bs: StatementTableCandidate;
  is: StatementTableCandidate;
  cf: StatementTableCandidate;
  score: number;
  start: number;
  end: number;
  ceiling: number;
};

function statementClusterTablesLookValid($: cheerio.CheerioAPI, cluster: StatementCluster): boolean {
  return (
    statementTableTextLooksLikePrimaryFace($, cluster.bs.table, "bs") &&
    statementTableTextLooksLikePrimaryFace($, cluster.is.table, "is") &&
    statementTableTextLooksLikePrimaryFace($, cluster.cf.table, "cf")
  );
}

function validateSinglePrimaryStatementShape(stmt: FilingHtmlStatement, form: string): boolean {
  const formUpper = form.toUpperCase();
  if (stmt.rows.length < 4) return false;
  if (stmt.periods.length < expectedMinPeriodsForStatement(stmt.id, formUpper)) return false;

  const labels = stmt.rows
    .slice(0, 16)
    .map((row) => row.label.toLowerCase())
    .join("\n");

  if (stmt.id === "balance-sheet") {
    if (isLikelyLeaseFootnoteBalanceSheetTable(labels)) return false;
    if (isLikelyCashRollupCrossReferenceToCashFlowStatement(labels)) return false;
    if (isLikelyParentheticalOrHeldForSaleBalanceSheetTable(labels)) return false;
    return (
      (/\btotal assets\b/.test(labels) && !/\btotal assets held for sale\b/.test(labels)) ||
      /\btotal current assets\b/.test(labels) ||
      (/\bcash and cash equivalents\b/.test(labels) &&
        (/\baccounts receivable\b/.test(labels) || /\binventory\b/.test(labels)))
    );
  }

  if (stmt.id === "income-statement") {
    if (isLikelyOtherComprehensiveIncomeOnlyTable(labels)) return false;
    if (isLikelyHighLevelIncomeSummaryTable(labels)) return false;
    if (isLikelyMinimalOperatingResultsIncomeTable(labels)) return false;
    const revenueCue =
      primaryFaceOperatingRevenueCue(labels) ||
      /\bnet sales\b/.test(labels) ||
      /\btotal net sales\b/.test(labels);
    const earningsCue =
      /\bnet income\b/.test(labels) ||
      /\bnet loss\b/.test(labels) ||
      /\bgross profit\b/.test(labels) ||
      /\boperating income\b/.test(labels);
    return revenueCue && earningsCue;
  }

  if (isLikelyCashRollupCrossReferenceToCashFlowStatement(labels)) return false;
  return (
    /\boperating activities\b/.test(labels) ||
    /\bnet cash (?:provided|used)\b/.test(labels) ||
    (/\bnet income\b/.test(labels) && /\bdepreciation\b/.test(labels))
  );
}

function returnParsedPrimaryStatementIfValid(
  parsed: FilingHtmlStatement | null,
  form: string
): FilingHtmlStatement | null {
  if (!parsed) return null;
  return validateSinglePrimaryStatementShape(parsed, form) ? parsed : null;
}

export function __test_validateSinglePrimaryStatementShape(stmt: FilingHtmlStatement, form: string): boolean {
  return validateSinglePrimaryStatementShape(stmt, form);
}

function primaryStatementsShapeValid(statements: FilingHtmlStatement[], form: string): boolean {
  const required: FilingHtmlStatement["id"][] = ["income-statement", "balance-sheet", "cash-flow"];
  if (statements.length < 3) return false;
  for (const id of required) {
    const stmt = statements.find((candidate) => candidate.id === id);
    if (!stmt || !validateSinglePrimaryStatementShape(stmt, form)) return false;
  }
  return true;
}

function scoreParsedTableStructure(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<Element>,
  kind: StatementKind
): number {
  const matrix = extractTableMatrix($, $table);
  const dataStart = detectDataStart(matrix);
  if (dataStart < 0) return -140;

  const valueCols = inferValueColumnIndices(matrix, dataStart);
  if (valueCols.length === 0) return -140;

  const periods = inferPeriods(matrix, dataStart, valueCols);
  const rows = parseStatementRows($, $table, matrix, dataStart, valueCols, periods);
  if (rows.length === 0) return -140;

  const dataRows = rows.filter((r) => r.rowKind !== "heading");
  const topRows = dataRows.slice(0, 8).map((row) => row.label.toLowerCase());
  let score = Math.min(dataRows.length, 24) + Math.min(periods.length, kind === "bs" ? 2 : 3) * 20;
  if (kind === "is" && dataRows.length > 0 && dataRows.length < 6) score -= 120;
  if (kind === "bs" && dataRows.length > 0 && dataRows.length < 8) score -= 120;
  if (kind === "cf" && dataRows.length > 0 && dataRows.length < 5) score -= 120;
  if (rows.length < 6) score -= 40;

  if (kind === "bs") {
    if (topRows.some((label) => /\b(cash and cash equivalents|current assets|total assets|accounts receivable|inventory)\b/i.test(label))) {
      score += 40;
    } else {
      score -= 40;
    }
  } else if (kind === "is") {
    if (
      topRows.some((label) => /\b(total revenue|total revenues|revenue|revenues|net income|net loss)\b/i.test(label))
    ) {
      score += 40;
    } else if (
      topRows.some((label) =>
        /\b(management fees|management fees?,?\s*net|advisory and transaction fees|total revenues?,?\s*net)\b/i.test(label)
      )
    ) {
      score += 36;
    } else {
      score -= 40;
    }
  } else if (topRows.some((label) => /\b(cash flows from operating activities|net income|net loss|operating activities|net cash)\b/i.test(label))) {
    score += 50;
  } else {
    score -= 50;
  }

  return score;
}

function scoreTableCandidate(
  $: cheerio.CheerioAPI,
  acc: string,
  table: { el: Element; offset: number },
  section: FilingSectionBounds,
  kind: StatementKind,
  form = "",
  shapeTemplates?: PrimaryFaceShapeTemplates
): number {
  const text = normalizeSpace($(table.el).text()).slice(0, 6_000);
  if (isLikelyStatementIndexTableText(text)) return -500;
  if (kind === "is" && isLikelyEpsNoteTableText(text)) return -500;
  if (kind === "is" && isLikelySegmentReportingIncomeTable(text)) return -520;
  if (kind === "is" && isLikelyRevenueDisaggregationTableText(text)) return -520;
  if (kind === "is" && isLikelyHighLevelIncomeSummaryTable(text)) return -480;
  if (kind === "is" && isLikelyMinimalOperatingResultsIncomeTable(text)) return -460;
  if (kind === "is" && isLikelySupplementalEarningsMetricsIncomeTable(text)) return -420;
  if (kind === "is" && isLikelyOtherComprehensiveIncomeOnlyTable(text)) return -540;
  if (kind === "bs" && isLikelyLeaseFootnoteBalanceSheetTable(text)) return -520;
  if (kind === "bs" && isLikelySelectedFinancialDataBalanceSheetSnippet(text)) return -480;
  if (kind === "bs" && isLikelyCashBridgeTableForBalanceSheet(text)) return -420;
  if (kind === "bs" && isLikelyParentheticalOrHeldForSaleBalanceSheetTable(text)) return -540;
  if ((kind === "bs" || kind === "cf") && isLikelyCashRollupCrossReferenceToCashFlowStatement(text)) return -520;
  if (kind === "cf" && isLikelyCashFlowOperatingInvestingHighlightsOnly(text)) return -480;
  if (kind === "cf" && isLikelySupplementalCashFlowDetailTable(text)) return -500;
  if (kind === "cf" && isLikelyRevenueDisaggregationTableText(text)) return -500;
  if (!statementTableMeetsMinNumericDensity($, table, kind)) return -500;
  const context = acc.slice(Math.max(section.start, table.offset - 900), Math.min(acc.length, table.offset + 150));
  const axes = parsedPrimaryStatementAxes($, $(table.el), kind);
  let score =
    scoreStatementTableText(text, kind) +
    scoreParsedTableStructure($, $(table.el), kind) -
    trendSummaryPenaltyForTenK(kind, form, text, axes) -
    cashFlowsCrossReferenceFootnotePenalty(kind, text);
  if (statementHeadingPatterns(kind).some((re) => re.test(context))) score += 120;
  const otherKinds = (["bs", "is", "cf"] as StatementKind[]).filter((candidate) => candidate !== kind);
  if (otherKinds.some((candidate) => statementHeadingPatterns(candidate).some((re) => re.test(context)))) score -= 90;
  const template = shapeTemplates?.[kind];
  if (template) {
    score += scoreShapeTemplateSimilarity(extractPrimaryFaceRowLabelsForShape($, table), template);
  }
  return score;
}

function parseBestStatementTableFromHtml(
  html: string,
  opts: { kind: StatementKind; form: string; primaryDocument?: string; sourceUrl?: string }
): FilingHtmlStatement | null {
  const $ = cheerio.load(html);
  const { acc, tables } = buildFlatTextAndTableOffsets($);
  const formUpper = opts.form.toUpperCase();
  const section = findPrimaryFinancialStatementsItemSectionBounds(acc, formUpper) ?? { start: 0, end: acc.length };
  const ceiling = primaryFaceTablePickCeiling(acc, section, formUpper);
  let best: { table: { el: Element; offset: number }; score: number } | null = null;

  for (const table of tables) {
    if (table.offset < section.start || table.offset >= ceiling) continue;
    if (!statementTableTextLooksLikePrimaryFace($, table, opts.kind)) continue;
    const score = scoreTableCandidate($, acc, table, section, opts.kind, formUpper);
    if (!best || score > best.score) best = { table, score };
  }

  let usedFaceFallback = false;
  if (!best || best.score < 40) {
    const earliest = earliestPrimaryFaceTableInSection($, tables, section.start, ceiling, opts.kind);
    if (!earliest) return null;
    best = { table: earliest, score: scoreTableCandidate($, acc, earliest, section, opts.kind, formUpper) };
    usedFaceFallback = true;
  }
  if (!best) return null;
  if (!usedFaceFallback && best.score < 40) return null;
  const unitsHint = extractUnitsFromText(acc.slice(Math.max(0, best.table.offset - 500), best.table.offset));
  return returnParsedPrimaryStatementIfValid(
    parsePrimaryStatementTable(
      $,
      $(best.table.el),
      opts.kind,
      unitsHint,
      opts.primaryDocument,
      opts.sourceUrl,
      best.table.offset
    ),
    formUpper
  );
}

export function __test_parseBestStatementTableFromHtml(
  html: string,
  opts: { kind: StatementKind; form: string; primaryDocument?: string; sourceUrl?: string }
): FilingHtmlStatement | null {
  return parseBestStatementTableFromHtml(html, opts);
}

export function __test_parsePrimaryStatementAtTableOffset(
  html: string,
  kind: StatementKind,
  tableIndex: number,
  form: string
): { parsed: FilingHtmlStatement | null; validated: FilingHtmlStatement | null } {
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) return { parsed: null, validated: null };
  const table = ctx.tables[tableIndex];
  if (!table) return { parsed: null, validated: null };
  const parsed = parsePrimaryStatementTable(ctx.$, ctx.$(table.el), kind);
  return { parsed, validated: returnParsedPrimaryStatementIfValid(parsed, form) };
}

function pickBestStatementCluster(
  candidates: Record<StatementKind, StatementTableCandidate[]>,
  maxSpan: number
): StatementCluster | null {
  let best: StatementCluster | null = null;

  for (const bs of candidates.bs) {
    for (const is of candidates.is) {
      if (is.table.offset === bs.table.offset) continue;
      for (const cf of candidates.cf) {
        if (cf.table.offset === bs.table.offset || cf.table.offset === is.table.offset) continue;
        const start = Math.min(bs.table.offset, is.table.offset, cf.table.offset);
        const end = Math.max(bs.table.offset, is.table.offset, cf.table.offset);
        if (end - start > maxSpan) continue;
        const score = bs.score + is.score + cf.score - Math.floor((end - start) / 2_500);
        const cluster: StatementCluster = { bs, is, cf, score, start, end, ceiling: end };
        if (
          !best ||
          end < best.end ||
          (end === best.end && start < best.start) ||
          (end === best.end && start === best.start && score > best.score)
        ) {
          best = cluster;
        }
      }
    }
  }

  return best;
}

function findEmbeddedHeadingClusterBeforeLateItemStart(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  form: string,
  itemStart: number
): StatementCluster | null {
  const section = { start: 0, end: itemStart };
  const maxSpan = form.includes("10-Q") ? 55_000 : 110_000;
  const scoreFloor = form.includes("10-Q") ? 15 : 20;
  const candidateLimit = 8;
  const buildCandidates = (kind: StatementKind) => {
    const faceValid = tables
      .filter((table) => table.offset < itemStart && isPrimaryFaceTableCandidate($, table, kind))
      .map((table) => {
        const text = normalizeSpace($(table.el).text()).slice(0, 6_000);
        if (!lateCrossRefEmbeddedHeadingPatterns(kind).some((re) => re.test(text))) return null;
        const score = scoreTableCandidate($, acc, table, section, kind, form);
        return { kind, table, score } satisfies StatementTableCandidate;
      })
      .filter((candidate): candidate is StatementTableCandidate => candidate !== null);
    const qualified = faceValid
      .filter((candidate) => candidate.score >= scoreFloor)
      .sort((a, b) => a.table.offset - b.table.offset || b.score - a.score);
    const pool = qualified.length > 0 ? qualified : faceValid.sort((a, b) => a.table.offset - b.table.offset || b.score - a.score);
    return pool.slice(0, candidateLimit);
  };

  return pickBestStatementCluster(
    {
      bs: buildCandidates("bs"),
      is: buildCandidates("is"),
      cf: buildCandidates("cf"),
    },
    maxSpan
  );
}

function findEarliestStatementHeadingTableOffset(
  $: cheerio.CheerioAPI,
  tables: Array<{ el: Element; offset: number }>,
  beforeOffset: number
): number | null {
  for (const table of tables) {
    if (table.offset >= beforeOffset) break;
    const text = normalizeSpace($(table.el).text()).slice(0, 6_000);
    if (isLikelyStatementIndexTableText(text)) continue;
    if ((["bs", "is", "cf"] as StatementKind[]).some((kind) => lateCrossRefEmbeddedHeadingPatterns(kind).some((re) => re.test(text)))) {
      return table.offset;
    }
  }
  return null;
}

export function __test_buildLateCrossReferenceStatementWrapper(html: string, form: string): string | null {
  const $ = cheerio.load(html);
  const { acc, tables } = buildFlatTextAndTableOffsets($);
  if (tables.length === 0 || !acc) return null;
  const normalizedForm = form.toUpperCase();
  const searchStart = partSectionSearchStart(acc, normalizedForm);
  const itemStarts = collectMatches(acc, startPatternsForForm(normalizedForm), searchStart);
  if (!hasLateCrossReferenceStart(acc, normalizedForm, itemStarts, tables)) return null;
  const lateItemStart = itemStarts[0]!;
  const firstSet = findFirstEmbeddedHeadingStatementSetBeforeLateItemStart($, acc, tables, normalizedForm, lateItemStart);
  if (!firstSet) return null;
  const ordered = [firstSet.bs.table, firstSet.is.table, firstSet.cf.table]
    .sort((a, b) => a.offset - b.offset)
    .map((table) => $.html(table.el))
    .join("");
  const itemLabel = normalizedForm.includes("10-K")
    ? "ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA"
    : "ITEM 1. FINANCIAL STATEMENTS";
  return `<html><body><p>${itemLabel}</p>${ordered}<p>Notes to Consolidated Financial Statements</p></body></html>`;
}

function findFirstEmbeddedHeadingStatementSetBeforeLateItemStart(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  form: string,
  itemStart: number
): Record<StatementKind, StatementTableCandidate> | null {
  const section = { start: 0, end: itemStart };
  const firstByKind = (["bs", "is", "cf"] as StatementKind[]).map((kind) =>
    tables
      .filter((table) => table.offset < itemStart)
      .map((table) => {
        const text = normalizeSpace($(table.el).text()).slice(0, 6_000);
        if (isLikelyStatementIndexTableText(text)) return null;
        if (!isPrimaryFaceTableCandidate($, table, kind)) return null;
        if (!lateCrossRefEmbeddedHeadingPatterns(kind).some((re) => re.test(text))) return null;
        const score = scoreTableCandidate($, acc, table, section, kind, form);
        return score >= 0 ? ({ kind, table, score } satisfies StatementTableCandidate) : null;
      })
      .filter((candidate): candidate is StatementTableCandidate => candidate !== null)
      .sort((a, b) => a.table.offset - b.table.offset)[0] ?? null
  );
  if (firstByKind.some((candidate) => candidate == null)) return null;
  const [bs, is, cf] = firstByKind as [StatementTableCandidate, StatementTableCandidate, StatementTableCandidate];
  return { bs, is, cf };
}

function findFirstEmbeddedHeadingStatementClusterBeforeLateItemStart(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  form: string,
  itemStart: number
): StatementCluster | null {
  const maxSpan = form.includes("10-Q") ? 55_000 : 110_000;
  const firstSet = findFirstEmbeddedHeadingStatementSetBeforeLateItemStart($, acc, tables, form, itemStart);
  if (!firstSet) return null;
  return pickBestStatementCluster({ bs: [firstSet.bs], is: [firstSet.is], cf: [firstSet.cf] }, maxSpan);
}

function pickHeadingBoundCandidate(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  section: FilingSectionBounds,
  kind: StatementKind,
  headingOffset: number,
  nextHeadingOffset: number,
  scoreFloor: number,
  form: string
): StatementTableCandidate | null {
  const candidates = tables
    .filter((table) => {
      if (
        !(
          table.offset >= Math.max(section.start, headingOffset) &&
          table.offset < nextHeadingOffset &&
          table.offset < section.end
        )
      ) {
        return false;
      }
      return isPrimaryFaceTableCandidate($, table, kind);
    })
    .map((table) => ({ kind, table, score: scoreTableCandidate($, acc, table, section, kind, form) }))
    .sort((a, b) => a.table.offset - b.table.offset);

  const earliestQualified = candidates.find((candidate) => candidate.score >= scoreFloor);
  if (earliestQualified) return earliestQualified;

  if (candidates[0]) return candidates[0];

  return null;
}

function findHeadingLinkedStatementClusterInSection(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  section: FilingSectionBounds,
  form: string
): StatementCluster | null {
  const ceiling = primaryFaceTablePickCeiling(acc, section, form);
  const scanCeiling = primaryFaceClusterScanCeiling(acc, section, form, tables);
  const headings = collapseNearbySameKindHeadingHits(
    (["bs", "is", "cf"] as StatementKind[])
      .flatMap((kind) => {
        const raw = collectMatches(acc, statementHeadingPatterns(kind), section.start);
        const offs = kind === "cf" ? dropPhantomCashFlowHeadingMatches(acc, raw) : raw;
        return offs
          .filter((offset) => offset < ceiling && isPrimaryFaceStatementHeading(acc, offset, form))
          .map((offset) => ({ kind, offset }));
      })
      .sort((a, b) => a.offset - b.offset)
  );

  if (headings.length < 3) return null;

  const headingWindow = form.includes("10-Q") ? 40_000 : 25_000;
  const maxSpan = form.includes("10-Q") ? 55_000 : PRIMARY_FACE_CLUSTER_MAX_SPAN_10K;
  const scoreFloor = form.includes("10-Q") ? 15 : 20;
  const groupedLookaheadTables = form.includes("10-Q") ? 5 : 4;

  for (let startIdx = 0; startIdx < headings.length; startIdx += 1) {
    const anchor = headings[startIdx]!;
    const inWindow = headings.filter((entry) => entry.offset >= anchor.offset && entry.offset <= anchor.offset + headingWindow);
    const firstByKind = {
      bs: inWindow.find((entry) => entry.kind === "bs"),
      is: inWindow.find((entry) => entry.kind === "is"),
      cf: inWindow.find((entry) => entry.kind === "cf"),
    };
    if (!firstByKind.bs || !firstByKind.is || !firstByKind.cf) continue;

    const orderedHeadings = [firstByKind.bs, firstByKind.is, firstByKind.cf].sort((a, b) => a.offset - b.offset);
    const firstTableAfterAnchor = tables.find((table) => table.offset >= orderedHeadings[0]!.offset && table.offset < ceiling);
    const groupedHeadings =
      firstTableAfterAnchor != null && orderedHeadings.every((heading) => heading.offset <= firstTableAfterAnchor.offset);

    if (groupedHeadings) {
      const groupedPicks: Partial<Record<StatementKind, StatementTableCandidate>> = {};
      let cursor = orderedHeadings[orderedHeadings.length - 1]!.offset;

      for (const heading of orderedHeadings) {
        const candidate = tables
          .filter((table) => {
            if (
              !(
                table.offset >= section.start &&
                table.offset > cursor &&
                table.offset < ceiling &&
                table.offset - orderedHeadings[0]!.offset <= maxSpan
              )
            ) {
              return false;
            }
            return isPrimaryFaceTableCandidate($, table, heading.kind);
          })
          .slice(0, groupedLookaheadTables)
          .map((table) => ({
            kind: heading.kind,
            table,
            score: scoreTableCandidate($, acc, table, { start: section.start, end: ceiling }, heading.kind, form),
          }))
          .sort((a, b) => a.table.offset - b.table.offset)
          .find((pick) => pick.score >= scoreFloor);
        if (!candidate) {
          const faceFallback = tables
            .filter(
              (table) =>
                table.offset >= section.start &&
                table.offset > cursor &&
                table.offset < ceiling &&
                table.offset - orderedHeadings[0]!.offset <= maxSpan &&
                isPrimaryFaceTableCandidate($, table, heading.kind)
            )
            .map((table) => ({
              kind: heading.kind,
              table,
              score: scoreTableCandidate($, acc, table, { start: section.start, end: ceiling }, heading.kind, form),
            }))
            .sort((a, b) => a.table.offset - b.table.offset)[0];
          if (!faceFallback) {
          cursor = -1;
          break;
          }
          groupedPicks[heading.kind] = faceFallback;
          cursor = faceFallback.table.offset;
          continue;
        }
        groupedPicks[heading.kind] = candidate;
        cursor = candidate.table.offset;
      }

      if (cursor >= 0 && groupedPicks.bs && groupedPicks.is && groupedPicks.cf) {
        const bs = groupedPicks.bs;
        const is = groupedPicks.is;
        const cf = groupedPicks.cf;
        const start = Math.min(bs.table.offset, is.table.offset, cf.table.offset);
        const end = Math.max(bs.table.offset, is.table.offset, cf.table.offset);
        if (end - start <= maxSpan && (form.includes("10-Q") || end < scanCeiling)) {
          const cluster = {
            bs,
            is,
            cf,
            score: bs.score + is.score + cf.score - Math.floor((end - start) / 2_500),
            start,
            end,
            ceiling,
          };
          if (statementClusterTablesLookValid($, cluster)) return cluster;
        }
      }
    }

    const picks = (["bs", "is", "cf"] as StatementKind[]).map((kind) => {
      const heading = firstByKind[kind]!;
      const nextHeading = headings.find((entry) => entry.offset > heading.offset)?.offset ?? ceiling;
      return pickHeadingBoundCandidate($, acc, tables, { start: section.start, end: ceiling }, kind, heading.offset, nextHeading, scoreFloor, form);
    });

    if (picks.some((pick) => !pick)) continue;
    const [bs, is, cf] = picks as [StatementTableCandidate, StatementTableCandidate, StatementTableCandidate];
    const start = Math.min(bs.table.offset, is.table.offset, cf.table.offset);
    const end = Math.max(bs.table.offset, is.table.offset, cf.table.offset);
    if (end - start > maxSpan) continue;
    if (form.includes("10-K") && end >= scanCeiling) continue;
    const cluster = {
      bs,
      is,
      cf,
      score: bs.score + is.score + cf.score - Math.floor((end - start) / 2_500),
      start,
      end,
      ceiling,
    };
    if (statementClusterTablesLookValid($, cluster)) return cluster;
  }

  return null;
}

function refineKindCandidates(
  $: cheerio.CheerioAPI,
  acc: string,
  section: FilingSectionBounds,
  kind: StatementKind,
  windowTables: Array<{ el: Element; offset: number }>,
  scoreFloor: number,
  form: string,
  limit: number
): StatementTableCandidate[] {
  const faceValid = windowTables
    .filter((table) => isPrimaryFaceTableCandidate($, table, kind))
    .map((table) => ({
      kind,
      table,
      score: scoreTableCandidate($, acc, table, section, kind, form),
    }));

  const qualified = faceValid
    .filter((candidate) => candidate.score >= scoreFloor)
    .sort((a, b) => a.table.offset - b.table.offset || b.score - a.score)
    .slice(0, limit);
  if (qualified.length > 0) return qualified;

  return faceValid
    .sort((a, b) => a.table.offset - b.table.offset || b.score - a.score)
    .slice(0, limit);
}

function findStatementClusterInSection(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: Array<{ el: Element; offset: number }>,
  section: FilingSectionBounds,
  form: string
): StatementCluster | null {
  const pickCeiling = primaryFaceTablePickCeiling(acc, section, form);
  const scanCeiling = primaryFaceClusterScanCeiling(acc, section, form, tables);
  const localTables = tables.filter((table) => table.offset >= section.start && table.offset < pickCeiling);
  if (localTables.length === 0) return null;

  const headingCluster = findHeadingLinkedStatementClusterInSection($, acc, tables, section, form);
  if (headingCluster) return headingCluster;

  const maxSpan = form.includes("10-Q") ? 55_000 : PRIMARY_FACE_CLUSTER_MAX_SPAN_10K;
  const scoreFloor = 10;
  const acceptScore = form.includes("10-Q") ? 90 : 80;
  const anchorLimit = form.includes("10-K") ? Math.min(localTables.length, PRIMARY_FACE_MAX_TABLES_10K) : localTables.length;
  let fallbackBest: StatementCluster | null = null;
  const rankedClusters: StatementCluster[] = [];

  for (let startIdx = 0; startIdx < anchorLimit; startIdx += 1) {
    const anchor = localTables[startIdx]!;
    if (form.includes("10-K") && anchor.offset >= scanCeiling) break;
    const windowTables = localTables.filter((table) => table.offset >= anchor.offset && table.offset <= anchor.offset + maxSpan);
    if (windowTables.length === 0) continue;

    const candidates = {
      bs: refineKindCandidates($, acc, section, "bs", windowTables, scoreFloor, form, 5),
      is: refineKindCandidates($, acc, section, "is", windowTables, scoreFloor, form, 5),
      cf: refineKindCandidates($, acc, section, "cf", windowTables, scoreFloor, form, 5),
    };

    const cluster = pickBestStatementCluster(candidates, maxSpan);
    if (!cluster) continue;
    cluster.ceiling = pickCeiling;
    if (!statementClusterTablesLookValid($, cluster)) continue;
    if (form.includes("10-K") && cluster.end >= scanCeiling) continue;
    if (cluster.score >= acceptScore) rankedClusters.push(cluster);
    if (
      !fallbackBest ||
      cluster.start < fallbackBest.start ||
      (cluster.start === fallbackBest.start && cluster.score > fallbackBest.score)
    ) {
      fallbackBest = cluster;
    }
  }

  rankedClusters.sort((a, b) => a.start - b.start || b.score - a.score || a.end - b.end);
  if (rankedClusters[0]) return rankedClusters[0];

  return fallbackBest &&
    fallbackBest.score >= (form.includes("10-Q") ? 90 : 70) &&
    statementClusterTablesLookValid($, fallbackBest)
    ? fallbackBest
    : null;
}

function parseStatementRows(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<Element>,
  matrix: string[][],
  dataStart: number,
  valueCols: number[],
  periods: Array<{ key: string; label: string; shortLabel?: string }>
): FilingHtmlStatementRow[] {
  const rows: FilingHtmlStatementRow[] = [];
  const trs = $table.find("tr").toArray();

  for (let rowIdx = dataStart; rowIdx < Math.min(matrix.length, trs.length); rowIdx += 1) {
    const row = matrix[rowIdx] ?? [];
    const tr = trs[rowIdx] as Element | undefined;
    const label = normalizeSpace(
      dedupeAdjacent(
        row
          .slice(0, valueCols[0] ?? row.length)
          .map((cell) => normalizeSpace(cell))
          .filter((cell) => !isBlankCellText(cell) && cell !== "$")
      ).join(" ")
    );
    if (!label) continue;

    const displayValues: Record<string, string> = {};
    const values: Record<string, number | null> = {};
    let numericCount = 0;

    const ixByPeriod: Record<string, InlineIxCellMeta | null> = {};
    const rowIxOrdered = tr ? listInlineIxOnRow($, tr) : [];
    let rowIxCursor = 0;

    periods.forEach((period, idx) => {
      const col = valueCols[idx] ?? -1;
      const raw = composeRawAmount(row, col);
      displayValues[period.key] = raw;
      values[period.key] = parseDisplayedNumber(raw);
      if (values[period.key] !== null) numericCount += 1;

      if (!tr || col < 0) {
        ixByPeriod[period.key] = null;
        return;
      }

      let meta = extractInlineIxForMatrixAmountCell($, tr, col, raw);
      if (!meta.xbrlConcept) {
        meta = findInlineIxInRowByVisibleText($, tr, raw) ?? meta;
      }
      if (!meta.xbrlConcept && values[period.key] !== null && rowIxCursor < rowIxOrdered.length) {
        meta = rowIxOrdered[rowIxCursor]!;
        rowIxCursor += 1;
      }
      ixByPeriod[period.key] = meta;
    });

    const rowKind: FilingHtmlStatementRow["rowKind"] =
      numericCount === 0 ? "heading" : /^total\b/i.test(label) || /\bnet cash\b/i.test(label) ? "total" : "data";

    const firstTaggedConcept = periods.map((p) => ixByPeriod[p.key]?.xbrlConcept).find(Boolean);
    const concept =
      firstTaggedConcept ??
      ((tr ? normalizeSpace($(directRowCells($, tr)[0] as Element).attr("id") ?? "") : "") ||
        `html:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || rowIdx}`);

    rows.push({
      concept,
      label,
      depth: 0,
      rowKind,
      valueFormat: "native",
      values,
      displayValues,
      ixByPeriod,
    });
  }

  return rows;
}

function tableTitle(kind: StatementKind): string {
  return KIND_TITLES[kind];
}

function extractMonetaryUnitsFromText(text: string): string | undefined {
  const headerText = normalizeSpace(text);
  /** Prefer dollar-scale cues; ignore standalone "shares in thousands" footnotes on IS/BS tables. */
  const patterns = [
    /\((?:in\s+|dollars?\s+in\s+|\$\s*in\s+)?(?:thousands|millions|billions)(?:,\s*except[^)]*)?\)/i,
    /\bdollars?\s+in\s+(?:thousands|millions|billions)(?:,\s*except[^.;]*)?[.;]?/i,
    /\bin\s+millions\b(?:,\s*except[^.;]*)?[.;]?/i,
    /\$\s*in\s+(?:thousands|millions|billions)\b/i,
    /\ball\s+amounts?\s+(?:are\s+|were\s+|have\s+been\s+)?(?:presented\s+)?(?:in\s+)?(?:\$)?(?:\s*)(?:thousands|millions|billions)\b/i,
    /\bfinancial\s+(?:information|statements)\s+(?:is|are)\s+(?:presented\s+)?(?:in\s+)?(?:\$)?(?:\s*)(?:thousands|millions|billions)\b/i,
    /\b(?:tabular\s+)?amounts?\s+(?:are\s+)?(?:shown\s+|expressed\s+)?in\s+(?:\$)?(?:\s*)(?:thousands|millions|billions)\b/i,
  ];
  for (const re of patterns) {
    const m = headerText.match(re);
    if (m) return normalizeSpace(m[0]);
  }
  return undefined;
}

function extractUnitsFromText(text: string): string | undefined {
  const monetary = extractMonetaryUnitsFromText(text);
  if (monetary) return monetary;
  const headerText = normalizeSpace(text);
  const m = headerText.match(
    /\b(?:in\s+|dollars?\s+in\s+|\$\s*in\s+|shares?\s+in\s+)?(?:thousands|millions|billions)(?:,\s*except[^.;]*)?[.;]?/i
  );
  return m ? normalizeSpace(m[0]) : undefined;
}

function looksLikeAnnualReportIncorporatedByReference(html: string, form: string): boolean {
  if (!form.toUpperCase().includes("10-K")) return false;
  return /\bannual report to stockholders\b/i.test(html) && /\bincorporated herein by reference\b/i.test(html);
}

function extractAnnualReportExhibitUrl(primaryHtml: string, sourceUrl: string): string | null {
  const $ = cheerio.load(primaryHtml);
  const links = $("a[href]").toArray();
  for (const link of links) {
    const href = $(link).attr("href")?.trim();
    if (!href) continue;
    const text = normalizeSpace($(link).text());
    const rowText = normalizeSpace($(link).closest("tr").text());
    if (
      /\bannual report to stockholders\b/i.test(text) ||
      /\bannual report to stockholders\b/i.test(rowText) ||
      (/\bdex13\b/i.test(href) && /\bexhibit\s*13\b/i.test(rowText))
    ) {
      try {
        return new URL(href, sourceUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function __test_extractAnnualReportExhibitUrl(primaryHtml: string, sourceUrl: string): string | null {
  return extractAnnualReportExhibitUrl(primaryHtml, sourceUrl);
}

async function fetchAnnualReportExhibitUrlFromIndex(
  cik: string,
  accessionNumber: string
): Promise<string | null> {
  try {
    const raw = await fetchText(buildFilingIndexJsonUrl(cik, accessionNumber));
    const parsed = JSON.parse(raw) as { directory?: { item?: Array<{ name?: string }> } };
    const items = Array.isArray(parsed.directory?.item) ? parsed.directory!.item! : [];
    const candidate = items
      .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
      .find((name) => /(?:^|[^a-z])(?:dex?13|ex(?:hibit)?[_-]?13|annual[_-]?report|stockholders?)/i.test(name));
    return candidate ? filingSummaryMemberUrl(cik, accessionNumber, candidate) : null;
  } catch {
    return null;
  }
}

function statementKindFromFilingSummaryReport(report: FilingSummaryReportRef): StatementKind | null {
  const blob = normalizeSpace([report.shortName, report.longName, report.menuCategory].filter(Boolean).join(" "));
  if (!blob) return null;
  if (/\b(balance\s+sheets?|statement(?:s)?\s+of\s+financial\s+position)\b/i.test(blob)) return "bs";
  if (/\b(income\s+statements?|statement(?:s)?\s+of\s+(?:operations|income|earnings))\b/i.test(blob)) return "is";
  if (/\bstatement(?:s)?\s+of\s+cash\s+flows?\b/i.test(blob)) return "cf";
  return null;
}

function pickFilingSummaryStatementReports(
  reports: FilingSummaryReportRef[]
): Array<{ kind: StatementKind; htmlFile: string }> {
  const bestByKind = new Map<StatementKind, { htmlFile: string; score: number }>();

  for (const report of reports) {
    const kind = statementKindFromFilingSummaryReport(report);
    const htmlFile = typeof report.htmlFile === "string" ? report.htmlFile.trim() : "";
    if (!kind || !htmlFile) continue;

    const menuCategory = normalizeSpace(report.menuCategory ?? "");
    const shortName = normalizeSpace(report.shortName ?? "");
    const longName = normalizeSpace(report.longName ?? "");
    const blob = `${shortName} ${longName} ${menuCategory}`;
    let score = 0;
    if (/^statements?$/i.test(menuCategory) || /^statement$/i.test(menuCategory)) score += 50;
    if (/statement/i.test(shortName)) score += 20;
    if (/consolidated/i.test(blob)) score += 10;
    if (/parenthetical|detail|schedule|equity/i.test(blob)) score -= 25;
    if (/cash\s+flows?/i.test(blob) && kind === "cf") score += 15;
    if (/balance\s+sheets?/i.test(blob) && kind === "bs") score += 15;
    if (/\b(?:operations|income|earnings)\b/i.test(blob) && kind === "is") score += 15;

    const prev = bestByKind.get(kind);
    if (!prev || score > prev.score) bestByKind.set(kind, { htmlFile, score });
  }

  return (["is", "bs", "cf"] as StatementKind[])
    .map((kind) => {
      const hit = bestByKind.get(kind);
      return hit ? { kind, htmlFile: hit.htmlFile } : null;
    })
    .filter((hit): hit is { kind: StatementKind; htmlFile: string } => hit !== null);
}

async function fetchFilingSummaryStatements(opts: {
  cik: string;
  accessionNumber: string;
  form: string;
}): Promise<FilingHtmlStatement[]> {
  const summaryUrl = filingSummaryXmlUrl(opts.cik, opts.accessionNumber);
  const filingSummaryXml = await fetchText(summaryUrl);
  const reports = pickFilingSummaryStatementReports(parseFilingSummaryReports(filingSummaryXml));
  const statements: FilingHtmlStatement[] = [];

  for (const report of reports) {
    const reportUrl = filingSummaryMemberUrl(opts.cik, opts.accessionNumber, report.htmlFile);
    const reportHtml = await fetchText(reportUrl);
    const parsed =
      parsePrimaryFilingStatementHtml(reportHtml, {
        kind: report.kind,
        form: opts.form,
        primaryDocument: sourceFileNameFromUrl(reportUrl, report.htmlFile) ?? report.htmlFile,
        sourceUrl: reportUrl,
      }) ??
      parseHeadingAnchoredStatementTable(reportHtml, {
        kind: report.kind,
        form: opts.form,
        primaryDocument: sourceFileNameFromUrl(reportUrl, report.htmlFile) ?? report.htmlFile,
        sourceUrl: reportUrl,
      }) ??
      parseBestStatementTableFromHtml(reportHtml, {
        kind: report.kind,
        form: opts.form,
        primaryDocument: sourceFileNameFromUrl(reportUrl, report.htmlFile) ?? report.htmlFile,
        sourceUrl: reportUrl,
      });
    if (parsed) {
      const validated = returnParsedPrimaryStatementIfValid(parsed, opts.form.toUpperCase());
      if (validated) statements.push(validated);
    }
  }

  return statements;
}

function expectedMinPeriodsForStatement(id: FilingHtmlStatement["id"], form: string): number {
  if (id === "balance-sheet") return 2;
  return form.includes("10-K") ? 3 : 2;
}

function statementNeedsImprovement(statement: FilingHtmlStatement | undefined, form: string): boolean {
  if (!statement) return true;
  return statement.periods.length < expectedMinPeriodsForStatement(statement.id, form);
}

function isFilingSummaryReportDocument(sourceHtmlFile?: string): boolean {
  return /^R\d+\.htm$/i.test((sourceHtmlFile ?? "").trim());
}

function countStatementIxTaggedCells(statement: FilingHtmlStatement): number {
  let count = 0;
  for (const row of statement.rows) {
    for (const meta of Object.values(row.ixByPeriod ?? {})) {
      if (meta?.xbrlConcept) count += 1;
    }
  }
  return count;
}

function statementUnitsIndicateShareCountNotDollars(statement: FilingHtmlStatement): boolean {
  if (statement.id === "cash-flow") return false;
  const units = normalizeSpace(statement.units ?? "").toLowerCase();
  if (!units) return false;
  const mentionsShares = /\bshares?\b/.test(units);
  const mentionsDollars = /\bdollars?\b/.test(units) || /\bin\s+millions\b/.test(units) || /\$\s*in\b/.test(units);
  return mentionsShares && !mentionsDollars;
}

function statementMonetaryValuesLookInflated(statement: FilingHtmlStatement): boolean {
  const kind: StatementKind =
    statement.id === "balance-sheet" ? "bs" : statement.id === "cash-flow" ? "cf" : "is";
  let large = 0;
  for (const row of statement.rows) {
    if (row.rowKind === "heading") continue;
    if (rowKeepsNativeUnits(row.label, kind)) continue;
    for (const value of Object.values(row.values)) {
      if (value !== null && Number.isFinite(value) && Math.abs(value) >= 1_000_000) large += 1;
    }
  }
  return large >= 3;
}

function shouldPreferFilingSummaryStatement(
  existing: FilingHtmlStatement,
  candidate: FilingHtmlStatement,
  form: string
): boolean {
  const existingFromPrimary = !isFilingSummaryReportDocument(existing.sourceHtmlFile);
  const candidateFromFs = isFilingSummaryReportDocument(candidate.sourceHtmlFile);

  if (existingFromPrimary && candidateFromFs) {
    const existingTags = countStatementIxTaggedCells(existing);
    const candidateTags = countStatementIxTaggedCells(candidate);
    if (existingTags > 0 && candidateTags === 0) return false;
    if (statementUnitsIndicateShareCountNotDollars(candidate)) return false;
    if (statementMonetaryValuesLookInflated(candidate)) return false;
  }

  const existingValid = validateSinglePrimaryStatementShape(existing, form);
  const candidateValid = validateSinglePrimaryStatementShape(candidate, form);
  if (existingValid && !candidateValid) return false;
  if (!existingValid && candidateValid) return true;

  if (statementNeedsImprovement(existing, form) && candidate.periods.length >= existing.periods.length) {
    if (candidateFromFs && (statementUnitsIndicateShareCountNotDollars(candidate) || statementMonetaryValuesLookInflated(candidate))) {
      return false;
    }
    if (
      existingFromPrimary &&
      candidateFromFs &&
      countStatementIxTaggedCells(existing) > countStatementIxTaggedCells(candidate)
    ) {
      return false;
    }
    return true;
  }

  return false;
}

function mergeStatementsById(
  primary: FilingHtmlStatement[],
  fallback: FilingHtmlStatement[],
  form: string
): FilingHtmlStatement[] {
  const byId = new Map<string, FilingHtmlStatement>();
  for (const statement of primary) byId.set(statement.id, statement);
  for (const statement of fallback) {
    const existing = byId.get(statement.id);
    if (!existing) {
      byId.set(statement.id, statement);
      continue;
    }
    if (shouldPreferFilingSummaryStatement(existing, statement, form)) {
      byId.set(statement.id, statement);
    }
  }
  return Array.from(byId.values());
}

export function __test_mergeStatementsById(
  primary: FilingHtmlStatement[],
  fallback: FilingHtmlStatement[],
  form: string
): FilingHtmlStatement[] {
  return mergeStatementsById(primary, fallback, form);
}

export function __test_extractMonetaryUnitsFromText(text: string): string | undefined {
  return extractMonetaryUnitsFromText(text);
}

function extractUnitsFromMatrix(matrix: string[][], dataStart: number): string | undefined {
  const preamble = matrix.slice(0, Math.max(0, dataStart));
  let headerText = preamble.map((row) => row.join(" ")).join(" ");
  const fromPreamble = extractMonetaryUnitsFromText(headerText);
  if (fromPreamble) return fromPreamble;
  /** Scale notes sometimes appear on the first data rows rather than strictly above headers. */
  for (let rowIdx = dataStart; rowIdx < Math.min(matrix.length, dataStart + 12); rowIdx++) {
    const row = matrix[rowIdx];
    if (!row?.length) continue;
    const labelCell = extractMonetaryUnitsFromText(normalizeSpace(String(row[0] ?? "")));
    if (labelCell) return labelCell;
    const fromRow = extractMonetaryUnitsFromText(normalizeSpace(row.join(" ")));
    if (fromRow) return fromRow;
  }
  return undefined;
}

function inferThousandsFactorFromMagnitudes(
  rows: FilingHtmlStatementRow[],
  periods: Array<{ key: string }>,
  kind: StatementKind
): 0.001 | null {
  const values: number[] = [];
  for (const row of rows) {
    if (row.rowKind === "heading") continue;
    if (rowKeepsNativeUnits(row.label, kind)) continue;
    for (const p of periods) {
      const v = row.values[p.key];
      if (v !== null && v !== undefined && Number.isFinite(v) && Math.abs(v) >= 500) values.push(Math.abs(v));
    }
  }
  if (values.length < 5) return null;
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)]!;
  const p90 = values[Math.floor(values.length * 0.9)]!;
  /** Large-but-not-absurd integers are typical “in thousands” for large‑issuer filings when the prose cue sits outside our snippet. */
  if (median < 250_000) return null;
  if (p90 > 25_000_000_000_000) return null;
  return 0.001;
}

function normalizeRowsToMillions(
  rows: FilingHtmlStatementRow[],
  periods: Array<{ key: string; label: string; shortLabel?: string }>,
  units: string | undefined,
  kind: StatementKind
): { rows: FilingHtmlStatementRow[]; inferredThousands?: boolean } {
  let factor = unitsToMillionsFactor(units);
  let inferredThousands = false;
  if (factor == null) {
    const inferred = inferThousandsFactorFromMagnitudes(rows, periods, kind);
    if (inferred != null) {
      factor = inferred;
      inferredThousands = true;
    }
  }
  if (factor == null) return { rows };

  const out = rows.map((row) => {
    const keepNative = rowKeepsNativeUnits(row.label, kind);
    if (keepNative) return { ...row, valueFormat: "native" };
    const values: Record<string, number | null> = {};
    for (const period of periods) {
      const raw = row.values[period.key];
      values[period.key] = raw === null || !Number.isFinite(raw) ? null : roundTo(raw * factor!, 6);
    }
    return { ...row, valueFormat: "usd_millions" as const, values };
  });

  return { rows: out, inferredThousands };
}

function collapseDuplicatePeriods(
  periods: Array<{ key: string; label: string; shortLabel?: string }>,
  rows: FilingHtmlStatementRow[]
): {
  periods: Array<{ key: string; label: string; shortLabel?: string }>;
  rows: FilingHtmlStatementRow[];
} {
  const groups: Array<{ keys: string[]; label: string; shortLabel?: string }> = [];
  for (const period of periods) {
    const last = groups[groups.length - 1];
    if (last && last.label === period.label) {
      last.keys.push(period.key);
      continue;
    }
    groups.push({ keys: [period.key], label: period.label, shortLabel: period.shortLabel });
  }

  if (groups.length === periods.length) return { periods, rows };

  const nextPeriods = groups.map((group, idx) => ({
    key: `p${idx + 1}`,
    label: group.label,
    shortLabel: group.shortLabel ?? group.label,
  }));

  const nextRows = rows.map((row) => {
    const values: Record<string, number | null> = {};
    const displayValues: Record<string, string> = {};
    const ixByPeriod: Record<string, InlineIxCellMeta | null> = {};
    groups.forEach((group, idx) => {
      const nextKey = `p${idx + 1}`;
      const displays = group.keys.map((key) => normalizeSpace(row.displayValues[key] ?? "")).filter(Boolean);
      const display =
        displays.find((value) => parseDisplayedNumber(value) !== null) ??
        displays.find((value) => value !== "$" && value !== "(" && value !== ")") ??
        displays[0] ??
        "";
      const value =
        group.keys.map((key) => row.values[key]).find((candidate) => candidate !== null && candidate !== undefined) ?? null;
      displayValues[nextKey] = display;
      values[nextKey] = value;
      const ixFromGroup = group.keys
        .map((key) => row.ixByPeriod?.[key])
        .find((meta) => meta?.xbrlConcept) ??
        group.keys.map((key) => row.ixByPeriod?.[key]).find((meta) => meta != null) ??
        null;
      ixByPeriod[nextKey] = ixFromGroup;
    });
    return { ...row, values, displayValues, ixByPeriod };
  });

  return { periods: nextPeriods, rows: nextRows };
}

function parsePrimaryStatementTable(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<Element>,
  kind: StatementKind,
  unitsHint?: string,
  primaryDocument?: string,
  sourceUrl?: string,
  sourceTableOffset?: number
): FilingHtmlStatement | null {
  const matrix = extractTableMatrix($, $table);
  const dataStart = detectDataStart(matrix);
  if (dataStart < 0) return null;
  const valueCols = inferValueColumnIndices(matrix, dataStart);
  if (valueCols.length === 0) return null;
  const periods = inferPeriods(matrix, dataStart, valueCols);
  const rows = parseStatementRows($, $table, matrix, dataStart, valueCols, periods);
  if (rows.length === 0) return null;
  const collapsed = collapseDuplicatePeriods(periods, rows);
  const proseUnits = unitsHint ?? extractUnitsFromMatrix(matrix, dataStart);
  const { rows: normalizedRows, inferredThousands } = normalizeRowsToMillions(
    collapsed.rows,
    collapsed.periods,
    proseUnits,
    kind
  );
  const unitsDisplay =
    proseUnits ??
    (inferredThousands ? "(amounts inferred in thousands - shown below as $ millions)" : undefined);

  return {
    id: kind === "is" ? "income-statement" : kind === "bs" ? "balance-sheet" : "cash-flow",
    title: tableTitle(kind),
    role: tableTitle(kind),
    units: unitsDisplay,
    sourceHtmlFile: primaryDocument,
    sourceHtmlUrl: sourceUrl,
    sourceTableOffset,
    periods: collapsed.periods,
    rows: normalizedRows,
    valueColumnIndices: valueCols,
    dataStartRowIndex: dataStart,
  };
}

export type ParsedFilingHtmlContext = {
  $: cheerio.CheerioAPI;
  acc: string;
  tables: Array<{ el: Element; offset: number }>;
};

/** One cheerio load + flat text index for reuse across IS/BS/CF extraction. */
export function buildParsedFilingHtmlContext(html: string): ParsedFilingHtmlContext | null {
  const $ = cheerio.load(html);
  const { acc, tables } = buildFlatTextAndTableOffsets($);
  if (tables.length === 0 || !acc) return null;
  return { $, acc, tables };
}

export function parsePrimaryFilingStatementsFromHtml(
  html: string,
  opts: PrimaryStatementParseOptions
): FilingHtmlStatement[] {
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) return [];
  return parsePrimaryFinancialStatementsInItemSection(ctx, opts);
}

export function parsePrimaryFilingStatementFromContext(
  ctx: ParsedFilingHtmlContext,
  opts: {
    kind: StatementKind;
    form: string;
    primaryDocument?: string;
    sourceUrl?: string;
    disableHeadingSnippetFallback?: boolean;
    html?: string;
  }
): FilingHtmlStatement | null {
  return (
    parsePrimaryFinancialStatementsInItemSection(ctx, opts).find(
      (stmt) =>
        stmt.id ===
        (opts.kind === "is" ? "income-statement" : opts.kind === "bs" ? "balance-sheet" : "cash-flow")
    ) ?? null
  );
}

export function parsePrimaryFilingStatementHtml(
  html: string,
  opts: { kind: StatementKind; form: string; primaryDocument?: string; sourceUrl?: string; disableHeadingSnippetFallback?: boolean }
): FilingHtmlStatement | null {
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) return null;
  return parsePrimaryFilingStatementFromContext(ctx, opts);
}

export type HtmlFilingStatementsBundle = {
  statements: FilingHtmlStatement[];
  /** Primary filing HTML (set when fetched from SEC archives). */
  primaryHtml?: string;
  primarySourceUrl?: string;
  /** Table offsets in primary HTML (for TEST ix enrichment). */
  parsedTables?: Array<{ el: Element; offset: number }>;
};

export async function fetchHtmlFilingStatementsBundle(opts: {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  form: string;
  docUrl?: string | null;
  shapeTemplates?: PrimaryFaceShapeTemplates;
}): Promise<HtmlFilingStatementsBundle> {
  const archiveCik = resolveEdgarArchivesDataCikForSubmission({
    issuerCik: opts.cik,
    accessionNumber: opts.accessionNumber,
    docUrl: opts.docUrl,
  });
  const sourceUrl = buildPrimaryDocumentUrl(archiveCik, opts.accessionNumber, opts.primaryDocument);
  const html = await fetchText(sourceUrl);
  const statements = parsePrimaryFilingStatementsFromHtml(html, {
    form: opts.form,
    primaryDocument: opts.primaryDocument,
    sourceUrl,
    shapeTemplates: opts.shapeTemplates,
  });
  const parsedTables = buildParsedFilingHtmlContext(html)?.tables;
  return { statements, primaryHtml: html, primarySourceUrl: sourceUrl, parsedTables };
}

export async function fetchHtmlFilingStatements(opts: {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  form: string;
  /** SEC submissions primary document URL; when provided, pins the archives `data/` folder CIK correctly for predecessor-merged filings. */
  docUrl?: string | null;
}): Promise<FilingHtmlStatement[]> {
  const bundle = await fetchHtmlFilingStatementsBundle(opts);
  return bundle.statements;
}
