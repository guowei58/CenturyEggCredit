/**
 * Debt footnote extraction from SEC periodic filing HTML (10-K / 10-Q primary documents).
 *
 * Implements the pipeline: normalize HTML → Item 8 / Item 1 scope → Notes-to-financial-statements region →
 * note-map segmentation → heading + body + debt-table + inline-XBRL scoring → table-anchor fallback →
 * confidence-tiered output with diagnostics. Clips 10-Q before Item 2 MD&A and ignores Item 8 citations in Item 7/7A (10-K).
 * EDGAR layouts vary; callers must link source filings.
 */

import type { PriorDebtPatternSummary } from "@/lib/secDebtFootnote/priorPatterns";
import { priorPeriodPatternScore } from "@/lib/secDebtFootnote/priorPatterns";
import {
  balanceSheetCrosscheckScore,
  extractBalanceSheetDebtLabels,
} from "@/lib/secDebtFootnote/balanceSheetDebt";
import {
  filingSummaryMemberUrl,
  filingSummaryXmlUrl,
  filterDebtRelatedFilingSummaryReports,
  parseFilingSummaryReports,
} from "@/lib/secDebtFootnote/filingSummary";
import { collectIxDebtBlocks, ixOverlapBoostForSegment, type IxDebtBlock } from "@/lib/secDebtFootnote/ixbrlDebtBlocks";
import {
  segmentFootnotesForDebtExtraction,
  selectedBodyContainsMultipleEarlierTopLevelHeadings,
  type FootnoteSegmentationDiagnostic,
} from "@/lib/secDebtFootnote/noteSegmentation";

export type DebtFootnoteConfidence = "High" | "Medium" | "Low" | "Not Found";

/** Independent extraction paths used for reconciliation and diagnostics. */
export type DebtFootnotePathId =
  | "note_map"
  | "debt_table_anchor"
  | "ixbrl_textblock"
  | "filing_summary_report"
  | "balance_sheet_crosscheck"
  | "prior_period_learning"
  | "llm_adjudication";

export type DebtFootnoteExtractionMethod =
  | "direct_heading_match"
  | "note_index_match"
  | "body_keyword_fallback"
  | "xbrl_tag_fallback"
  | "debt_table_keyword_match"
  | "debt_concentration_match"
  /** Table-anchor recovery inside Notes (legacy CSV/logs may say table_anchor_fallback). */
  | "debt_table_anchor"
  | "table_anchor_fallback"
  | "ixbrl_textblock"
  | "filing_summary_report";

export type DebtFootnoteCandidate = {
  noteNumber: string | null;
  titleRaw: string;
  headingScore: number;
  bodyDebtIndicators: number;
  /** Occurrences summed across debt lexicon regexes in this note body. */
  debtLexiconHits: number;
  /** Word tokens in normalized body text (density denominator). */
  bodyWordCount: number;
  /** Lexicon hits ÷ bodyWordCount — tie-breaker after total hits (long debt tables dilute this). */
  debtLexiconDensity: number;
  combinedScore: number;
  /** Combined heading + body + table + anchor + iXBRL relevance (spec Step 3). */
  totalDebtScore?: number;
  /** Scoring breakdown (multi-path extractor). */
  heading_score?: number;
  body_score?: number;
  table_score?: number;
  xbrl_score?: number;
  filing_summary_score?: number;
  balance_sheet_crosscheck_score?: number;
  prior_period_score?: number;
  negative_score?: number;
  extraction_paths_fired?: DebtFootnotePathId[];
  /** Short plain-text snippet from the note body for review UI. */
  snippet?: string;
  /** 1-based position after sort — lower is stronger. */
  rank: number;
  /** True if this segment was chosen as the extracted footnote. */
  selected: boolean;
};

/** Step 8 diagnostic bundle (Medium / Low / Not Found — also attached internally for review flows). */
export type DebtFootnoteDiagnosticReport = {
  filingFormUsed: "10-K" | "10-Q";
  filingDate?: string;
  accessionNumber?: string;
  /** True when Item 8 (10-K) or Item 1 / Part I financial anchor was located. */
  itemFloorFound: boolean;
  itemFloorKind: "Item 8" | "Item 1" | "Part I" | "fallback_start";
  notesSectionFound: boolean;
  notesSectionStartOffset: number | null;
  noteHeadingCount: number;
  detectedNoteHeadings: string[];
  debtScoresByNoteHeading: Array<{ heading: string; noteNumber: string | null; totalScore: number }>;
  topCandidatesSnippet: Array<{ heading: string; totalScore: number; snippet: string }>;
  debtTableAnchorsDetectedInNotes: boolean;
  inlineXbrlDebtTextBlocksFound: boolean;
  /** Which deterministic paths contributed anywhere in this run. */
  extractionPathsFired?: DebtFootnotePathId[];
  filingSummaryXmlFound?: boolean;
  balanceSheetDebtLabelsFound?: boolean;
  balanceSheetDebtLabels?: string[];
  priorPeriodPatternMatched?: boolean;
  candidateScoreBreakdown?: Array<{
    heading: string;
    noteNumber: string | null;
    heading_score: number;
    body_score: number;
    table_score: number;
    xbrl_score: number;
    filing_summary_score: number;
    balance_sheet_crosscheck_score: number;
    prior_period_score: number;
    negative_score: number;
    total_score: number;
    paths_fired: DebtFootnotePathId[];
  }>;
  /** Why the top candidate was accepted or rejected (Step 12). */
  primarySelectionReason: string;
  possibleMdandaOrNonNotesLeak: boolean;
  /** Block-stream segmentation before debt classification (canonical note map). */
  footnoteSegmentation?: FootnoteSegmentationDiagnostic & {
    usedBlockSegmentation: boolean;
    segmentationHardFailed?: boolean;
  };
};

/** Every numbered note segment detected after “Notes to … Financial Statements” (document order). */
export type DetectedFinancialStatementNote = {
  noteNumber: string | null;
  heading: string;
};

/** Includes legacy fields consumed by existing UI + structured Step 11 fields. */
export type DebtSectionExtractResult = {
  anchorLabel: string | null;
  anchorIndexInFullDoc: number;
  tablesHtml: string;
  plainTextFallback: string;
  note: string;

  filingFormUsed?: "10-K" | "10-Q";
  debtNoteTitle: string | null;
  noteNumber: string | null;
  confidence: DebtFootnoteConfidence;
  extractionMethod: DebtFootnoteExtractionMethod;
  extractedFootnoteText: string;
  /** Full note HTML (same boundaries as plain text). Preserves `<table>` layout from the filing. */
  extractedFootnoteHtml: string;
  debtTablesMarkdown: string[];
  startHeading: string | null;
  endHeading: string | null;
  warnings: string[];
  candidates: DebtFootnoteCandidate[];
  htmlStartOffset: number;
  htmlEndOffset: number;

  /** All notes identified (10-K / 10-Q), before choosing the debt footnote segment. */
  financialStatementNotes: DetectedFinancialStatementNote[];
  /** Keyword richness score on the chosen `<table>` when method is debt_table_keyword_match; else max table score in section. */
  debtKeywordTableScore?: number;

  /** Structured diagnostics for Medium / Low / Not Found (Step 8). */
  diagnosticReport?: DebtFootnoteDiagnosticReport;
  /** True when extraction must be manually verified (Medium/Low). */
  reviewRequired?: boolean;
  /** Canonical note segmentation failed validation or STEP 11 embedded-heading guard fired. */
  segmentationFailed?: boolean;
  /** Human-readable segmentation / guard failure reason. */
  segmentationReason?: string;
};

export type ExtractDebtFootnoteOptions = {
  formType: "10-K" | "10-Q";
  filingDate?: string;
  accessionNumber?: string;
  /** CIK zero-padded to 10 digits — used with {@link fetchSecArchiveText} for FilingSummary.xml. */
  cik?: string;
  ticker?: string;
  /** Fetch auxiliary EDGAR member files (FilingSummary.xml, R*.htm). Same Host / User-Agent as primary doc. */
  fetchSecArchiveText?: (url: string) => Promise<string | null>;
  /** Prior successful patterns for this issuer (optional — typically loaded by API route from DB). */
  priorDebtPatterns?: PriorDebtPatternSummary[];
  /** When true (default), run optional LLM adjudication hook if provided. */
  enableLlmAdjudication?: boolean;
  /** Optional adjudication over top text snippets only (caller wires provider + keys). */
  llmAdjudicate?: (input: {
    filingFormUsed: "10-K" | "10-Q";
    candidates: Array<{
      rank: number;
      heading: string;
      snippet: string;
      pathsFired: DebtFootnotePathId[];
      scores: string;
    }>;
  }) => Promise<{ chosenRank: number; confidence: "high" | "medium" | "low"; rationale?: string } | null>;
};

function stripScripts(raw: string): string {
  return raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, " ")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, " ");
}

/** Unwrap inline XBRL; keep visible text. */
function stripInlineIx(html: string): string {
  let result = html;
  let prev = "";
  let guard = 0;
  while (prev !== result && guard++ < 30) {
    prev = result;
    result = result.replace(/<ix:[-\w]+[^/>]*>([\s\S]*?)<\/ix:[-\w]+>/gi, "$1");
  }
  return result.replace(/<ix:[-\w]+[^/>]*\/>/gi, " ");
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&#8209;/gi, "-")
    .replace(/&#(?:8211|8212|8213);/g, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "-")
    .replace(/&#8216;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8220;/gi, '"')
    .replace(/&#8221;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** Collapse spaced-out heading letters e.g. `N o t e 7` → `Note 7` for matching only. */
function collapseSpacedLetters(s: string): string {
  let t = s.replace(/\u00a0/g, " ");
  t = t.replace(/([A-Za-z])\s+(?=[A-Za-z](?:\s+[A-Za-z])*\s*[.\d])/g, "$1");
  return t.replace(/\s+/g, " ").trim();
}

function preprocessSecHtml(html: string): string {
  let h = stripScripts(html);
  h = stripInlineIx(h);
  /* NBSP entities sit between `>` and note numbers (e.g. `>&#160;13.`) — normalize so numeric note-heading regexes match. */
  h = h.replace(/&#160;/gi, " ").replace(/&#xa0;/gi, " ");
  h = h.replace(/\u00a0/g, " ");
  /* SEC HTML often uses curly apostrophes in headings (“Management’s”) — ASCII `'` keeps MD&A / Item boundary regexes reliable. */
  h = h.replace(/\u2019/g, "'").replace(/\u2018/g, "'");
  /* Note titles frequently use en/em dash as separators — normalize so heading scanners agree across SEG parsers. */
  h = h.replace(/\u2013/g, "-").replace(/\u2014/g, "-").replace(/\u2015/g, "-");
  return h;
}

/** Same preprocessing but preserve inline XBRL tags for concept-name probing ({@link collectIxNonNumericDebtBoosts}). */
function preprocessSecHtmlKeepIx(html: string): string {
  let h = stripScripts(html);
  h = h.replace(/&#160;/gi, " ").replace(/&#xa0;/gi, " ");
  h = h.replace(/\u00a0/g, " ");
  h = h.replace(/\u2019/g, "'").replace(/\u2018/g, "'");
  h = h.replace(/\u2013/g, "-").replace(/\u2014/g, "-").replace(/\u2015/g, "-");
  return h;
}

function normalizePlainForMatch(s: string): string {
  return collapseWs(
    decodeBasicEntities(s)
      .replace(/[\u2014\u2013\u2012\u2015]/g, "-")
      .replace(/[""'']/g, "'")
      .toLowerCase(),
  );
}

function collapseWs(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Visible text is only a TOC navigation label (possibly with "Back to"). */
function isTableOfContentsOnlyLabel(visible: string): boolean {
  const v = collapseWs(visible);
  if (!v || v.length > 72) return false;
  return /^(?:back\s+to\s+)?table\s+of\s+contents\.?$/i.test(v);
}

/**
 * Strip SEC-rendered pagination noise from HTML excerpts (TOC links, HRs, page numbers, page-break CSS).
 * Conservative: only removes short blocks that read as page-only or standard TOC anchors.
 */
function stripSecPaginationArtifacts(html: string): string {
  let h = html;

  h = h.replace(/<hr\b[^>]*\/?>/gi, "");

  h = h.replace(/<a\b[^>]*href\s*=\s*["'][^"']*toc[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");

  h = h.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (block) => {
    const visible = collapseWs(block.replace(/<[^>]+>/g, " "));
    return /\btable\s+of\s+contents\b/i.test(visible) || /\bback\s+to\s+table\s+of\s+contents\b/i.test(visible)
      ? ""
      : block;
  });

  /* TOC often appears as styled span/div text (no anchor) — remove short wrapper blocks. */
  const tocWrapperTags = ["span", "font", "u", "i", "b", "strong", "em", "p", "div", "td", "th"];
  for (let pass = 0; pass < 6; pass++) {
    let unchanged = true;
    for (const tag of tocWrapperTags) {
      const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]{0,560}?<\\/${tag}>`, "gi");
      const next = h.replace(re, (block) => {
        if (block.length > 620) return block;
        const visible = collapseWs(block.replace(/<[^>]+>/g, " "));
        return isTableOfContentsOnlyLabel(visible) ? "" : block;
      });
      if (next !== h) unchanged = false;
      h = next;
    }
    if (unchanged) break;
  }

  h = h.replace(/>(\s*(?:back\s+to\s+)?table\s+of\s+contents\.?\s*)</gi, "><");

  h = h.replace(/\s*page-break-before\s*:\s*[^;};]+;?/gi, "");
  h = h.replace(/\s*page-break-after\s*:\s*[^;};]+;?/gi, "");
  h = h.replace(/\s*page-break-inside\s*:\s*[^;};]+;?/gi, "");

  if (/(?:border-top|text-align\s*:\s*center)/i.test(h)) {
    h = h.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (block) => {
      if (block.length > 900) return block;
      const flat = collapseWs(block.replace(/<[^>]+>/g, " "));
      if (!/^\d{2,4}$/.test(flat)) return block;
      if (/border-top|text-align\s*:\s*center|margin-top\s*:/i.test(block)) return "";
      return block;
    });

    h = h.replace(/<div\b[^>]*>[\s\S]*?<\/div>/gi, (block) => {
      if (block.length > 520) return block;
      const flat = collapseWs(block.replace(/<[^>]+>/g, " "));
      if (!/^\d{2,4}$/.test(flat)) return block;
      if (/text-align\s*:\s*center|border-top/i.test(block)) return "";
      return block;
    });
  }

  h = h.replace(/\bplease\s+continue\s+(?:on\s+(?:the\s+)?)?next\s+page\.?\b/gi, "");

  h = h.replace(/\s*<p\b[^>]*>\s*<\/p>/gi, "");
  return h;
}

/** Hidden duplicate facts / taxonomy scaffolding common in inline XBRL (not visible on SEC viewer). */
function stripHiddenIxDuplicates(html: string): string {
  let h = html;
  const tags = ["span", "div", "p", "font"];
  for (let pass = 0; pass < 18; pass++) {
    let changed = false;
    for (const tag of tags) {
      const re = new RegExp(
        `<${tag}\\b[^>]*style\\s*=\\s*["'][^"']*(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden)[^"']*["'][^>]*>[\\s\\S]*?<\\/${tag}>`,
        "gi",
      );
      const n = h.replace(re, "");
      if (n !== h) changed = true;
      h = n;
    }
    if (!changed) break;
  }
  h = h.replace(/<div\b[^>]*(?:hidden-fact|is-hidden-fact|xbrl-hidden)[^>]*>[\s\S]*?<\/div>/gi, "");
  return h;
}

/** Strip schema refs and prefixed XML tags (ix/us-gaap/dei) that are not browser HTML. */
function stripFootnoteXmlNoise(html: string): string {
  let h = html.replace(/\0/g, "");
  h = h.replace(/<\?xml[\s\S]*?\?>/gi, "");
  h = h.replace(/<link\b[^>]*>/gi, "");
  h = h.replace(/<\/?[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*\b[^>]*\/?>/gi, " ");
  return h;
}

function preprocessFootnoteSlice(html: string): string {
  return stripFootnoteXmlNoise(stripHiddenIxDuplicates(stripSecPaginationArtifacts(html)));
}

/** Drop short lines that are clearly XBRL / taxonomy tokens (not narrative footnote text). */
function shouldDropPlainNoiseLine(t: string): boolean {
  if (t.length > 220) return false;
  if (/https?:\/\/\S+/i.test(t) && /fasb\.org|xbrl\.org/i.test(t)) return true;
  if (/^[a-z][a-z0-9.-]{0,28}-\d{8}$/i.test(t)) return true;
  if (
    /^(?:us-gaap|dei|ifrs-full|iso4217|xbrli|country|currency|ecd|htz|sic|stpr|exch|cusip):[A-Za-z0-9._-]+$/i.test(t)
  )
    return true;
  if (/^[A-Za-z][a-zA-Z0-9.-]{1,32}:[A-Za-z][a-zA-Z0-9]*Member$/i.test(t)) return true;
  if (/^\d{7,12}$/.test(t)) return true;
  if (/^(?:pure|shares|usd|eur)\b$/i.test(t)) return true;
  if (/^xbrl/i.test(t)) return true;
  return false;
}

function scrubPlainFootnoteNoise(plain: string): string {
  const lines = plain.split(/\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const t = collapseWs(line);
    if (!t) continue;
    if (shouldDropPlainNoiseLine(t)) continue;
    kept.push(line.trimEnd());
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripTagsToPlain(fragment: string): string {
  let s = decodeBasicEntities(fragment)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|table|p|div|h\d)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/<[^>]*$/g, "");
  return collapseWs(s);
}

/**
 * Start financial-statement search after the real PART heading when possible.
 * TOC often duplicates “PART II” before the body — skip a very early hit.
 */
function partSectionSearchStart(html: string, formType: "10-K" | "10-Q"): number {
  const re = formType === "10-K" ? /\bpart\s+ii\b/gi : /\bpart\s+i\b/gi;
  const hits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index !== undefined) hits.push(m.index);
  }
  if (hits.length === 0) return 0;
  if (hits.length >= 2 && hits[0] < 35_000) return hits[1];
  return hits[0];
}

function earliestRegexMatchIn(html: string, searchStart: number, patterns: ReadonlyArray<RegExp>): number {
  const haystack = html.slice(searchStart);
  let best = -1;
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let mx: RegExpExecArray | null;
    while ((mx = r.exec(haystack)) !== null) {
      if (mx.index === undefined) continue;
      const idx = searchStart + mx.index;
      if (best < 0 || idx < best) best = idx;
    }
  }
  return best;
}

/** First visible consolidated statements / auditor opinion after PART — HTML often places FS before a duplicate Item 8 TOC (AVIS CAR 10-K). */
function findFirstFinancialStatementsBodyAnchor(html: string, searchStart: number): number {
  const patterns: ReadonlyArray<RegExp> = [
    /\bcondensed\s+consolidated\s+balance\s+sheets?\b/i,
    /\bconsolidated\s+balance\s+sheets?\b/i,
    /\bcondensed\s+consolidated\s+statements?\s+of\s+(?:operations|income)\b/i,
    /\bconsolidated\s+statements?\s+of\s+(?:operations|income)\b/i,
    /\bconsolidated\s+statements?\s+of\s+comprehensive\s+income\b/i,
    /\bconsolidated\s+statements?\s+of\s+cash\s+flows?\b/i,
    /\breport\s+of\s+independent\s+registered\s+public\s+accounting\s+firm\b/i,
  ];
  return earliestRegexMatchIn(html, searchStart, patterns);
}

const ITEM89_TOC_MAX_GAP = 28_000;

function firstBoldItem9AccountantsIndex(html: string, floor: number): number | null {
  const re =
    /<(b|strong|span|font)\b([^>]*)>[\s\S]{0,320}?item\s*9[\.\)]?\s*(?:[\u2014\-–—]\s*|\.(?:&#160;|\u00a0)?\s+)?changes\s+in\s+and\s+disagreements\s+with\s+accountants\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index < floor) continue;
    const tag = (m[1] ?? "").toLowerCase();
    const attrs = m[2] ?? "";
    if (tag === "span" || tag === "font") {
      if (!/font-weight\s*:\s*(?:bold|700)/i.test(attrs)) continue;
    }
    const openEnd = html.indexOf(">", m.index);
    if (openEnd < 0) continue;
    const openTag = html.slice(m.index, openEnd + 1);
    if (/text-decoration\s*:\s*underline/i.test(openTag)) continue;
    return m.index;
  }
  return null;
}

/** Embedded Item 8 / Item 9 outline rows (often back-to-back) are not the Form 10-K section boundaries. */
function item89TocSandwich(html: string, item8Idx: number): boolean {
  const at = firstBoldItem9AccountantsIndex(html, item8Idx);
  return at !== null && at - item8Idx <= ITEM89_TOC_MAX_GAP;
}

/** Item 7 / 7A prose cites Item 8 (“included in Part II, Item 8…”) — must not become {@link financialStatementsFloor}. */
function isItem8FinancialStatementsCitation(html: string, matchIdx: number): boolean {
  const lo = Math.max(0, matchIdx - 340);
  const plain = normalizePlainForMatch(stripTagsToPlain(html.slice(lo, matchIdx)));
  if (!plain) return false;
  if (/\bincluded\s+in\b/.test(plain)) return true;
  if (/\baccompanying\s+notes\b/i.test(plain) && /\bitem\s*8\b/i.test(plain.slice(-140))) return true;
  if (/\brefer(?:red)?\s+to\s+(?:part\s+ii\s*,?\s*)?item\s*8\b/i.test(plain)) return true;
  if (/\bsee\s+(?:also\s+)?(?:part\s+ii\s*,?\s*)?item\s*8\b/i.test(plain)) return true;
  if (/\bas\s+discussed\s+in\b/i.test(plain) && /\bitem\s*8\b/.test(plain.slice(-100))) return true;
  if (/\bfurther\s+information\b/i.test(plain) && /\bitem\s*8\b/.test(plain.slice(-120))) return true;
  return false;
}

function findFirstNonCitationItem8FinancialIndex(html: string, searchStart: number): number {
  const patterns: ReadonlyArray<RegExp> = [
    /\bitem\s+8[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/gi,
    /\bitem\s*(?:&#160;|\u00a0)\s*8[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/gi,
    /\bitem\s+8[\.\)]?\s*[\s\S]{0,320}?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/gi,
  ];
  let best = -1;
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(html)) !== null) {
      if (m.index < searchStart) continue;
      if (isItem8FinancialStatementsCitation(html, m.index)) continue;
      if (best < 0 || m.index < best) best = m.index;
    }
  }
  return best;
}

function financialStatementsFloor(html: string, formType: "10-K" | "10-Q"): number {
  const searchStart = partSectionSearchStart(html, formType);
  if (formType === "10-K") {
    const patterns = [
      /\bitem\s+8[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/i,
      /\bitem\s*(?:&#160;|\u00a0)\s*8[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/i,
      /\bitem\s+8[\.\)]?\s*[\s\S]{0,320}?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/i,
    ];
    let item8Idx = findFirstNonCitationItem8FinancialIndex(html, searchStart);
    if (item8Idx < 0) item8Idx = findFirstNonCitationItem8FinancialIndex(html, 0);
    if (item8Idx < 0) item8Idx = earliestRegexMatchIn(html, searchStart, patterns);
    if (item8Idx < 0) item8Idx = earliestRegexMatchIn(html, 0, patterns);

    const bodyAnchor = findFirstFinancialStatementsBodyAnchor(html, searchStart);
    const anchors: number[] = [];
    if (item8Idx >= 0 && !item89TocSandwich(html, item8Idx)) anchors.push(item8Idx);
    if (bodyAnchor >= 0) anchors.push(bodyAnchor);

    if (anchors.length === 0) {
      if (item8Idx >= 0) anchors.push(item8Idx);
      else if (bodyAnchor >= 0) anchors.push(bodyAnchor);
    }

    return anchors.length > 0 ? Math.min(...anchors) : 0;
  }
  const patterns = [
    /\bitem\s+1[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements)\b/i,
    /\bitem\s*(?:&#160;|\u00a0)\s*1[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements)\b/i,
  ];
  let best = earliestRegexMatchIn(html, searchStart, patterns);
  if (best < 0) best = earliestRegexMatchIn(html, 0, patterns);
  const part1 = earliestRegexMatchIn(html, searchStart, [
    /\bpart\s+i\b\s*(?:[\u2014\-–—]|:|\.)\s*financial\s+information\b/i,
  ]);
  if (best < 0 && part1 >= 0) best = part1;
  return best >= 0 ? best : 0;
}

/** Real SIGNATURES heading vs TOC fragment jump rows (underline + href=#… ). */
function findBoldSignaturesCeiling(html: string, floor: number): number | null {
  const sigRe =
    /<span[^>]*font-weight\s*:\s*(?:bold|700)[^>]*>[\s\S]{0,80}?SIGNATURES\s*<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = sigRe.exec(html)) !== null) {
    const openEnd = html.indexOf(">", m.index);
    if (openEnd < 0) continue;
    const openTag = html.slice(m.index, openEnd + 1);
    if (/text-decoration\s*:\s*underline/i.test(openTag)) continue;
    if (m.index > floor) return m.index;
  }
  return null;
}

/**
 * Exhibit Index anchors deep in the document — TOC duplicates appear early with underline+#fragment links.
 * Skip prose “Exhibit Index” in quotation marks.
 */
function findFirstNonTocExhibitIndex(html: string, floor: number, cap: number): number | null {
  const slice = html.slice(floor, cap);
  const re = /\bexhibit\s+index\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const globalIdx = floor + m.index;
    const ctxStart = Math.max(floor, globalIdx - 400);
    const ctx = html.slice(ctxStart, Math.min(html.length, globalIdx + 32));
    if (/href\s*=\s*["']#/i.test(ctx) && /text-decoration:\s*underline/i.test(ctx)) continue;
    if (/&#8220;\s*exhibit\s+index\s*&#8221;/i.test(ctx)) continue;
    return globalIdx;
  }
  return null;
}

/** TOC lists Item 9 / Item 2 before real sections — ignore matches before this when floor is still early. */
const ITEM_SECTION_TOC_SKIP_ABS = 115_000;

function firstMajorItemAfterFloor(html: string, floor: number, boundaryRe: RegExp): number | null {
  const slice = html.slice(floor);
  const r = new RegExp(boundaryRe.source, boundaryRe.flags.includes("g") ? boundaryRe.flags : `${boundaryRe.flags}g`);
  const suspiciousFloor = floor < 55_000;
  let m: RegExpExecArray | null;
  while ((m = r.exec(slice)) !== null) {
    const abs = floor + m.index;
    if (suspiciousFloor && abs < ITEM_SECTION_TOC_SKIP_ABS) continue;
    return abs;
  }
  return null;
}

/**
 * Loose `\bitem 9 changes… accountants\b` matches cross-references inside Notes ("See Item 9…").
 * Use heading-shaped markup only — omit prose fallback so Notes aren't clipped before later notes (e.g. missing Note 6).
 */
function findBoldItem9FinancialCeiling(html: string, floor: number): number | null {
  const re =
    /<(b|strong|span|font)\b([^>]*)>[\s\S]{0,320}?item\s*9[\.\)]?\s*(?:[\u2014\-–—]\s*|\.(?:&#160;|\u00a0)?\s+)?changes\s+in\s+and\s+disagreements\s+with\s+accountants\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index < floor) continue;
    const tag = (m[1] ?? "").toLowerCase();
    const attrs = m[2] ?? "";
    if (tag === "span" || tag === "font") {
      if (!/font-weight\s*:\s*(?:bold|700)/i.test(attrs)) continue;
    }
    const openEnd = html.indexOf(">", m.index);
    if (openEnd < 0) continue;
    const openTag = html.slice(m.index, openEnd + 1);
    if (/text-decoration\s*:\s*underline/i.test(openTag)) continue;
    const ctxLo = Math.max(floor, m.index - 120);
    const ctx = html.slice(ctxLo, Math.min(html.length, m.index + 260));
    if (/href\s*=\s*["']#/i.test(ctx) && /table\s+of\s+contents/i.test(html.slice(Math.max(0, m.index - 2_000), m.index))) continue;
    const back = html.slice(Math.max(0, m.index - 15_000), m.index);
    if (
      /\bITEM\s+8[\.\)]?\s*[^\n]{0,200}?FINANCIAL\s+STATEMENTS\s+AND\s+SUPPLEMENTARY\s+DATA\b/i.test(back)
    )
      continue;
    return m.index;
  }
  return null;
}

/** TOC lists Item 2 MD&A right after Item 1 / Notes labels — never clip FS region before statements body (QVCGA-style 10-Q). */
/** Distance guard for prose Item 2 only when bold detection fails — keep low so compact Item 1 + notes still clip before MD&A. TOC skipping uses {@link ITEM_SECTION_TOC_SKIP_ABS} when floor is early. */
const ITEM2_FALLBACK_MIN_DISTANCE = 6_000;

/**
 * Apostrophe variants in “Management's Discussion” (`&#8217;` etc.). Curly `'` is normalized in {@link preprocessSecHtml}.
 */
const ITEM2_MD_AND_A_MANAGEMENT_RE =
  "management(?:'|&#8217;|&apos;|&#39;|&#146;)?s\\s+discussion\\s+and\\s+analysis";

/**
 * “Item” and “2” are often split across tags (`<b>Item</b><b> 2.</b>`). Allow short markup gaps only (not arbitrary HTML distance).
 */
const ITEM2_HEAD_SPLIT_RE =
  "\\bitem(?:</[^>]+>\\s*|<[^>]+>\\s*|&nbsp;|&#160;|\\s){0,64}2[\\.\\)]?\\s*(?:[\\u2014\\-–—]\\s*|\\.(?:&#160;|\\u00a0)?\\s+)?";

function item2MdAndACeilingCandidates(html: string, floor: number): number[] {
  const bodyAnchor = findFirstFinancialStatementsBodyAnchor(html, floor);
  const minAbs = bodyAnchor >= 0 ? bodyAnchor + 3_500 : floor + 40_000;

  const fullRe = new RegExp(`${ITEM2_HEAD_SPLIT_RE}${ITEM2_MD_AND_A_MANAGEMENT_RE}\\b`, "gi");
  const found: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = fullRe.exec(html)) !== null) {
    if (m.index < floor || m.index < minAbs) continue;
    const ctxLo = Math.max(floor, m.index - 120);
    const ctx = html.slice(ctxLo, Math.min(html.length, m.index + 260));
    if (/href\s*=\s*["']#/i.test(ctx) && /table\s+of\s+contents/i.test(html.slice(Math.max(0, m.index - 2_000), m.index)))
      continue;
    /* Notes sometimes cite the full MD&A title (“see … Item 2. Management's Discussion…”) — never clip Item 1 on that. */
    const plainBefore = stripTagsToPlain(html.slice(Math.max(floor, m.index - 280), m.index)).trim();
    if (/\b(?:see|refer\s+to)\s*$/i.test(plainBefore)) continue;
    found.push(m.index);
  }
  return found;
}

/**
 * Same idea as {@link findBoldItem9FinancialCeiling}: plain-text Item 2 hits catch TOC/outline rows when Item 1 starts mid-file.
 * Require match after first balance-sheet anchor so TOC Item 2 is ignored.
 */
function findBoldItem2MdCeiling(html: string, floor: number): number | null {
  const bodyAnchor = findFirstFinancialStatementsBodyAnchor(html, floor);
  const minAbs = bodyAnchor >= 0 ? bodyAnchor + 3_500 : floor + 40_000;

  const re = new RegExp(
    `<(b|strong|span|font)\\b([^>]*)>[\\s\\S]{0,720}?${ITEM2_HEAD_SPLIT_RE}${ITEM2_MD_AND_A_MANAGEMENT_RE}\\b`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index < floor || m.index < minAbs) continue;
    const tag = (m[1] ?? "").toLowerCase();
    const attrs = m[2] ?? "";
    if (tag === "span" || tag === "font") {
      if (!/font-weight\s*:\s*(?:bold|700)/i.test(attrs)) continue;
    }
    const openEnd = html.indexOf(">", m.index);
    if (openEnd < 0) continue;
    const openTag = html.slice(m.index, openEnd + 1);
    if (/text-decoration\s*:\s*underline/i.test(openTag)) continue;
    const ctxLo = Math.max(floor, m.index - 120);
    const ctx = html.slice(ctxLo, Math.min(html.length, m.index + 260));
    if (/href\s*=\s*["']#/i.test(ctx) && /table\s+of\s+contents/i.test(html.slice(Math.max(0, m.index - 2_000), m.index)))
      continue;
    const plainBefore = stripTagsToPlain(html.slice(Math.max(floor, m.index - 280), m.index)).trim();
    if (/\b(?:see|refer\s+to)\s*$/i.test(plainBefore)) continue;
    return m.index;
  }
  return null;
}

/** Item 2 heading with no `<b>` / `<strong>` wrapper — common in primary HTML (FICO-style); still past {@link findFirstFinancialStatementsBodyAnchor}. */
function findPlainItem2MdCeiling(html: string, floor: number): number | null {
  const xs = item2MdAndACeilingCandidates(html, floor);
  return xs.length > 0 ? Math.min(...xs) : null;
}

function financialStatementsCeiling(html: string, formType: "10-K" | "10-Q", floor: number): number {
  let end = html.length;
  if (formType === "10-Q") {
    const boldAt = findBoldItem2MdCeiling(html, floor);
    const plainAt = findPlainItem2MdCeiling(html, floor);
    let item2At: number | null = null;
    if (boldAt !== null && plainAt !== null) item2At = Math.min(boldAt, plainAt);
    else item2At = boldAt ?? plainAt ?? null;
    if (item2At !== null) end = Math.min(end, item2At);
    else {
      const re = new RegExp(`${ITEM2_HEAD_SPLIT_RE}${ITEM2_MD_AND_A_MANAGEMENT_RE}`, "i");
      const at = firstMajorItemAfterFloor(html, floor, re);
      if (at !== null && at - floor >= ITEM2_FALLBACK_MIN_DISTANCE) end = Math.min(end, at);
    }
  } else {
    const boldAt = findBoldItem9FinancialCeiling(html, floor);
    if (boldAt !== null) end = Math.min(end, boldAt);
  }

  const sigAt = findBoldSignaturesCeiling(html, floor);
  if (sigAt !== null) end = Math.min(end, sigAt);

  const exAt = findFirstNonTocExhibitIndex(html, floor, end);
  if (exAt !== null) end = Math.min(end, exAt);

  return end;
}

/**
 * Workiva / inline-XBRL filings often repeat Item 8–9 as a short TOC near the top while the real Notes live near EOF.
 * {@link financialStatementsCeiling} relative to {@link financialStatementsFloor} can therefore end before `notesStart`.
 * When that happens, re-clip using the Notes anchor as the floor so {@link scanNoteHeadings} spans real note headings.
 */
function financialStatementsCeilingAfterNotesAnchor(
  html: string,
  formType: "10-K" | "10-Q",
  notesStart: number,
  regionStart: number,
): number {
  const floor = Math.max(regionStart, notesStart);
  return financialStatementsCeiling(html, formType, floor);
}

/**
 * Last resort when {@link financialStatementsCeiling} misses: Item 2 MD&A title appears as plain HTML after Notes.
 * Clip the Notes scan window at the first such heading after the Notes header (skips TOC / “see Item 2…” refs).
 *
 * **10-K:** Notes live under Item 8 after Part II Item 7 MD&A; prose inside Notes often cites “Item 2. Management's Discussion…”
 * (or legacy TOC lines) without a leading “See ” — clipping here truncates before Note 6–12. Skip for 10-K entirely.
 */
function clipRegionEndAtFirstItem2AfterNotes(
  html: string,
  notesStart: number,
  regionEnd: number,
  formType: "10-K" | "10-Q",
): number {
  if (formType === "10-K") return regionEnd;
  const floor = notesStart + 1_500;
  const re = new RegExp(`${ITEM2_HEAD_SPLIT_RE}${ITEM2_MD_AND_A_MANAGEMENT_RE}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index >= regionEnd) break;
    if (m.index < floor) continue;
    const plainBefore = stripTagsToPlain(html.slice(Math.max(notesStart, m.index - 280), m.index)).trim();
    if (/\b(?:see|refer\s+to)\s*$/i.test(plainBefore)) continue;
    return m.index;
  }
  return regionEnd;
}

const NOTES_HEADER_RES = [
  /\bnotes\s+to\s+(?:the\s+)?(?:unaudited\s+)?(?:interim\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:the\s+)?interim\s+consolidated\s+financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:the\s+)?unaudited\s+consolidated\s+financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:the\s+)?(?:condensed\s+)?(?:consolidated\s+)?financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:condensed\s+)?financial\s+statements\b/gi,
];

const NOTES_HEADER_LOOSE_RES = [
  /\bnotes\s+to\s+[\s\S]{0,360}?financial\s+statements\b/gi,
  /\baccompanying\s+notes\s+to\s+(?:the\s+)?[\s\S]{0,200}?(?:consolidated\s+)?financial\s+statements\b/gi,
];

/**
 * True when this “Notes to …” regex hit sits inside a blue / underlined `#fragment` TOC link (QVCGA-style 10-Q).
 * Using that index as {@link notesStart} pins Notes immediately before Item 2 in the TOC while
 * {@link financialStatementsCeiling} ends the scan there — real notes hundreds of KB later are invisible.
 */
function notesHeaderAnchoredByTocFragmentLink(html: string, notesMatchIdx: number): boolean {
  let pos = notesMatchIdx + 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    const aOpen = html.lastIndexOf("<a", pos - 1);
    if (aOpen < 0 || notesMatchIdx - aOpen > 900) return false;
    const gt = html.indexOf(">", aOpen);
    if (gt < 0) {
      pos = aOpen;
      continue;
    }
    if (notesMatchIdx <= gt) {
      pos = aOpen;
      continue;
    }
    const closeA = html.indexOf("</a>", gt);
    if (closeA !== -1 && notesMatchIdx >= closeA) {
      pos = aOpen;
      continue;
    }
    const openTag = html.slice(aOpen, gt + 1);
    if (!/^<a\b/i.test(openTag) || !/href\s*=\s*["']#/i.test(openTag)) return false;
    return (
      /text-decoration\s*:\s*underline/i.test(openTag) ||
      /color\s*:\s*#0000ff/i.test(openTag)
    );
  }
  return false;
}

/** Prefer first substantive Notes header — skip TOC `#fragment` rows that precede real statements. */
function findNotesSectionHeaderIndex(html: string, regionStart: number, regionEnd: number): number | null {
  const scanCap = Math.min(html.length, Math.max(regionEnd, regionStart + 4_000_000));
  const candidates: number[] = [];

  const collect = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const idx = m.index;
      if (idx >= regionStart && idx < scanCap) candidates.push(idx);
    }
  };

  for (const re of NOTES_HEADER_RES) collect(re);
  for (const re of NOTES_HEADER_LOOSE_RES) collect(re);

  if (candidates.length === 0) return null;

  const sorted = [...new Set(candidates)].sort((a, b) => a - b);
  const substantive = sorted.filter((idx) => !notesHeaderAnchoredByTocFragmentLink(html, idx));
  const pickFrom = substantive.length > 0 ? substantive : sorted;
  return pickFrom[0] ?? null;
}

/** Notes anchor can sit past an aggressive {@link financialStatementsCeiling}; widen scan for the header only. */
function resolveNotesSectionStart(html: string, regionStart: number, regionEnd: number): number {
  const found = findNotesSectionHeaderIndex(html, regionStart, regionEnd);
  return found ?? regionStart;
}

/** Plain excerpt is Item 8/9 boilerplate without numbered notes — primary doc may omit inline notes. */
function excerptLooksLikeItemOutlineWithoutNotes(excerpt: string): boolean {
  const t = normalizePlainForMatch(excerpt.slice(0, 14_000));
  return (
    /\bitem\s+8\b/.test(t) &&
    /\bfinancial\s+statements\b/.test(t) &&
    /\bitem\s+9\b/.test(t) &&
    !/\bnote\s+[0-9]{1,2}[a-z]?\b/.test(t) &&
    !/\(\s*[0-9]{1,2}[a-z]?\s*\)\s+[a-z]/.test(t)
  );
}

/** TOC rows: many consecutive Item N lines with page refs — not extractable footnotes. */
function excerptLooksLikeTableOfContentsOutline(excerpt: string): boolean {
  const t = normalizePlainForMatch(excerpt.slice(0, 28_000));
  const itemHits = (t.match(/\bitem\s+\d+[a-z]?\./gi) ?? []).length;
  if (/\btable\s+of\s+contents\b/.test(t) && itemHits >= 4) return true;
  if (itemHits >= 8 && /\b\d{1,3}\s*-\s*\d{1,3}\b/.test(t) && /\bitem\s+8\b/.test(t) && /\bitem\s+16\b/.test(t))
    return true;
  return false;
}

type HeadingHit = {
  index: number;
  end: number;
  noteNum: string;
  titleRaw: string;
  priority: number;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headingHitsFromCanonicalNoteBlocks(
  noteBlocks: import("@/lib/secDebtFootnote/noteSegmentation").CanonicalNoteBlock[],
): HeadingHit[] {
  return noteBlocks.map((nb) => {
    const re = new RegExp(`^(?:Note|NOTE)\\s+${escapeRegex(nb.note_number)}\\s*`, "i");
    const titleRaw = nb.exact_heading.replace(re, "").trim();
    return {
      index: nb.heading_start_offset,
      end: nb.heading_end_offset,
      noteNum: nb.note_number,
      titleRaw: titleRaw.length ? titleRaw : nb.normalized_heading,
      priority: 110,
    };
  });
}

/**
 * Drop TOC / ix bleed headings like “Note 13 …” immediately followed in document order by Note 1–6
 * (segment between them is not a real Note 13 body — classic GTN-style ordering bug).
 */
function filterBogusHighNoteHeadingHits(headings: HeadingHit[]): HeadingHit[] {
  const sorted = [...headings].sort((a, b) => a.index - b.index);
  const out: HeadingHit[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i]!;
    const n = parseInt(h.noteNum.replace(/[^\d]/g, ""), 10);
    const next = sorted[i + 1];
    const nn = next ? parseInt(next.noteNum.replace(/[^\d]/g, ""), 10) : NaN;
    if (Number.isFinite(n) && Number.isFinite(nn) && n >= 9 && nn <= 8 && nn < n - 3) {
      continue;
    }
    out.push(h);
  }
  return out;
}

/** After note number: dash variants, period + title, or whitespace before title. */
const SEP_AFTER_NUM =
  String.raw`(?:[\.\):]\s*)?(?:[\u2014\-–—]\s*|&#8212;\s*|&#x2014;\s*|&#8211;\s*|&#151;\s*|\.(?:&#160;)?\s+|(?:\s{2,})|\s+)`;

/** Some filers use `(7) Long-Term Debt` instead of `Note 7` / `7.` — allow `(` or `&#40;`. */
const PAREN_NUM_HEAD =
  String.raw`(?:\(|\&#40;|\&#x28;)\s*(\d{1,2}[A-Z]?)\s*(?:\)|\&#41;|\&#x29;)`;

function dedupeHeadings(hits: HeadingHit[]): HeadingHit[] {
  const sorted = [...hits].sort((a, b) => a.index - b.index || b.priority - a.priority);
  const out: HeadingHit[] = [];
  for (const h of sorted) {
    const dup = out.find((x) => Math.abs(x.index - h.index) < 48 && x.noteNum === h.noteNum);
    if (dup) {
      if (h.priority > dup.priority) {
        const i = out.indexOf(dup);
        out[i] = h;
      }
      continue;
    }
    out.push(h);
  }
  return out.sort((a, b) => a.index - b.index);
}

function scanNoteHeadings(html: string, notesStart: number, regionEnd: number): HeadingHit[] {
  const hits: HeadingHit[] = [];

  const pushBoldLike = (re: RegExp, priority: number) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const idx = m.index;
      if (idx < notesStart || idx >= regionEnd) continue;
      const noteNum = (m[2] ?? "").trim();
      const titleRaw = (m[3] ?? "").trim();
      hits.push({ index: idx, end: idx + m[0].length, noteNum, titleRaw, priority });
    }
  };

  const pushBoldParen = (re: RegExp, priority: number) => {
    re.lastIndex = 0;
    let pm;
    while ((pm = re.exec(html)) !== null) {
      const idx = pm.index;
      if (idx < notesStart || idx >= regionEnd) continue;
      const noteNum = (pm[1] ?? "").trim();
      const titleRaw = (pm[2] ?? "").trim();
      hits.push({ index: idx, end: idx + pm[0].length, noteNum, titleRaw, priority });
    }
  };

  const boldRe = new RegExp(
    String.raw`<(?:b|strong)(?:\s[^>]*)?>\s*((?:Note|NOTE)\s+(\d{1,2}[A-Z]?)\s*` +
      SEP_AFTER_NUM +
      String.raw`([\s\S]{0,1200}?))\s*</(?:b|strong)>`,
    "gi",
  );
  pushBoldLike(boldRe, 100);

  const boldParenRe = new RegExp(
    String.raw`<(?:b|strong)(?:\s[^>]*)?>\s*` +
      PAREN_NUM_HEAD +
      String.raw`\s*` +
      SEP_AFTER_NUM +
      String.raw`([\s\S]{0,1200}?)\s*</(?:b|strong)>`,
    "gi",
  );
  pushBoldParen(boldParenRe, 99);

  /* `<b>(6)</b><b> Debt</b>` split tags — common in EDGAR. */
  const splitBoldParenRe = new RegExp(
    String.raw`<(?:b|strong)(?:\s[^>]*)?>\s*` +
      PAREN_NUM_HEAD +
      String.raw`\s*</(?:b|strong)>\s*<(?:b|strong)(?:\s[^>]*)?>\s*([\s\S]{2,800}?)\s*</(?:b|strong)>`,
    "gi",
  );
  pushBoldParen(splitBoldParenRe, 98);

  const fontBoldRe = new RegExp(
    String.raw`<font[^>]*font-weight\s*:\s*bold[^>]*>\s*((?:Note|NOTE)\s+(\d{1,2}[A-Z]?)\s*` +
      SEP_AFTER_NUM +
      String.raw`([\s\S]{0,1200}?))\s*</font>`,
    "gi",
  );
  pushBoldLike(fontBoldRe, 95);

  const fontBoldParenRe = new RegExp(
    String.raw`<font[^>]*font-weight\s*:\s*bold[^>]*>\s*` +
      PAREN_NUM_HEAD +
      String.raw`\s*` +
      SEP_AFTER_NUM +
      String.raw`([\s\S]{0,1200}?)\s*</font>`,
    "gi",
  );
  pushBoldParen(fontBoldParenRe, 96);

  const spanBoldRe = new RegExp(
    String.raw`<span[^>]*(?:font-weight\s*:\s*(?:bold|700)|(?:fontWeight\s*=\s*["']700["']))[^>]*>\s*((?:Note|NOTE)\s+(\d{1,2}[A-Z]?)\s*` +
      SEP_AFTER_NUM +
      String.raw`([\s\S]{0,1200}?))\s*</span>`,
    "gi",
  );
  pushBoldLike(spanBoldRe, 92);

  const spanBoldParenRe = new RegExp(
    String.raw`<span[^>]*(?:font-weight\s*:\s*(?:bold|700)|(?:fontWeight\s*=\s*["']700["']))[^>]*>\s*` +
      PAREN_NUM_HEAD +
      String.raw`\s*` +
      SEP_AFTER_NUM +
      String.raw`([\s\S]{0,1200}?)\s*</span>`,
    "gi",
  );
  pushBoldParen(spanBoldParenRe, 94);

  /** Between adjacent wrappers when filers use `&nbsp;` / entities between number and title spans. */
  const SPAN_NOTE_HEAD_GAP = String.raw`(?:\s|&nbsp;|&#160;|&#xa0;|&#xA0;)*`;

  /**
   * Numeric-dot headings split across tags: `<span…>11.</span><span…> Long-term Corporate Debt…</span>` (CAR 10-Q).
   * Plain {@link numericRe} needs characters after `. ` with no `<`, so split wrappers never match.
   */
  const splitBoldNumericDotRe = new RegExp(
    String.raw`<(?:b|strong)(?:\s[^>]*)?>\s*(\d{1,2}[A-Z]?)\s*\.\s*</(?:b|strong)>` +
      SPAN_NOTE_HEAD_GAP +
      String.raw`<(?:b|strong)(?:\s[^>]*)?>\s*([\s\S]{2,800}?)\s*</(?:b|strong)>`,
    "gi",
  );
  splitBoldNumericDotRe.lastIndex = 0;
  let snm: RegExpExecArray | null;
  while ((snm = splitBoldNumericDotRe.exec(html)) !== null) {
    const idx = snm.index;
    if (idx < notesStart || idx >= regionEnd) continue;
    hits.push({
      index: idx,
      end: idx + snm[0].length,
      noteNum: (snm[1] ?? "").trim(),
      titleRaw: (snm[2] ?? "").trim(),
      priority: 97,
    });
  }

  const splitSpanNumericDotRe = new RegExp(
    String.raw`<span[^>]*(?:font-weight\s*:\s*(?:bold|700)|(?:fontWeight\s*=\s*["']700["']))[^>]*>\s*(\d{1,2}[A-Z]?)\s*\.\s*</span>` +
      SPAN_NOTE_HEAD_GAP +
      String.raw`<span[^>]*(?:font-weight\s*:\s*(?:bold|700)|(?:fontWeight\s*=\s*["']700["']))[^>]*>\s*([\s\S]{2,800}?)\s*</span>`,
    "gi",
  );
  splitSpanNumericDotRe.lastIndex = 0;
  while ((snm = splitSpanNumericDotRe.exec(html)) !== null) {
    const idx = snm.index;
    if (idx < notesStart || idx >= regionEnd) continue;
    hits.push({
      index: idx,
      end: idx + snm[0].length,
      noteNum: (snm[1] ?? "").trim(),
      titleRaw: (snm[2] ?? "").trim(),
      priority: 96,
    });
  }

  /** Workiva/CAR: bold on `<p>` / `<div>`, plain `<span>` children (no per-span font-weight). */
  const splitInheritedBoldNumericDotRe = new RegExp(
    String.raw`<(?:p|div)\b[^>]*(?:font-weight\s*:\s*(?:bold|700)|(?:fontWeight\s*=\s*["']700["']))[^>]*>\s*` +
      String.raw`<span\b[^>]*>\s*(\d{1,2}[A-Z]?)\s*\.\s*</span>` +
      SPAN_NOTE_HEAD_GAP +
      String.raw`<span\b[^>]*>\s*([\s\S]{2,800}?)\s*</span>`,
    "gi",
  );
  splitInheritedBoldNumericDotRe.lastIndex = 0;
  while ((snm = splitInheritedBoldNumericDotRe.exec(html)) !== null) {
    const idx = snm.index;
    if (idx < notesStart || idx >= regionEnd) continue;
    hits.push({
      index: idx,
      end: idx + snm[0].length,
      noteNum: (snm[1] ?? "").trim(),
      titleRaw: (snm[2] ?? "").trim(),
      priority: 95,
    });
  }

  /**
   * Last resort: two plain spans — avoids missing CAR when neither span declares bold.
   * Guard with plain-title shape to reduce table/TOC noise.
   */
  const splitSpanNumericDotLooseRe = new RegExp(
    String.raw`<span\b[^>]*>\s*(\d{1,2}[A-Z]?)\s*\.\s*</span>` +
      SPAN_NOTE_HEAD_GAP +
      String.raw`<span\b[^>]*>\s*([\s\S]{2,800}?)\s*</span>`,
    "gi",
  );
  splitSpanNumericDotLooseRe.lastIndex = 0;
  while ((snm = splitSpanNumericDotLooseRe.exec(html)) !== null) {
    const idx = snm.index;
    if (idx < notesStart || idx >= regionEnd) continue;
    const titleRaw = (snm[2] ?? "").trim();
    if (/<table\b/i.test(titleRaw)) continue;
    const plainTitle = collapseWs(stripTagsToPlain(titleRaw).replace(/\u00a0/g, " ")).trim();
    if (plainTitle.length < 10 || plainTitle.length > 220) continue;
    if (!/^[A-Za-z(]/.test(plainTitle)) continue;
    hits.push({
      index: idx,
      end: idx + snm[0].length,
      noteNum: (snm[1] ?? "").trim(),
      titleRaw,
      priority: 88,
    });
  }

  const plainNoteRe = new RegExp(
    String.raw`\b((?:Note|NOTE)\s+(\d{1,2}[A-Z]?)\s*` + SEP_AFTER_NUM + String.raw`([^<\r\n]{2,480}))`,
    "gi",
  );
  plainNoteRe.lastIndex = 0;
  let m;
  while ((m = plainNoteRe.exec(html)) !== null) {
    const idx = m.index;
    if (idx < notesStart || idx >= regionEnd) continue;
    hits.push({
      index: idx,
      end: idx + m[0].length,
      noteNum: (m[2] ?? "").trim(),
      titleRaw: (m[3] ?? "").trim(),
      priority: 55,
    });
  }

  const plainParenRe = new RegExp(
    String.raw`(^|[>\n\r])(\s*)` + PAREN_NUM_HEAD + String.raw`\s*` + SEP_AFTER_NUM + String.raw`([^<\r\n]{3,480})`,
    "gim",
  );
  plainParenRe.lastIndex = 0;
  while ((m = plainParenRe.exec(html)) !== null) {
    const idx = m.index + (m[1] ?? "").length + (m[2] ?? "").length;
    if (idx < notesStart || idx >= regionEnd) continue;
    hits.push({
      index: idx,
      end: plainParenRe.lastIndex,
      noteNum: (m[3] ?? "").trim(),
      titleRaw: (m[4] ?? "").trim(),
      priority: 53,
    });
  }

  const tailFromNotes = html.slice(notesStart);
  const numericRe = /(^|[>\n\r])(\s*)(\d{1,2}[A-Z]?)\s*\.\s+([^<\r\n]{2,180})/gm;
  numericRe.lastIndex = 0;
  while ((m = numericRe.exec(tailFromNotes)) !== null) {
    const idx = notesStart + m.index + m[1].length + m[2].length;
    if (idx >= regionEnd) break;
    const noteNum = (m[3] ?? "").trim();
    const titleRaw = (m[4] ?? "").trim();
    if (!/^[A-Za-z0-9]/.test(titleRaw)) continue;
    const nDot = parseInt(noteNum.replace(/[^\d]/g, ""), 10);
    /* Amounts like "67. Accumulated other comprehensive loss" match `\d{1,2}\.` — cap fake note numbers (GTN-style). */
    if (!Number.isFinite(nDot) || nDot < 1 || nDot > 30) continue;
    hits.push({
      index: idx,
      end: notesStart + numericRe.lastIndex,
      noteNum,
      titleRaw,
      priority: 45,
    });
  }

  const parenLineRe =
    /(^|[>\n\r])(\s*)(?:\(|\&#40;|\&#x28;)\s*(\d{1,2}[A-Z]?)\s*(?:\)|\&#41;|\&#x29;)\s+(?=[A-Za-z])([^<\r\n]{2,180})/gm;
  parenLineRe.lastIndex = 0;
  while ((m = parenLineRe.exec(tailFromNotes)) !== null) {
    const idx = notesStart + m.index + (m[1] ?? "").length + (m[2] ?? "").length;
    if (idx >= regionEnd) break;
    const noteNum = (m[3] ?? "").trim();
    const titleRaw = (m[4] ?? "").trim();
    if (!/^[A-Za-z]/.test(titleRaw)) continue;
    hits.push({
      index: idx,
      end: notesStart + parenLineRe.lastIndex,
      noteNum,
      titleRaw,
      priority: 44,
    });
  }

  return dedupeHeadings(hits).filter((h) => {
    const preview = headingTitleLine(h, html);
    if (isExcludedNonDebtHeadingTitle(h.titleRaw, preview)) return false;
    if (isCrossReferenceNoteHeading(html, h.index, h.titleRaw, preview)) return false;
    if (isNumberedScheduleFootnotePseudoHeading(h.titleRaw)) return false;
    return true;
  });
}

function headingTitleLine(hit: HeadingHit, html: string): string {
  const maxEnd = Math.min(hit.end + 220, html.length);
  let end = maxEnd;
  const chunk = html.slice(hit.index, maxEnd);
  const m = chunk.match(/<\/p\b[^>]*>/i);
  if (m && m.index !== undefined) end = hit.index + m.index + m[0].length;
  const frag = html.slice(hit.index, end);
  let plain = stripTagsToPlain(frag);
  plain = collapseSpacedLetters(plain);
  return collapseWs(plain).slice(0, 240);
}

function scoreDebtHeading(titleRaw: string): number {
  const t = normalizePlainForMatch(titleRaw);
  let s = 0;
  if (/\bdebt\b/.test(t)) s += 10;
  if (/\blong[\s\-]*term\s+debt\b/.test(t)) s += 10;
  if (/\bshort[\s\-]*term\s+debt\b/.test(t)) s += 8;
  if (/\bshort[\s\-]*term\s+.*long[\s\-]*term\s+debt\b/.test(t)) s += 10;
  if (/\bborrowings?\b/.test(t)) s += 9;
  if (/\bcredit\s+facilit(?:y|ies)\b/.test(t)) s += 8;
  if (/\brevolving\s+(?:credit|facility)\b/.test(t)) s += 7;
  if (/\bnotes?\s+payable\b/.test(t)) s += 8;
  if (/\bindebtedness\b/.test(t)) s += 8;
  if (/\bsecured\s+notes?\b/.test(t)) s += 7;
  if (/\bunsecured\s+notes?\b/.test(t)) s += 7;
  if (/\bterm\s+loans?\b/.test(t)) s += 7;
  if (/\bsenior\s+notes?\b/.test(t)) s += 7;
  if (/\bconvertible\s+notes?\b/.test(t) || /\bexchangeable\s+notes?\b/.test(t)) s += 7;
  if (/\bfinancing\s+arrangements\b/.test(t)) s += 6;
  if (/\bdebt\s+and\s+financing\s+obligations\b/.test(t)) s += 9;
  if (/\bfinance\s+lease\s+obligations\b/.test(t)) s += 5;
  if (/\bloans?\s+payable\b/.test(t)) s += 7;
  if (/\bfinancing\s+liabilit(?:y|ies)\b/.test(t)) s += 7;
  if (/\bdebt\s+obligations\b/.test(t)) s += 9;
  if (/\bdebt\s*,\s*net\b/.test(t)) s += 9;
  if (/\bdebentures?\b/.test(t)) s += 8;
  if (/\bdebt\s+and\s+(?:capital\s+lease|finance\s+lease)/.test(t)) s += 10;
  if (/\bsecuritization\s+debt\b/.test(t)) s += 8;
  if (/\bvariable\s+interest\s+entit(?:y|ies)\s+debt\b/.test(t)) s += 6;

  if (/\bcommitments\s+and\s+contingencies\b/.test(t)) s += 4;
  if (/\bvariable\s+interest\s+entit/.test(t)) s += 4;
  if (/\bfair\s+value\s+of\s+financial\s+instruments\b/.test(t)) s += 3;
  if (/\bfair\s+value\s+measurements\b/.test(t)) s += 3;
  if (/\binterest\s+expense\b/.test(t)) s += 3;
  if (/^(leases?)\b/.test(t) && !/finance\s+lease/.test(t)) s += 2;
  if (/\bfinance\s+leases?\b/.test(t)) s += 4;
  if (/\bderivative\s+instruments\b/.test(t)) s += 3;
  if (/\bguarantees?\b/.test(t)) s += 3;
  if (/\bliquidity\b/.test(t)) s += 2;
  if (/\bobligations\b/.test(t) && !/\bstockholders?'?\s+equity\b/.test(t)) s += 2;

  if (/\bincome\s+tax/.test(t)) s -= 10;
  if (/\brevenues?\b/.test(t)) s -= 10;
  if (/\bstockholders?'?\s+equity\b|\bshareholders?'?\s+equity\b/.test(t)) s -= 10;
  if (/\bearnings\s+per\s+share\b|\beps\b/.test(t)) s -= 9;
  if (/\bstock(?:\s+|-)?based\s+compensation\b|\bshare[\s-]?based\b/.test(t)) s -= 9;
  if (/\bpension\b|\bretirement\s+benefits\b/.test(t)) s -= 8;

  return s;
}

/** Step 5 — high-confidence borrowings wording in the note title (normalized blob). */
function headingHasHighConfidenceDebtTerm(t: string): boolean {
  return (
    /\bdebt\b/.test(t) ||
    /\blong[\s\-]*term\s+debt\b/.test(t) ||
    /\bshort[\s\-]*term\s+debt\b/.test(t) ||
    /\bborrowings?\b/.test(t) ||
    /\bindebtedness\b/.test(t) ||
    /\bnotes?\s+payable\b/.test(t) ||
    /\bbenior\s+notes?\b/.test(t) ||
    /\bsecured\s+notes?\b/.test(t) ||
    /\bunsecured\s+notes?\b/.test(t) ||
    /\bcredit\s+facilit(?:y|ies)\b/.test(t) ||
    /\brevolving\s+(?:credit|facility)\b/.test(t) ||
    /\bterm\s+loans?\b/.test(t) ||
    /\bloans?\s+payable\b/.test(t) ||
    /\bfinancing\s+arrangements\b/.test(t) ||
    /\bdebt\s+obligations\b/.test(t) ||
    /\bdebt\s+and\s+financing\s+obligations\b/.test(t) ||
    /\bdebt\s*,\s*net\b/.test(t) ||
    /\bdebt\s+and\s+(?:finance|capital)\s+lease\b/.test(t) ||
    /\bconvertible\s+notes?\b/.test(t) ||
    /\bexchangeable\s+notes?\b/.test(t) ||
    /\bsecuritization\s+debt\b/.test(t) ||
    /\bfinancing\s+liabilit/.test(t) ||
    /\bdebentures?\b/.test(t) ||
    /\bvariable\s+interest\s+entit(?:y|ies)\s+debt\b/.test(t)
  );
}

/** Step 8 — fallback note titles when no dedicated Debt heading exists. */
function headingIsStep8FallbackCandidate(t: string): boolean {
  return (
    /\bcommitments\s+and\s+contingencies\b/.test(t) ||
    /\bfair\s+value\s+(?:measurements|of\s+financial\s+instruments)\b/.test(t) ||
    /\bleases?\b/.test(t) ||
    /\bfinancing\s+arrangements\b/.test(t) ||
    /\bvariable\s+interest\s+entit/.test(t) ||
    /\brelated\s+party\b/.test(t) ||
    /\bsubsequent\s+events\b/.test(t)
  );
}

/** Step 8 — embedded debt disclosure body signals (normalized plain). */
function fallbackBodyHasExplicitDebtSignals(normPlain: string): boolean {
  const needles = [
    "credit agreement",
    "revolving credit facility",
    "term loan",
    "senior notes",
    "notes payable",
    "long-term debt",
    "borrowings outstanding",
    "debt obligations",
    "maturity date",
    "principal amount",
  ];
  let hits = 0;
  for (const n of needles) {
    if (normPlain.includes(n)) hits++;
  }
  return hits >= 3;
}

/** Headings that look like Item 15 / TOC / equity notes — never use as the debt footnote. */
function isExcludedNonDebtHeadingTitle(titleRaw: string, headingDisplay: string): boolean {
  const t = normalizePlainForMatch(`${titleRaw} ${headingDisplay}`);
  if (!t) return false;

  if (/^\d{1,2}[a-z]?\s*[\.)\u2014\-–—]\s*(?:the\s+)?exhibits?\b/.test(t)) return true;
  if (/^\d{1,2}[a-z]?\s*[\.)\u2014\-–—]\s*signatures?\b/.test(t)) return true;

  if (/^exhibits?\b/.test(t)) return true;
  if (/^signatures?\b/.test(t)) return true;
  if (/\bexhibit\s+index\b/.test(t)) return true;

  if (/\bfinancial\s+statement\s+schedules?\b/.test(t) && !/\bdebt\b/.test(t)) return true;
  if (/^supplementary\s+financial\s+information\b/.test(t)) return true;
  if (/^selected\s+(?:quarterly|financial)\b/.test(t)) return true;

  if ((/\bstockholders?'?\s+equity\b|\bshareholders?'?\s+equity\b/.test(t) || /\bmembers?'?\s+equity\b/.test(t)) && !/\bdebt\b/.test(t))
    return true;
  if (/\bearnings\s+per\s+share\b|\beps\b/.test(t)) return true;
  if (/\bstock(?:\s+|-)?based\s+compensation\b|\bshare[\s-]?based\b/.test(t)) return true;
  if (/\bincome\s+tax(?:es)?\b/.test(t) && !/\bdebt\b/.test(t)) return true;

  if (/^organization\b|^business\b|^basis\s+of\s+presentation\b|^significant\s+accounting\b/.test(t)) return true;

  /* Revenue / segment revenue tables (FICO 10-Q) — cite “Note 7” for debt in prose but heading is not borrowings. */
  if (
    (/\brevenues?\b/.test(t) || /\brevenue\s+recognition\b/.test(t) || /\bdisaggregation\s+of\s+revenue\b/.test(t)) &&
    !/\bdebt\b/.test(t) &&
    !/\bborrowings?\b/.test(t)
  )
    return true;

  /* Segment notes cite debt once in EBITDA lists (“early extinguishment of debt”) — huge bodies inflate lexicon hits vs real borrowings notes (CAR 10-Q). */
  if (
    (/\bsegment\s+information\b/.test(t) ||
      /\bsegment\s+reporting\b/.test(t) ||
      /\boperating\s+segments?\b/.test(t) ||
      /\bbusiness\s+segments?\b/.test(t)) &&
    !/\bdebt\b/.test(t) &&
    !/\bborrowings?\b/.test(t)
  )
    return true;

  /* Table/chart footnotes under debt schedules — not note headings. */
  if (/^\(\s*\d{1,2}\s*\)\s*measured\s+at\s+fair\s+value\b/.test(t)) return true;
  if (/^\(\s*\d{1,2}\s*\)\s*classified\s+as\s+current\b/.test(t)) return true;

  /* QVCGA-style "(4) Assets and Liabilities Measured at Fair Value" — huge note, many lexicon false positives. */
  if (
    /\bfair\s+value\s+(?:measurements|hierarchy|disclosures|accounting)\b/.test(t) ||
    /\bfair\s+value\s+of\s+financial\b/.test(t) ||
    /\bmeasured\s+at\s+fair\s+value\b/.test(t) ||
    (/\bassets\s+and\s+liabilities\b/.test(t) && /\bfair\s+value\b/.test(t))
  ) {
    if (!/\bdebt\b/.test(t) && !/\bborrowings?\b/.test(t)) return true;
  }

  /* Cash-flow supplemental tables (“cash paid for interest”) collide with debt-ish lexicon — exclude unless titled debt. */
  if (/\bsupplemental\s+disclosures?\b/.test(t) && /\bcash\s+flows?\b/.test(t) && !/\bdebt\b/.test(t) && !/\bborrowings?\b/.test(t))
    return true;
  if (/\bconsolidated\s+statements?\s+of\s+cash\s+flows?\b/.test(t) && !/\bdebt\b/.test(t) && !/\bborrowings?\b/.test(t)) return true;
  if (/\binvesting\s+and\s+financing\s+activities\b/.test(t) && !/\bdebt\b/.test(t)) return true;

  /* MD&A / non-notes sections must never be treated as financial-statement notes (mis-scoped HTML). */
  if (/\bliquidity\s+and\s+capital\s+resources\b/.test(t)) return true;
  if (/\bquantitative\s+and\s+qualitative\s+disclosures\s+about\s+market\s+risk\b/.test(t)) return true;
  if (/\bcontractual\s+obligations\b/.test(t)) return true;
  if (/\brisk\s+factors\b/.test(t)) return true;
  if (/\bcontrols\s+and\s+procedures\b/.test(t)) return true;

  /* SEC Item 1C cybersecurity — numeric-dot scanner treats “1C.” as note “1C”. */
  if (/^1c\s*\./i.test(t) && /\bcybersecurity\b/.test(t)) return true;

  return false;
}

/**
 * Inline prose references ("See Note 5 to the consolidated financial statements") match {@link plainNoteRe}
 * and pollute heading lists with segments that have little or no body (e.g. AVIS CAR 10-K).
 */
function isCrossReferenceNoteHeading(html: string, idx: number, titleRaw: string, preview: string): boolean {
  const tr = normalizePlainForMatch(titleRaw).trim();
  const combined = normalizePlainForMatch(`${titleRaw} ${preview}`).trim();
  const previewNorm = normalizePlainForMatch(preview).trim();
  /* “to **our** consolidated …” is common in MD&A cross-refs; older pattern only allowed “to [the] consolidated …”. */
  if (
    /^(?:to\s+)?(?:(?:the|our)\s+)?(?:accompanying\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/.test(
      combined,
    )
  )
    return true;
  /* Heading line begins with “Note 8 to our consolidated …” — only test preview start so mid-body cites do not false-positive. */
  if (
    /^note\s+\d{1,2}[a-z]?\s+to\s+(?:the\s+|our\s+)?(?:accompanying\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/i.test(
      previewNorm,
    )
  )
    return true;
  /* “Note 2 of the Notes to Consolidated Financial Statements included in Item 8…” (MD&A / risk-factor cites). */
  if (
    /^note\s+\d{1,2}[a-z]?\s+of\s+the\s+notes\s+to\s+(?:the\s+)?(?:consolidated\s+)?financial\s+statements\b/i.test(
      previewNorm,
    )
  )
    return true;
  if (/^to\s+the\s+financial\s+statements\b/.test(combined)) return true;
  if (/^to\s+our\s+financial\s+statements\b/.test(combined)) return true;
  if (/^included\s+in\b/.test(combined)) return true;
  if (/^as\s+described\s+in\b/.test(combined)) return true;
  if (/^for\s+(?:a\s+|the\s+)?discussion\b/.test(combined)) return true;
  if (/^for\s+additional\s+information\b/.test(combined)) return true;
  if (/^for\s+information\s+related\s+to\b/.test(combined)) return true;

  /* “Note 7 and Note 10 to the accompanying condensed consolidated financial statements” (plainNoteRe false hits). */
  if (/^\s*and\s+note\s+\d{1,2}[a-z]?\b/i.test(tr)) return true;
  if (/\bnote\s+\d{1,2}[a-z]?\s+and\s+note\s+\d{1,2}\b/i.test(combined)) return true;

  const beforeVis = collapseWs(html.slice(Math.max(0, idx - 240), idx).replace(/<[^>]+>/g, " "))
    .toLowerCase()
    .slice(-140);
  if (/\bsee\s+$/.test(beforeVis)) return true;
  if (/\brefer(?:red)?\s+to\s+$/.test(beforeVis)) return true;
  if (/\balso\s+see\s+$/.test(beforeVis)) return true;
  if (/\bdescribed\s+in\s+$/.test(beforeVis)) return true;
  if (/\bpursuant\s+to\s+$/.test(beforeVis)) return true;

  return false;
}

/**
 * Lines like `(2) Reflects the unamortized discount…` or `(12) Maturity reference is to the earlier…` match
 * {@link parenLineRe} / {@link numericRe} / {@link boldParenRe} and split real notes (HTZ Note 7) into
 * pseudo-segments that outscore the real “Note N — Debt” heading on lexicon density.
 */
function isNumberedScheduleFootnotePseudoHeading(titleRaw: string): boolean {
  const t = normalizePlainForMatch(stripTagsToPlain(titleRaw)).trim().slice(0, 420);
  if (!t) return false;

  /* Pointer back to another note — never a note boundary (HTZ `(3) … as disclosed in Note 7, “Debt,” …`). */
  if (/\bas\s+disclosed\s+in\s+note\s+\d/i.test(t)) return true;
  if (/\bas\s+further\s+disclosed\s+in\s+note\b/i.test(t)) return true;

  /* Comparative boilerplate under instrument tables. */
  if (/\bas\s+opposed\s+to\b/i.test(t) && t.length >= 44) return true;

  /*
   * Real “(N) Section Title” headings are almost always short noun phrases; schedule footnotes run long with
   * commas / subordinate clauses (keep threshold conservative — rare note titles exceed ~130 chars).
   */
  if (t.length >= 130) return true;

  const commas = (t.match(/,/g) ?? []).length;
  if (t.length >= 58 && commas >= 2 && /\b(?:including|net\s+of|versus|at\s+issuance|using\s+the\s+effective\s+interest)\b/i.test(t))
    return true;

  return (
    /^reflects?\s+(?:the\s+)?/i.test(t) ||
    /^maturity\s+reference\b/i.test(t) ||
    /^the\s+exchange\s+feature\b/i.test(t) ||
    /^exchange\s+feature\b/i.test(t) ||
    /^debt\s+discounts\b/i.test(t) ||
    /^debt\s+issuance\s+costs?\b/i.test(t) ||
    /^interest\s+expense\s+(?:recognized|consists)\b/i.test(t) ||
    /^contractual\s+interest\b/i.test(t) ||
    /^as\s+further\s+disclosed\b/i.test(t) ||
    /^was\s+bifurcated\b/i.test(t) ||
    /^represent(?:s|ing)?\s+/i.test(t) ||
    /^includes?\s+(?:the\s+)?(?:following|amounts|only|deferred|operations)/i.test(t) ||
    /^excludes?\s+/i.test(t) ||
    /^amounts?\s+(?:in\s+millions|presented|are|were)\b/i.test(t) ||
    /^other\s+vehicle\s+debt\s+is\b/i.test(t) ||
    /^primarily\s+comprised\b/i.test(t) ||
    /^entered\s+into\b/i.test(t) ||
    /^were\s+entered\b/i.test(t) ||
    /^the\s+capped\s+call\b/i.test(t) ||
    /^non[\s-]?vehicle\b/i.test(t) ||
    /^unamortized\b/i.test(t) ||
    /^see\s+note\b/i.test(t) ||
    /^in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(t) ||
    /^the\s+company\s+(?:made|received|entered|repaid|completed)\b/i.test(t)
  );
}

/**
 * Vocabulary regex targets typical of borrowings / debt footnotes (summed for scoring).
 */
const DEBT_SECTION_LEXICON: ReadonlyArray<RegExp> = [
  /\bdebt\b/gi,
  /\bborrowings?\b/gi,
  /\bcredit\s+facilit(?:y|ies)\b/gi,
  /\bcredit\s+agreements?\b/gi,
  /\blong[\s\-]*term\s+debt\b/gi,
  /\bcovenants?\b/gi,
  /\bmaturit(?:y|ies)\b/gi,
  /\bprincipal\b/gi,
  /\bindentures?\b/gi,
  /\blenders?\b/gi,
  /\bcollateral\b/gi,
  /\bsecured\s+notes?\b/gi,
  /\bunsecured\s+notes?\b/gi,
  /\brevolving\s+credit\b/gi,
  /\bterm\s+loans?\b/gi,
  /\binterest\s+rates?\b/gi,
  /\bconvertible\s+notes?\b/gi,
  /\bdebentures?\b/gi,
  /\bexchangeable\s+(?:senior\s+)?debentures?\b/gi,
  /\bsenior\s+debentures?\b/gi,
  /\bnotes?\s+payable\b/gi,
  /\bletters?\s+of\s+credit\b/gi,
  /\bindebtedness\b/gi,
];

/** Regexes counted (global matches) within each `<table>` plain text — borrowings schedules accumulate large totals.
 * Avoid bare `notes` (captures random footnotes); prefer secured/unsecured/senior notes, payable, facilities.
 */
const DEBT_TABLE_KEYWORD_RES: ReadonlyArray<RegExp> = [
  /\bdebt\b/gi,
  /\bdebentures?\b/gi,
  /\bbenior\s+secured\b/gi,
  /\bbenior\s+notes?\b/gi,
  /\bsubordinated\s+notes?\b/gi,
  /\bsecured\s+notes?\b/gi,
  /\bunsecured\s+notes?\b/gi,
  /\bnotes?\s+payable\b/gi,
  /\bcredit\s+facilit(?:y|ies)\b/gi,
  /\bcredit\s+agreements?\b/gi,
  /\brevolving\s+(?:credit\s+)?facility\b/gi,
  /\brevolving\s+credit\b/gi,
  /\bterm\s+loans?\b/gi,
  /\bindentures?\b/gi,
  /\bmaturit(?:y|ies)\b/gi,
  /\bprincipal\b/gi,
  /\boutstanding\b/gi,
  /\bcarrying\s+(?:amount|value)\b/gi,
  /\blong[\s-]*term\s+debt\b/gi,
  /\bshort[\s-]*term\s+debt\b/gi,
  /\bcovenants?\b/gi,
  /\bcollateral\b/gi,
  /\blenders?\b/gi,
  /\bletters?\s+of\s+credit\b/gi,
  /\bborrow(?:ings?|owed)\b/gi,
  /\bdeferred\s+financ(?:ing|e)\s+fees\b/gi,
  /\bfloating\s+rate\b/gi,
  /\beuro[\s-]*denominat\b/gi,
  /\bond\s+discount\b/gi,
  /\bunamortized\b/gi,
  /\bdebt\s+issuance\b/gi,
  /\bissuance\s+costs?\b/gi,
  /\bunamortized\s+(?:debt\s+)?issuance\s+costs?\b/gi,
  /\bunamortized\s+(?:discount|premium)s?\b/gi,
  /\b(?:discount|premium)s?\s+on\s+debt\b/gi,
];

/** Word-token count after normalization (table numbers dilute density like ordinary tokens). */
function countNormalizedWordTokens(normalizedPlain: string): number {
  if (!normalizedPlain.trim()) return 0;
  return normalizedPlain.split(/\s+/).filter(Boolean).length;
}

/** Sum of pattern occurrences in normalized plain text. */
function countDebtLexiconFrequency(normalizedPlain: string): number {
  let total = 0;
  for (const pattern of DEBT_SECTION_LEXICON) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const matches = normalizedPlain.match(re);
    total += matches?.length ?? 0;
  }
  return total;
}

/** Exhibit listing tables mention filings — heavy penalty so they don't beat real debt notes. */
function exhibitCatalogPenalty(sliceHtml: string): number {
  const head = stripTagsToPlain(sliceHtml.slice(0, 140_000));
  const t = normalizePlainForMatch(head);
  let signals = 0;
  if (/\bexhibit\s+number\b/.test(t)) signals++;
  if (/\bincorporated\s+by\s+reference\b/.test(t)) signals++;
  if (/\bsec\s+file\s+no\b/.test(t)) signals++;
  if (/\bincluded\s+herein\s+by\s+reference\b/.test(t)) signals++;
  if (signals >= 3) return 28;
  if (signals >= 2) return 20;
  return 0;
}

function countDebtBodyIndicators(plain: string): number {
  const t = normalizePlainForMatch(plain);
  const terms = [
    "revolving credit facility",
    "credit agreement",
    "term loan",
    "senior notes",
    "secured notes",
    "unsecured notes",
    "notes payable",
    "maturity",
    "maturity date",
    "interest rate",
    "principal amount",
    "outstanding",
    "borrowings",
    "lender",
    "collateral",
    "covenant",
    "compliance",
    "letters of credit",
    "availability",
    "amortization",
    "debt issuance costs",
    "unamortized discount",
    "current portion of long-term debt",
    "long-term debt",
    "finance lease obligations",
    "weighted average interest rate",
    "total debt",
    "indenture",
    "credit facility",
    "borrowings outstanding",
    "debt obligations",
    "convertible notes",
    "revolving credit",
  ];
  let c = 0;
  for (const term of terms) {
    if (t.includes(term)) c++;
  }
  const tableHints =
    /\b(?:total\s+debt|less:\s*current\s+portion|senior\s+secured\s+notes|finance\s+lease\s+obligations)\b/.test(t);
  if (tableHints) c += 2;
  return c;
}

function detectIxDuplication(plain: string): boolean {
  const p = normalizePlainForMatch(plain);
  return /\b(\w+(?:\s+\w+){0,5})\s+\1\b/i.test(p);
}

function tagBoundaryTableOpen(html: string, idx: number): boolean {
  const lower = html.slice(idx, idx + 6).toLowerCase();
  if (lower !== "<table") return false;
  const c = html[idx + 6];
  return c === undefined || /[\s/>]/.test(c);
}

function endOfOpenTableTag(html: string, openIdx: number): number {
  let j = openIdx + 6;
  while (j < html.length && html[j] !== ">") j++;
  return j < html.length ? j + 1 : html.length;
}

function extractNextTable(html: string, from: number): { html: string; end: number } | null {
  let start = -1;
  for (let i = from; i < html.length - 6; i++) {
    if (tagBoundaryTableOpen(html, i)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let depth = 0;
  let i = start;
  if (tagBoundaryTableOpen(html, i)) {
    depth = 1;
    i = endOfOpenTableTag(html, i);
  }

  while (depth > 0 && i < html.length) {
    const nextOpen = html.toLowerCase().indexOf("<table", i);
    const nextClose = html.toLowerCase().indexOf("</table>", i);
    if (nextClose < 0) break;

    const openOk = nextOpen >= 0 && tagBoundaryTableOpen(html, nextOpen);
    if (openOk && nextOpen < nextClose) {
      depth++;
      i = endOfOpenTableTag(html, nextOpen);
      continue;
    }

    depth--;
    i = nextClose + "</table>".length;
  }

  if (depth !== 0) return null;
  return { html: html.slice(start, i), end: i };
}

/**
 * Score `<table>` blocks for classic debt-tranche schedules (coupons, maturities, senior notes, carrying values).
 * Lead-in prose immediately above the first table is included — filers often put “…borrowings consisted of:” outside cells.
 */
function scoreDebtInstrumentScheduleTables(sliceHtml: string): number {
  let score = 0;
  const leadChunk = sliceHtml.slice(0, 16_000);
  const leadPlain = normalizePlainForMatch(stripTagsToPlain(leadChunk));
  if (
    /\blong[\s-]*term\s+debt\b/.test(leadPlain) &&
    /\b(?:other\s+)?borrow(?:ings?|ing\s+arrangements)\b/.test(leadPlain) &&
    /\bconsisted\s+of\b/.test(leadPlain)
  )
    score += 9;
  if (/\bdebt\s+instruments?\b/.test(leadPlain) && /\boutstanding\b/.test(leadPlain)) score += 5;

  let pos = 0;
  for (let n = 0; n < 28; n++) {
    const tbl = extractNextTable(sliceHtml, pos);
    if (!tbl) break;
    pos = tbl.end;
    const plain = stripTagsToPlain(tbl.html);
    if (plain.length < 72) continue;
    const low = plain.toLowerCase();

    let tableScore = 0;
    if (/\blong[\s-]*term\s+debt\b/.test(low)) tableScore += 3;
    if (/\bsenior\s+notes?\b/.test(low)) tableScore += 4;
    if (/\bunsecured\s+notes?\b|\bsecured\s+notes?\b/.test(low)) tableScore += 3;
    if (/\bterm\s+loan\b/.test(low)) tableScore += 4;
    if (/\bfloating\s+rate\b/.test(low)) tableScore += 2;
    if (/euro[\s-]*denominat/.test(low)) tableScore += 2;
    if (/\bmaturity\b/.test(low)) tableScore += 2;
    if (/borrow(?:ings?)?\s+arrangements?\s+consisted\b/.test(low)) tableScore += 5;
    if (/\bconsisted\s+of\s*:/.test(low) && /\b(debt|borrow)/.test(low)) tableScore += 3;
    if (/deferred\s+financ(?:ing|e)\s+fees\b/.test(low)) tableScore += 3;
    if (/current\s+portion\s+of\s+long[\s-]*term\s+debt\b/.test(low)) tableScore += 3;
    if (/\bless\s*:\s*short[\s-]*term\s+debt\b/.test(low)) tableScore += 2;

    const pctTokens = plain.match(/\b\d+(?:\.\d+)?\s*%/g) ?? [];
    if (pctTokens.length >= 2) tableScore += Math.min(12, 2 + pctTokens.length * 2);

    const monthYears =
      plain.match(
        /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\.?\s+20\d{2}\b/gi,
      ) ?? [];
    if (monthYears.length >= 2) tableScore += Math.min(8, 2 + monthYears.length);

    if (/\bas\s+of\s+(?:march|june|september|december)\s+\d{1,2},?\s+20\d{2}\b/i.test(low)) tableScore += 4;

    if (/\btotal\b/i.test(plain) && pctTokens.length >= 1 && monthYears.length >= 1) tableScore += 2;

    score += tableScore;
  }

  return Math.min(52, score);
}

/** Sum of {@link DEBT_TABLE_KEYWORD_RES} matches in one table's plain text. */
function scoreDebtTableKeywordRichness(tableHtml: string): number {
  const plain = normalizePlainForMatch(stripTagsToPlain(tableHtml));
  if (plain.length < 36) return 0;
  let total = 0;
  for (const pattern of DEBT_TABLE_KEYWORD_RES) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    total += plain.match(re)?.length ?? 0;
  }
  return total;
}

/** Highest keyword richness among `<table>` blocks in this HTML slice (typically one note segment). */
function maxDebtTableKeywordScoreInSlice(sliceHtml: string): number {
  let max = 0;
  let pos = 0;
  for (let n = 0; n < 42; n++) {
    const tbl = extractNextTable(sliceHtml, pos);
    if (!tbl) break;
    pos = tbl.end;
    max = Math.max(max, scoreDebtTableKeywordRichness(tbl.html));
  }
  return max;
}

function htmlTableToMarkdown(tableHtml: string): string {
  const rows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const lines: string[] = [];
  for (const tr of rows) {
    const cells = [...tr.matchAll(/<(?:th|td)(?:\s[^>]*)?>([\s\S]*?)<\/(?:th|td)>/gi)];
    const parts = cells.map((x) => {
      const inner = stripTagsToPlain(x[1] ?? "").replace(/\|/g, "\\|");
      return inner || " ";
    });
    if (parts.some((p) => p.trim())) lines.push("| " + parts.join(" | ") + " |");
  }
  if (lines.length < 2) return "";
  return lines.join("\n");
}

type Segment = {
  hit: HeadingHit;
  start: number;
  end: number;
  sliceHtml: string;
  headingDisplay: string;
  headingScore: number;
  bodyIndicators: number;
  /** Total hits across {@link DEBT_SECTION_LEXICON} in section body. */
  debtLexiconHits: number;
  /** Word tokens in normalized body (density denominator). */
  bodyWordCount: number;
  /** Lexicon hits ÷ bodyWordCount. */
  debtLexiconDensity: number;
  combinedScore: number;
  hasTable: boolean;
  /** Instrument rows / maturity / coupon cues inside `<table>` blocks (+ nearby lead-in text). */
  debtInstrumentScheduleScore: number;
  /** Max {@link scoreDebtTableKeywordRichness} among tables in this note — drives table-first debt note selection. */
  maxDebtTableKeywordScore: number;
};

/** TOC / duplicate hits can yield segments with almost no text — drop before ranking. */
function segmentHasExtractableBody(s: Segment): boolean {
  if (/<table\b/i.test(s.sliceHtml)) return true;
  const collapsed = stripTagsToPlain(s.sliceHtml).replace(/\s+/g, "");
  return collapsed.length >= 55;
}

function buildSegmentAt(html: string, hit: HeadingHit, nextHit: HeadingHit | null, regionEnd: number): Segment {
  const start = hit.index;
  const endBound = nextHit ? nextHit.index : regionEnd;
  const end = Math.min(endBound, start + 900_000);
  const sliceHtml = html.slice(start, end);
  const headingDisplay = headingTitleLine(hit, html);
  const headingScore = scoreDebtHeading(hit.titleRaw + " " + headingDisplay);
  const plainBody = stripTagsToPlain(sliceHtml);
  const bodyNorm = normalizePlainForMatch(plainBody);
  const bodyIndicators = countDebtBodyIndicators(plainBody);
  const debtLexiconHits = countDebtLexiconFrequency(bodyNorm);
  const bodyWordCount = countNormalizedWordTokens(bodyNorm);
  const debtLexiconDensity = debtLexiconHits / Math.max(bodyWordCount, 1);
  let penalties = 0;
  const tl = normalizePlainForMatch(hit.titleRaw);
  if (/^leases?\b/.test(tl) && !/finance\s+lease/.test(tl) && bodyIndicators < 8) penalties += 5;

  const hasTable = /<table\b/i.test(sliceHtml);
  const catalogPen = exhibitCatalogPenalty(sliceHtml);
  const debtInstrumentScheduleScore = scoreDebtInstrumentScheduleTables(sliceHtml);
  const maxDebtTableKeywordScore = maxDebtTableKeywordScoreInSlice(sliceHtml);
  /** Lexicon + body + layout only — heading wording is not used to rank candidates. */
  const combinedScore =
    Math.min(bodyIndicators, 20) * 2 +
    Math.min(debtLexiconDensity * 7000, 160) +
    Math.min(debtLexiconHits * 0.25, 35) +
    Math.min(debtInstrumentScheduleScore * 0.55, 22) +
    Math.min(maxDebtTableKeywordScore * 0.12, 18) +
    (hasTable ? 6 : 0) -
    penalties -
    catalogPen;

  return {
    hit,
    start,
    end,
    sliceHtml,
    headingDisplay,
    headingScore,
    bodyIndicators,
    debtLexiconHits,
    bodyWordCount,
    debtLexiconDensity,
    combinedScore,
    hasTable,
    debtInstrumentScheduleScore,
    maxDebtTableKeywordScore,
  };
}

function buildSegments(html: string, headings: HeadingHit[], regionEnd: number): Segment[] {
  const sorted = [...headings].sort((a, b) => a.index - b.index);
  const seg: Segment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    seg.push(buildSegmentAt(html, sorted[i], i + 1 < sorted.length ? sorted[i + 1]! : null, regionEnd));
  }
  return seg;
}

function inferFormFromDoc(html: string): "10-K" | "10-Q" {
  const head = html.slice(0, 150_000).toLowerCase();
  const q = /\bform\s+10\s*[-–—]?\s*q\b|\b10\s*[-–—]\s*q\b(?!\s*\/)/i.test(head);
  const k = /\bform\s+10\s*[-–—]?\s*k\b|\b10\s*[-–—]\s*k\b/i.test(head);
  if (q && !k) return "10-Q";
  return "10-K";
}

function noteTitleNorm(seg: Segment): string {
  return normalizePlainForMatch(`${seg.hit.titleRaw} ${seg.headingDisplay}`);
}

/** Spec Step 3 — additive heading scores (capped loosely so lexicon still matters). */
function scoreDebtHeadingSpec(headingNorm: string): number {
  let s = 0;
  if (/\bdebt\b/.test(headingNorm)) s += 50;
  if (/\bborrowings?\b/.test(headingNorm)) s += 45;
  if (/\bindebtedness\b/.test(headingNorm)) s += 45;
  if (/\bcredit\s+facilities\b/.test(headingNorm)) s += 40;
  if (/\bcredit\s+facility\b/.test(headingNorm)) s += 40;
  if (/\bnotes?\s+payable\b/.test(headingNorm)) s += 40;
  if (/\bbenior\s+notes?\b/.test(headingNorm)) s += 35;
  if (/\bconvertible\s+notes?\b/.test(headingNorm) || /\bexchangeable\s+notes?\b/.test(headingNorm)) s += 35;
  if (/\bterm\s+loans?\b/.test(headingNorm)) s += 35;
  if (/\bfinancing\s+arrangements\b/.test(headingNorm)) s += 35;
  if (/\bfinance\s+lease\s+obligations\b/.test(headingNorm) || /\bdebt\s+and\s+finance\s+lease\b/.test(headingNorm))
    s += 25;
  if (/\bsecuritization\s+debt\b/.test(headingNorm)) s += 40;
  return Math.min(s, 130);
}

function scoreDebtNegativeHeadingSpecOnly(headingNorm: string): number {
  let n = 0;
  if (/\bincome\s+tax/.test(headingNorm)) n += 50;
  if (/\brevenues?\b/.test(headingNorm)) n += 50;
  if (/\bstockholders?'?\s+equity\b|\bshareholders?'?\s+equity\b/.test(headingNorm)) n += 50;
  if (/\bearnings\s+per\s+share\b|\beps\b/.test(headingNorm)) n += 40;
  if (
    /\bstock\s+compensation\b/.test(headingNorm) ||
    /\bshare[\s-]?based\b/.test(headingNorm) ||
    /\bstock(?:\s+|-)?based\s+compensation\b/.test(headingNorm)
  )
    n += 40;
  if (/\bpension\b|\bretirement\b/.test(headingNorm)) n += 40;
  return n;
}

const BODY_DEBT_TERM_SCORES: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bcredit\s+agreement\b/, 20],
  [/\brevolving\s+credit\s+facility\b/, 20],
  [/\bterm\s+loan\b/, 20],
  [/\bbenior\s+notes?\b/, 20],
  [/\bsecured\s+notes?\b/, 20],
  [/\bunsecured\s+notes?\b/, 20],
  [/\bnotes?\s+payable\b/, 20],
  [/\bborrowings\s+outstanding\b/, 15],
  [/\bprincipal\s+amount\b/, 10],
  [/\bmaturity\s+date\b/, 10],
  [/\binterest\s+rate\b/, 10],
  [/\bcollateral\b/, 10],
  [/\bguarantors?\b/, 10],
  [/\bcovenants?\b/, 10],
  [/\bletters?\s+of\s+credit\b/, 10],
  [/\bavailability\b/, 10],
  [/\bdebt\s+issuance\s+costs\b/, 10],
  [/\bunamortized\s+discount\b/, 10],
  [/\bcurrent\s+portion\s+of\s+long[\s-]*term\s+debt\b/, 15],
  [/\blong[\s-]*term\s+debt\s*,\s*net\b/, 15],
  [/\btotal\s+debt\b/, 15],
];

function scoreDebtBodyTermsSpec(normPlain: string): { score: number; hits: number } {
  let score = 0;
  let hits = 0;
  for (const [pattern, pts] of BODY_DEBT_TERM_SCORES) {
    const re = new RegExp(pattern.source, pattern.flags.includes("i") ? pattern.flags : `${pattern.flags}i`);
    if (re.test(normPlain)) {
      score += pts;
      hits++;
    }
  }
  return { score, hits };
}

const DEBT_TABLE_LINE_LABEL_RES: ReadonlyArray<RegExp> = [
  /\brevolving\s+credit\s+facility\b/i,
  /\bterm\s+loan\b/i,
  /\bbenior\s+secured\s+notes?\b/i,
  /\bbenior\s+unsecured\s+notes?\b/i,
  /\bconvertible\s+notes?\b/i,
  /\bfinance\s+lease\s+obligations\b/i,
  /\btotal\s+debt\b/i,
  /\bless\s*:\s*current\s+portion\b/i,
  /\bless\s*:\s*unamortized\s+debt\s+issuance\s+costs\b/i,
  /\blong[\s-]*term\s+debt\s*,\s*net\b/i,
];

function debtTableLineEvidenceScore(sliceHtml: string): number {
  let pos = 0;
  let bestInOneTable = 0;
  for (let t = 0; t < 60; t++) {
    const tbl = extractNextTable(sliceHtml, pos);
    if (!tbl) break;
    pos = tbl.end;
    const plain = normalizePlainForMatch(stripTagsToPlain(tbl.html));
    let c = 0;
    for (const re of DEBT_TABLE_LINE_LABEL_RES) {
      const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      if (r.test(plain)) c++;
    }
    bestInOneTable = Math.max(bestInOneTable, c);
  }
  if (bestInOneTable >= 2) return 30;
  if (bestInOneTable === 1) return 12;
  return 0;
}

function scoreContextualNegatives(seg: Segment, headingNorm: string, bodyNorm: string): number {
  let n = scoreDebtNegativeHeadingSpecOnly(headingNorm);
  const tableEv = debtTableLineEvidenceScore(seg.sliceHtml);
  const bodyHits = scoreDebtBodyTermsSpec(bodyNorm).hits;

  const leasesOnly =
    /\bleases?\b/.test(headingNorm) &&
    !/\bdebt\b/.test(headingNorm) &&
    !/\bfinance\s+lease\b/.test(headingNorm) &&
    !/\bdebt\s+and\b/.test(headingNorm);
  if (leasesOnly && bodyHits < 2 && tableEv < 30) n += 20;

  const fairHeading =
    /\bfair\s+value\b/.test(headingNorm) &&
    !/\bdebt\b/.test(headingNorm) &&
    !/\bborrowings?\b/.test(headingNorm);
  if (fairHeading && tableEv < 30) n += 20;

  /*
   * Mis-placed bold note headings (duplicate TOC rows, ix/HTML quirks) can open a “Note 13 — Goodwill…” segment
   * whose slice actually begins with another note’s OCI roll-forward (Gray/GTN-style). The multipath scorer then
   * heaps debt/OCI-adjacent hits onto the wrong heading label — label says 13, body is early notes.
   */
  const goodwillIntangibleHeading =
    /\bgoodwill\b/.test(headingNorm) ||
    /\bintangible\s+assets\b/.test(headingNorm) ||
    /\bgoodwill\s+and\s+intangible\b/.test(headingNorm);
  if (goodwillIntangibleHeading && !/\bdebt\b/.test(headingNorm)) {
    const lead = bodyNorm.slice(0, 3_800);
    const early = lead.slice(0, 1_600);
    if (
      /\baccumulated\s+other\s+comprehensive\b/.test(early) &&
      !/\bgoodwill\b/.test(lead.slice(0, 2_000))
    ) {
      n += 135;
    }
  }

  const headLead = bodyNorm.slice(0, 3200);
  if (/\bliquidity\s+and\s+capital\s+resources\b/.test(headingNorm)) n += 100;
  else if (
    /\bliquidity\s+and\s+capital\s+resources\b/.test(headLead) &&
    !/\bnotes?\s+to\s+(?:the\s+)?(?:consolidated\s+)?financial\s+statements\b/.test(headLead.slice(0, 700))
  )
    n += 100;

  if (/\brisk\s+factors\b/.test(headingNorm)) n += 100;
  if (/\bexhibit\s+index\b/.test(headingNorm)) n += 100;
  if (/\bquantitative\s+and\s+qualitative\s+disclosures\s+about\s+market\s+risk\b/.test(headingNorm)) n += 100;
  if (/\bcontrols\s+and\s+procedures\b/.test(headingNorm)) n += 100;

  return n;
}

const DEBT_TABLE_ANCHOR_RES: ReadonlyArray<RegExp> = [
  /\btotal\s+debt\b/gi,
  /\blong[\s-]*term\s+debt\s*,\s*net\b/gi,
  /\blong[\s-]*term\s+debt\b/gi,
  /\bcurrent\s+portion\s+of\s+long[\s-]*term\s+debt\b/gi,
  /\bcurrent\s+maturities\s+of\s+long[\s-]*term\s+debt\b/gi,
  /\bshort[\s-]*term\s+borrowings\b/gi,
  /\bnotes?\s+payable\b/gi,
  /\brevolving\s+credit\s+facility\b/gi,
  /\bterm\s+loan\s+facility\b/gi,
  /\bbenior\s+secured\s+notes?\b/gi,
  /\bbenior\s+unsecured\s+notes?\b/gi,
  /\bbenior\s+notes?\b/gi,
  /\bsecured\s+notes?\b/gi,
  /\bunsecured\s+notes?\b/gi,
  /\bconvertible\s+notes?\b/gi,
  /\bfinance\s+lease\s+obligations\b/gi,
  /\bless\s*:\s*unamortized\s+debt\s+issuance\s+costs\b/gi,
  /\bless\s*:\s*current\s+portion\b/gi,
  /\bless\s*:\s*current\s+maturities\b/gi,
  /\bdebt\s+issuance\s+costs\b/gi,
  /\bunamortized\s+discount\b/gi,
  /\bborrowings\s+outstanding\b/gi,
];

function lastHeadingBefore(headings: HeadingHit[], idx: number): HeadingHit | null {
  let best: HeadingHit | null = null;
  for (const h of headings) {
    if (h.index <= idx && (!best || h.index > best.index)) best = h;
  }
  return best;
}

function firstHeadingStrictlyAfter(headings: HeadingHit[], idx: number): HeadingHit | null {
  let best: HeadingHit | null = null;
  for (const h of headings) {
    if (h.index > idx && (!best || h.index < best.index)) best = h;
  }
  return best;
}

function findNoteSegmentContainingPlainSnippet(
  cleaned: string,
  headings: HeadingHit[],
  notesStart: number,
  regionEnd: number,
  plainSnippet: string,
): Segment | null {
  const probe = normalizePlainForMatch(plainSnippet).slice(0, 200);
  if (probe.length < 28) return null;
  const stub = probe.slice(0, Math.min(80, probe.length));
  const sorted = [...headings].sort((a, b) => a.index - b.index);
  for (const hit of sorted) {
    if (hit.index < notesStart || hit.index >= regionEnd) continue;
    const next = firstHeadingStrictlyAfter(headings, hit.index);
    const seg = buildSegmentAt(cleaned, hit, next, regionEnd);
    const pn = normalizePlainForMatch(stripTagsToPlain(seg.sliceHtml));
    if (pn.includes(stub)) return seg;
  }
  return null;
}

function countIndependentStrongPaths(paths: DebtFootnotePathId[]): number {
  const s = new Set(paths);
  let n = 0;
  if (s.has("note_map")) n++;
  if (s.has("debt_table_anchor")) n++;
  if (s.has("ixbrl_textblock")) n++;
  if (s.has("filing_summary_report")) n++;
  if (s.has("balance_sheet_crosscheck")) n++;
  if (s.has("prior_period_learning")) n++;
  return n;
}

/**
 * Dense numbered lines under debt tables can outscore the real section head (“Note 7-Debt”) on body/table metrics.
 * Nudge sort toward canonical debt note titles ({@link headingNorm} is already lowercased).
 */
function debtCanonicalNoteTitleRankBonus(headingNorm: string): number {
  return /\bnote\s+\d{1,2}[a-z]?[\s\-]{0,4}debt\b/.test(headingNorm) ? 96 : 0;
}

function mergePathsUnique(a: DebtFootnotePathId[], b: DebtFootnotePathId[]): DebtFootnotePathId[] {
  return [...new Set<DebtFootnotePathId>([...a, ...b])];
}

function segmentsSameBounds(a: Segment, b: Segment): boolean {
  return a.start === b.start && a.end === b.end;
}

function pickDominantExtractionMethod(
  a: DebtFootnoteExtractionMethod,
  b: DebtFootnoteExtractionMethod,
): DebtFootnoteExtractionMethod {
  const rank = (m: DebtFootnoteExtractionMethod): number => {
    if (m === "filing_summary_report") return 5;
    if (m === "ixbrl_textblock") return 4;
    if (m === "debt_table_anchor" || m === "table_anchor_fallback") return 3;
    if (m === "xbrl_tag_fallback") return 2;
    return 1;
  };
  return rank(b) > rank(a) ? b : a;
}

function mergeMultipathRows(mapBlocks: ScoredNoteBlock[], extras: ScoredNoteBlock[]): ScoredNoteBlock[] {
  const merged = [...mapBlocks];
  for (const ex of extras) {
    const j = merged.findIndex((m) => segmentsSameBounds(m.segment, ex.segment));
    if (j < 0) {
      merged.push(ex);
      continue;
    }
    const cur = merged[j]!;
    const paths = mergePathsUnique(cur.pathsFired, ex.pathsFired);
    const filingSummaryScore = Math.max(cur.filingSummaryScore, ex.filingSummaryScore);
    const balanceSheetCrosscheckScore = Math.max(cur.balanceSheetCrosscheckScore, ex.balanceSheetCrosscheckScore);
    const priorPeriodScore = Math.max(cur.priorPeriodScore, ex.priorPeriodScore);
    const xbrlBoost = Math.max(cur.xbrlBoost, ex.xbrlBoost);
    const tableEvidenceScore = Math.max(cur.tableEvidenceScore, ex.tableEvidenceScore);
    const extractionMethod = pickDominantExtractionMethod(cur.extractionMethod, ex.extractionMethod);
    const lexAdj = Math.min(cur.segment.maxDebtTableKeywordScore * 0.14, 22);
    const totalDebtScore =
      cur.headingSpecScore +
      cur.bodySpecScore +
      tableEvidenceScore +
      xbrlBoost +
      filingSummaryScore +
      balanceSheetCrosscheckScore +
      priorPeriodScore +
      lexAdj -
      cur.negativeScore;
    merged[j] = {
      ...cur,
      pathsFired: paths,
      filingSummaryScore,
      balanceSheetCrosscheckScore,
      priorPeriodScore,
      xbrlBoost,
      tableEvidenceScore,
      extractionMethod,
      totalDebtScore,
    };
  }
  return merged;
}

function buildDebtSnippet(sliceHtml: string): string {
  return scrubPlainFootnoteNoise(stripTagsToPlain(sliceHtml)).replace(/\s+/g, " ").trim().slice(0, 280);
}

type ScoredNoteBlock = {
  segment: Segment;
  headingNorm: string;
  headingSpecScore: number;
  bodySpecScore: number;
  bodyTermHits: number;
  tableEvidenceScore: number;
  negativeScore: number;
  xbrlBoost: number;
  filingSummaryScore: number;
  balanceSheetCrosscheckScore: number;
  priorPeriodScore: number;
  pathsFired: DebtFootnotePathId[];
  totalDebtScore: number;
  extractionMethod: DebtFootnoteExtractionMethod;
  snippet: string;
};

function scoreSegmentWithMethod(
  seg: Segment,
  method: DebtFootnoteExtractionMethod,
  ixBlocks: IxDebtBlock[],
  opts?: {
    pathsFired?: DebtFootnotePathId[];
    filingSummaryScore?: number;
    balanceSheetCrosscheckScore?: number;
    priorPeriodScore?: number;
    forceIxBoost?: number;
  },
): ScoredNoteBlock {
  const headingNorm = noteTitleNorm(seg);
  const plainBody = stripTagsToPlain(seg.sliceHtml);
  const bodyNorm = normalizePlainForMatch(plainBody);
  const hs = scoreDebtHeadingSpec(headingNorm);
  const { score: bs, hits: bodyTermHits } = scoreDebtBodyTermsSpec(bodyNorm);
  const tbl = debtTableLineEvidenceScore(seg.sliceHtml);
  const neg = scoreContextualNegatives(seg, headingNorm, bodyNorm);
  const ixOverlap = ixOverlapBoostForSegment(bodyNorm, ixBlocks);
  const ix = Math.min(85, Math.max(ixOverlap, opts?.forceIxBoost ?? 0));
  const filingSummaryScore = opts?.filingSummaryScore ?? 0;
  const balanceSheetCrosscheckScore = opts?.balanceSheetCrosscheckScore ?? 0;
  const priorPeriodScore = opts?.priorPeriodScore ?? 0;
  const lexAdj = Math.min(seg.maxDebtTableKeywordScore * 0.14, 22);
  const total =
    hs +
    bs +
    tbl +
    ix +
    filingSummaryScore +
    balanceSheetCrosscheckScore +
    priorPeriodScore +
    lexAdj -
    neg;

  let pathBase: DebtFootnotePathId[] = opts?.pathsFired?.length
    ? [...opts.pathsFired]
    : pathsForMethodOnly(method);
  if ((ixOverlap >= 16 || ix >= 26) && !pathBase.includes("ixbrl_textblock")) pathBase.push("ixbrl_textblock");

  return {
    segment: seg,
    headingNorm,
    headingSpecScore: hs,
    bodySpecScore: bs,
    bodyTermHits,
    tableEvidenceScore: tbl,
    negativeScore: neg,
    xbrlBoost: ix,
    filingSummaryScore,
    balanceSheetCrosscheckScore,
    priorPeriodScore,
    pathsFired: pathBase,
    totalDebtScore: total,
    extractionMethod: normalizeLegacyMethod(method),
    snippet: buildDebtSnippet(seg.sliceHtml),
  };
}

function normalizeLegacyMethod(m: DebtFootnoteExtractionMethod): DebtFootnoteExtractionMethod {
  return m === "table_anchor_fallback" ? "debt_table_anchor" : m;
}

function pathsForMethodOnly(method: DebtFootnoteExtractionMethod): DebtFootnotePathId[] {
  const m = normalizeLegacyMethod(method);
  if (m === "debt_table_anchor") return ["debt_table_anchor"];
  if (m === "filing_summary_report") return ["filing_summary_report"];
  if (m === "ixbrl_textblock") return ["ixbrl_textblock"];
  return ["note_map"];
}

function collectTableAnchorCandidates(
  html: string,
  headings: HeadingHit[],
  notesStart: number,
  regionEnd: number,
  ixBlocks: IxDebtBlock[],
): ScoredNoteBlock[] {
  if (headings.length < 1) return [];
  const slice = html.slice(notesStart, regionEnd);
  const seen = new Set<string>();
  const out: ScoredNoteBlock[] = [];
  for (const re of DEBT_TABLE_ANCHOR_RES) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(slice)) !== null) {
      const abs = notesStart + m.index;
      const prev = lastHeadingBefore(headings, abs);
      const next = firstHeadingStrictlyAfter(headings, abs);
      if (!prev) continue;
      if (next && next.index - prev.index < 140) continue;
      if (!next && regionEnd - prev.index < 140) continue;
      const seg = buildSegmentAt(html, prev, next, regionEnd);
      if (!segmentHasExtractableBody(seg)) continue;
      const key = `${seg.start}:${seg.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        scoreSegmentWithMethod(seg, "debt_table_anchor", ixBlocks, {
          pathsFired: ["debt_table_anchor"],
        }),
      );
    }
  }
  return out;
}

function mergeAnchorUpgradeIntoPrimary(mapBlocks: ScoredNoteBlock[], anchors: ScoredNoteBlock[]): ScoredNoteBlock[] {
  let cur = [...mapBlocks];
  for (const fb of anchors) {
    const i = cur.findIndex((b) => segmentsSameBounds(b.segment, fb.segment));
    if (i >= 0) {
      const row = cur[i]!;
      const mergedPaths = mergePathsUnique(row.pathsFired, fb.pathsFired);
      const upgradeMethod =
        fb.extractionMethod === "debt_table_anchor" &&
        !headingHasHighConfidenceDebtTerm(row.headingNorm) &&
        fb.totalDebtScore >= row.totalDebtScore - 2;
      const extractionMethodPick: DebtFootnoteExtractionMethod = upgradeMethod
        ? "debt_table_anchor"
        : row.extractionMethod;
      const next = {
        ...row,
        pathsFired: mergedPaths,
        extractionMethod: extractionMethodPick,
        tableEvidenceScore: Math.max(row.tableEvidenceScore, fb.tableEvidenceScore),
        xbrlBoost: Math.max(row.xbrlBoost, fb.xbrlBoost),
        filingSummaryScore: Math.max(row.filingSummaryScore, fb.filingSummaryScore),
        balanceSheetCrosscheckScore: Math.max(row.balanceSheetCrosscheckScore, fb.balanceSheetCrosscheckScore),
        priorPeriodScore: Math.max(row.priorPeriodScore, fb.priorPeriodScore),
      };
      cur[i] = { ...next, totalDebtScore: recomputeTotalDebtScore(next) };
      continue;
    }
    cur.push(fb);
  }
  return cur;
}

function recomputeTotalDebtScore(row: ScoredNoteBlock): number {
  const lexAdj = Math.min(row.segment.maxDebtTableKeywordScore * 0.14, 22);
  return (
    row.headingSpecScore +
    row.bodySpecScore +
    row.tableEvidenceScore +
    row.xbrlBoost +
    row.filingSummaryScore +
    row.balanceSheetCrosscheckScore +
    row.priorPeriodScore +
    lexAdj -
    row.negativeScore
  );
}

function detectItemFinancialAnchor(
  html: string,
  formType: "10-K" | "10-Q",
): { found: boolean; kind: DebtFootnoteDiagnosticReport["itemFloorKind"] } {
  const searchStart = partSectionSearchStart(html, formType);
  if (formType === "10-K") {
    if (findFirstNonCitationItem8FinancialIndex(html, searchStart) >= 0) return { found: true, kind: "Item 8" };
    if (findFirstNonCitationItem8FinancialIndex(html, 0) >= 0) return { found: true, kind: "Item 8" };
    const pats = [
      /\bitem\s+8[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements\s+and\s+supplementary\s+data)\b/i,
    ];
    if (earliestRegexMatchIn(html, searchStart, pats) >= 0 || earliestRegexMatchIn(html, 0, pats) >= 0)
      return { found: true, kind: "Item 8" };
    return { found: false, kind: "fallback_start" };
  }
  const item1pats = [
    /\bitem\s+1[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements)\b/i,
    /\bitem\s*(?:&#160;|\u00a0)\s*1[\.\)]?\s*(?:[\u2014\-–—]\s*)?(?:financial\s+statements)\b/i,
  ];
  if (
    earliestRegexMatchIn(html, searchStart, item1pats) >= 0 ||
    earliestRegexMatchIn(html, 0, item1pats) >= 0
  )
    return { found: true, kind: "Item 1" };
  const part1pat = [/\bpart\s+i\b\s*(?:[\u2014\-–—]|:|\.)\s*financial\s+information\b/i];
  if (earliestRegexMatchIn(html, searchStart, part1pat) >= 0) return { found: true, kind: "Part I" };
  return { found: false, kind: "fallback_start" };
}

function classifyDebtFootnoteConfidence(top: ScoredNoteBlock, notesFound: boolean): DebtFootnoteConfidence {
  const hiHead = headingHasHighConfidenceDebtTerm(top.headingNorm);
  const bi = top.segment.bodyIndicators;
  const bodyTerms = top.bodyTermHits;
  const strongTable = top.tableEvidenceScore >= 30 || top.segment.maxDebtTableKeywordScore >= 22;
  const debtIndicators3 = bi >= 3 || bodyTerms >= 3;
  const pathCount = countIndependentStrongPaths(top.pathsFired);

  const toxicHeading =
    /\brisk\s+factors\b/.test(top.headingNorm) ||
    /\bexhibit\s+index\b/.test(top.headingNorm) ||
    /\bquantitative\s+and\s+qualitative\s+disclosures\s+about\s+market\s+risk\b/.test(top.headingNorm);

  if (!notesFound) {
    if (top.totalDebtScore < 28 && bodyTerms < 2 && !strongTable) return "Not Found";
    return "Low";
  }

  if (toxicHeading && pathCount < 2) return "Low";

  if (top.negativeScore >= 95) {
    if (bodyTerms >= 5 || strongTable || bi >= 6) return "Medium";
    return "Low";
  }

  if (
    pathCount >= 2 &&
    (hiHead || strongTable) &&
    debtIndicators3 &&
    top.negativeScore < 70 &&
    notesFound
  ) {
    return "High";
  }

  if (
    bodyTerms >= 5 ||
    bi >= 6 ||
    strongTable ||
    (top.extractionMethod === "debt_table_anchor" && (strongTable || bi >= 5 || bodyTerms >= 4))
  ) {
    if (!hiHead && bi < 4 && !strongTable && bodyTerms < 5 && pathCount < 2) return "Low";
    return "Medium";
  }

  if (bodyTerms >= 2 || bi >= 3 || top.totalDebtScore >= 42) return "Low";
  return "Not Found";
}

function debtAnchorsHitInNotes(html: string, notesStart: number, regionEnd: number): boolean {
  const slice = html.slice(notesStart, regionEnd);
  for (const re of DEBT_TABLE_ANCHOR_RES) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    r.lastIndex = 0;
    if (r.test(slice)) return true;
  }
  return false;
}

function logDebtFootnoteDiagnostics(report: DebtFootnoteDiagnosticReport): void {
  const lines = [
    "[secDebtSectionExtract] Debt footnote extraction diagnostics",
    `1. Filing type: ${report.filingFormUsed}`,
    `2. Filing date: ${report.filingDate ?? "(not provided to extractor)"}`,
    `3. Accession number: ${report.accessionNumber ?? "(not provided to extractor)"}`,
    `4. Item 8 / Item 1 / Part I anchor: ${report.itemFloorFound ? report.itemFloorKind : "not found"}`,
    `5. Notes to Financial Statements header: ${report.notesSectionFound ? `yes @ ${report.notesSectionStartOffset}` : "no"}`,
    `6. Note headings detected: ${report.noteHeadingCount}`,
    `7. Headings: ${report.detectedNoteHeadings.join(" | ")}`,
    `8. Scores: ${report.debtScoresByNoteHeading.map((x) => `${x.heading}=${x.totalScore}`).join("; ")}`,
    `9. Top snippets: ${report.topCandidatesSnippet.map((x) => `[${x.totalScore}] ${x.heading}: ${x.snippet.slice(0, 120)}…`).join(" || ")}`,
    `10. Debt-table anchors in notes: ${report.debtTableAnchorsDetectedInNotes ? "yes" : "no"}`,
    `11. Inline XBRL debt text blocks: ${report.inlineXbrlDebtTextBlocksFound ? "yes" : "no"}`,
    `12. Extraction paths fired: ${(report.extractionPathsFired ?? []).join(", ") || "(none recorded)"}`,
    `13. FilingSummary.xml: ${report.filingSummaryXmlFound === true ? "yes" : report.filingSummaryXmlFound === false ? "no" : "n/a"}`,
    `14. Balance-sheet debt labels: ${report.balanceSheetDebtLabelsFound === true ? "yes" : report.balanceSheetDebtLabelsFound === false ? "no" : "n/a"}`,
    `15. Prior-period pattern: ${report.priorPeriodPatternMatched === true ? "yes" : report.priorPeriodPatternMatched === false ? "no" : "n/a"}`,
    `16. Selection: ${report.primarySelectionReason}`,
    `17. Possible MD&A / non-notes leak: ${report.possibleMdandaOrNonNotesLeak ? "yes" : "no"}`,
  ];
  console.warn(lines.join("\n"));
}

function chooseExtractionMethod(top: ScoredNoteBlock): DebtFootnoteExtractionMethod {
  const m = normalizeLegacyMethod(top.extractionMethod);
  if (m === "debt_table_anchor") return "debt_table_anchor";
  if (m === "filing_summary_report") return "filing_summary_report";
  if (m === "ixbrl_textblock") return "ixbrl_textblock";
  const hi = headingHasHighConfidenceDebtTerm(top.headingNorm);
  if (hi) return "direct_heading_match";
  if (top.tableEvidenceScore >= 30 || top.segment.maxDebtTableKeywordScore >= 24) return "debt_table_keyword_match";
  if (top.xbrlBoost >= 26) return "xbrl_tag_fallback";
  return "body_keyword_fallback";
}

function preferDebtPrimaryWithoutEmbeddedEarlierNotes(
  rows: ScoredNoteBlock[],
  preferred: ScoredNoteBlock,
): { primary: ScoredNoteBlock; hardFailed: boolean } {
  const prefIdx = rows.findIndex(
    (r) => r.segment.start === preferred.segment.start && r.segment.end === preferred.segment.end,
  );
  const rotated = prefIdx >= 0 ? [...rows.slice(prefIdx), ...rows.slice(0, prefIdx)] : rows;
  for (const cand of rotated) {
    const nn = cand.segment.hit.noteNum || "";
    if (!selectedBodyContainsMultipleEarlierTopLevelHeadings(nn, cand.segment.sliceHtml).failed) {
      return { primary: cand, hardFailed: false };
    }
  }
  return { primary: preferred, hardFailed: rows.length > 0 };
}

/**
 * Item 8 / Item 1 scope → Notes header → full note-map scoring → multipath reconciliation
 * (table anchors, iXBRL chains, FilingSummary.xml reports, balance-sheet cross-check, prior patterns)
 * → optional LLM adjudication on top snippets → confidence-tiered output with diagnostics.
 */
export async function extractDebtFootnote(
  html: string,
  opts: ExtractDebtFootnoteOptions,
): Promise<DebtSectionExtractResult> {
  const warnings: string[] = [];
  const cleaned = preprocessSecHtml(html);
  const htmlIx = preprocessSecHtmlKeepIx(html);
  const ixBlocks = collectIxDebtBlocks(htmlIx);
  const ixDebtBlockCount = ixBlocks.length;
  const formType = opts.formType;
  const filingDate = opts.filingDate;
  const accessionNumber = opts.accessionNumber;
  const priorPatterns = opts.priorDebtPatterns ?? [];
  let filingSummaryXmlFound = false;
  let priorPeriodPatternMatched = false;

  const itemAnchor = detectItemFinancialAnchor(cleaned, formType);
  const regionStart = financialStatementsFloor(cleaned, formType);
  let regionEnd = financialStatementsCeiling(cleaned, formType, regionStart);

  const notesHeaderIdx = findNotesSectionHeaderIndex(cleaned, regionStart, regionEnd);
  const notesSectionFound = notesHeaderIdx !== null;
  let notesStart = resolveNotesSectionStart(cleaned, regionStart, regionEnd);

  if (notesStart >= regionEnd) {
    regionEnd = financialStatementsCeilingAfterNotesAnchor(cleaned, formType, notesStart, regionStart);
    warnings.push(
      "Notes appear after an early Item 8 / Item 9 outline (typical inline XBRL / Workiva HTML) — expanded scan through real Notes.",
    );
  }

  const clippedAtItem2 = clipRegionEndAtFirstItem2AfterNotes(cleaned, notesStart, regionEnd, formType);
  if (clippedAtItem2 < regionEnd) {
    regionEnd = clippedAtItem2;
    warnings.push("Notes region clipped before Item 2 (MD&A) — Item 1 financial statements only.");
  }

  const segResult = segmentFootnotesForDebtExtraction(cleaned, {
    formType,
    regionStart,
    regionEnd,
    notesStart,
    notesSectionFound,
    itemFloorFound: itemAnchor.found,
    itemFloorKind: itemAnchor.kind,
  });

  let usedBlockSegmentation = false;
  let headings: HeadingHit[];

  if (segResult.ok && segResult.note_blocks.length >= 2) {
    const hhRaw = headingHitsFromCanonicalNoteBlocks(segResult.note_blocks);
    const hh = hhRaw.filter((h) => {
      const preview = headingTitleLine(h, cleaned);
      return (
        !isExcludedNonDebtHeadingTitle(h.titleRaw, preview) &&
        !isCrossReferenceNoteHeading(cleaned, h.index, h.titleRaw, preview)
      );
    });
    if (hh.length >= 2) {
      headings = hh;
      usedBlockSegmentation = true;
    } else {
      warnings.push("Block-based note segmentation produced too few headings after filters — using legacy scanner.");
      headings = scanNoteHeadings(cleaned, notesStart, regionEnd);
    }
  } else {
    if (segResult.segmentation_failed && segResult.failure_reason) {
      warnings.push(`Note segmentation: ${segResult.failure_reason}`);
    }
    headings = scanNoteHeadings(cleaned, notesStart, regionEnd);
  }

  headings = filterBogusHighNoteHeadingHits(headings);

  const anchorsInNotes = debtAnchorsHitInNotes(cleaned, notesStart, regionEnd);

  const buildFailureDiagnostic = (
    reason: string,
    headingLabels: string[],
    scoredRows: ScoredNoteBlock[],
    footnoteSeg?: DebtFootnoteDiagnosticReport["footnoteSegmentation"],
  ): DebtFootnoteDiagnosticReport => ({
    filingFormUsed: formType,
    filingDate,
    accessionNumber,
    itemFloorFound: itemAnchor.found,
    itemFloorKind: itemAnchor.kind,
    notesSectionFound,
    notesSectionStartOffset: notesSectionFound ? notesStart : null,
    noteHeadingCount: headingLabels.length,
    detectedNoteHeadings: headingLabels,
    debtScoresByNoteHeading: scoredRows.map((r) => ({
      heading: r.segment.headingDisplay,
      noteNumber: r.segment.hit.noteNum || null,
      totalScore: Math.round(r.totalDebtScore),
    })),
    topCandidatesSnippet: scoredRows.slice(0, 5).map((r) => ({
      heading: r.segment.headingDisplay,
      totalScore: Math.round(r.totalDebtScore),
      snippet: r.snippet,
    })),
    debtTableAnchorsDetectedInNotes: anchorsInNotes,
    inlineXbrlDebtTextBlocksFound: ixDebtBlockCount > 0,
    primarySelectionReason: reason,
    possibleMdandaOrNonNotesLeak: false,
    ...(footnoteSeg ? { footnoteSegmentation: footnoteSeg } : {}),
  });

  if (headings.length === 0) {
    let excerpt = stripTagsToPlain(cleaned.slice(notesStart, notesStart + 120_000)).trim();
    let msg =
      "Debt footnote not found — no numbered note headings detected after Notes to Financial Statements.";
    let excerptOut = excerpt.slice(0, 28_000);
    const junkOutline =
      excerptLooksLikeItemOutlineWithoutNotes(excerpt) || excerptLooksLikeTableOfContentsOutline(excerpt);
    if (junkOutline) {
      msg +=
        " This filing's primary HTML lists Item 8–9 near the top without embedded Notes there — Notes usually appear later in inline XBRL.";
      excerptOut = "";
    }
    const diag = buildFailureDiagnostic(msg, [], [], {
      ...segResult.diagnostic,
      usedBlockSegmentation,
    });
    diag.possibleMdandaOrNonNotesLeak = !notesSectionFound && excerpt.length > 4000;
    logDebtFootnoteDiagnostics(diag);
    return emptyResult(msg, notesStart, excerptOut, formType, warnings, diag);
  }

  let segments = buildSegments(cleaned, headings, regionEnd).filter(segmentHasExtractableBody);
  if (segments.length === 0 && headings.length > 0) {
    segments = buildSegments(cleaned, headings, regionEnd);
  }

  if (segments.length === 0) {
    const msg = "Debt footnote not found — note headings found but no extractable segment bodies.";
    const labels = headings.map((h) => headingTitleLine(h, cleaned));
    const diag = buildFailureDiagnostic(msg, labels, [], {
      ...segResult.diagnostic,
      usedBlockSegmentation,
    });
    logDebtFootnoteDiagnostics(diag);
    return emptyResult(msg, notesStart, "", formType, warnings, diag);
  }

  let scoredMap = segments.map((s) => scoreSegmentWithMethod(s, "direct_heading_match", ixBlocks));

  const anchorRows = collectTableAnchorCandidates(cleaned, headings, notesStart, regionEnd, ixBlocks);
  scoredMap = mergeAnchorUpgradeIntoPrimary(scoredMap, anchorRows);

  const bsLabels = extractBalanceSheetDebtLabels(cleaned, regionStart, notesStart);

  if (opts.fetchSecArchiveText && opts.cik?.trim() && opts.accessionNumber?.trim()) {
    try {
      const fsUrl = filingSummaryXmlUrl(opts.cik.trim(), opts.accessionNumber.trim());
      const xml = await opts.fetchSecArchiveText(fsUrl);
      if (xml && (/FilingSummary/i.test(xml) || /<(?:Report|Reports)\b/i.test(xml))) {
        filingSummaryXmlFound = true;
        const reps = filterDebtRelatedFilingSummaryReports(parseFilingSummaryReports(xml));
        const filingRows: ScoredNoteBlock[] = [];
        for (const rep of reps.slice(0, 6)) {
          const fn = rep.htmlFile ?? rep.shortName;
          if (!fn || !/\.(htm|html)$/i.test(fn)) continue;
          const reportUrl = filingSummaryMemberUrl(opts.cik.trim(), opts.accessionNumber.trim(), fn);
          const reportHtml = await opts.fetchSecArchiveText(reportUrl);
          if (!reportHtml || reportHtml.length < 120) continue;
          const prepped = preprocessSecHtml(reportHtml);
          const needlePlain = stripTagsToPlain(prepped).slice(0, 1400);
          const seg = findNoteSegmentContainingPlainSnippet(
            cleaned,
            headings,
            notesStart,
            regionEnd,
            needlePlain,
          );
          if (seg) {
            filingRows.push(
              scoreSegmentWithMethod(seg, "filing_summary_report", ixBlocks, {
                pathsFired: ["filing_summary_report"],
                filingSummaryScore: 46,
              }),
            );
          }
        }
        scoredMap = mergeMultipathRows(scoredMap, filingRows);
      }
    } catch {
      /* auxiliary */
    }
  }

  const ixStandalone: ScoredNoteBlock[] = [];
  for (const block of ixBlocks) {
    let overlapped = false;
    for (const row of scoredMap) {
      const bodyNorm = normalizePlainForMatch(stripTagsToPlain(row.segment.sliceHtml));
      if (ixOverlapBoostForSegment(bodyNorm, [block]) >= 18) {
        overlapped = true;
        break;
      }
    }
    if (!overlapped) {
      const seg = findNoteSegmentContainingPlainSnippet(
        cleaned,
        headings,
        notesStart,
        regionEnd,
        block.plain,
      );
      if (seg) {
        ixStandalone.push(
          scoreSegmentWithMethod(seg, "ixbrl_textblock", ixBlocks, {
            pathsFired: ["ixbrl_textblock"],
            forceIxBoost: 40,
          }),
        );
      }
    }
  }
  scoredMap = mergeMultipathRows(scoredMap, ixStandalone);

  const applyBsAndPrior = (rows: ScoredNoteBlock[]) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const bodyNorm = normalizePlainForMatch(stripTagsToPlain(row.segment.sliceHtml));
      const bsScore = balanceSheetCrosscheckScore(bodyNorm, bsLabels);
      const prScore = priorPeriodPatternScore(
        row.headingNorm,
        row.segment.hit.noteNum || null,
        bodyNorm,
        priorPatterns,
      );
      if (prScore >= 20) priorPeriodPatternMatched = true;
      const paths = [...row.pathsFired];
      if (bsScore >= 12 && !paths.includes("balance_sheet_crosscheck")) paths.push("balance_sheet_crosscheck");
      if (prScore >= 22 && !paths.includes("prior_period_learning")) paths.push("prior_period_learning");
      const nextRow: ScoredNoteBlock = {
        ...row,
        balanceSheetCrosscheckScore: bsScore,
        priorPeriodScore: prScore,
        pathsFired: paths,
      };
      rows[i] = { ...nextRow, totalDebtScore: recomputeTotalDebtScore(nextRow) };
    }
    return rows;
  };

  scoredMap = applyBsAndPrior(scoredMap);

  for (let i = 0; i < scoredMap.length; i++) {
    scoredMap[i] = { ...scoredMap[i]!, totalDebtScore: recomputeTotalDebtScore(scoredMap[i]!) };
  }
  scoredMap.sort((a, b) => {
    const rankB = b.totalDebtScore + debtCanonicalNoteTitleRankBonus(b.headingNorm);
    const rankA = a.totalDebtScore + debtCanonicalNoteTitleRankBonus(a.headingNorm);
    if (rankB !== rankA) return rankB - rankA;
    return b.totalDebtScore - a.totalDebtScore;
  });

  let extractionPathsFired: DebtFootnotePathId[] = [...new Set(scoredMap.flatMap((r) => r.pathsFired))];

  let primary = scoredMap[0]!;

  if (opts.enableLlmAdjudication !== false && opts.llmAdjudicate && scoredMap.length > 0) {
    try {
      const adj = await opts.llmAdjudicate({
        filingFormUsed: formType,
        candidates: scoredMap.slice(0, 5).map((r, i) => ({
          rank: i + 1,
          heading: r.segment.headingDisplay,
          snippet: r.snippet.slice(0, 520),
          pathsFired: r.pathsFired,
          scores: `total=${Math.round(r.totalDebtScore)} heading=${r.headingSpecScore} body=${r.bodySpecScore} table=${r.tableEvidenceScore} xbrl=${r.xbrlBoost} filing_summary=${r.filingSummaryScore} bs_xcheck=${r.balanceSheetCrosscheckScore} prior=${r.priorPeriodScore} neg=${r.negativeScore} paths=${r.pathsFired.join("|")}`,
        })),
      });
      if (adj && adj.confidence === "high" && adj.chosenRank >= 1 && adj.chosenRank <= Math.min(5, scoredMap.length)) {
        primary = scoredMap[adj.chosenRank - 1]!;
        primary = {
          ...primary,
          pathsFired: mergePathsUnique(primary.pathsFired, ["llm_adjudication"]),
        };
        extractionPathsFired = [...new Set<DebtFootnotePathId>([...extractionPathsFired, "llm_adjudication"])];
      }
    } catch {
      /* optional */
    }
  }

  const guardedPrimary = preferDebtPrimaryWithoutEmbeddedEarlierNotes(scoredMap, primary);
  primary = guardedPrimary.primary;
  const segmentationHardFailed = guardedPrimary.hardFailed;
  if (segmentationHardFailed) {
    warnings.push(
      'STEP 11: Selected note body contains multiple earlier top-level note headings — refusing primary debt extraction.',
    );
  }

  const primaryRankIdx = scoredMap.findIndex(
    (r) => r.segment.start === primary.segment.start && r.segment.end === primary.segment.end,
  );
  const runnerUp =
    primaryRankIdx >= 0 && primaryRankIdx + 1 < scoredMap.length ? scoredMap[primaryRankIdx + 1] : undefined;

  const confidence = classifyDebtFootnoteConfidence(primary, notesSectionFound);
  let extractionMethod = chooseExtractionMethod(primary);

  const sliceLeadPlain = stripTagsToPlain(primary.segment.sliceHtml).slice(0, 14_000);
  if (/\bliquidity\s+and\s+capital\s+resources\b/i.test(sliceLeadPlain)) {
    warnings.push(
      "Extracted slice mentions Liquidity and Capital Resources — confirm this is a Notes footnote, not MD&A pasted into scope.",
    );
  }

  const mdandaLeak =
    primary.negativeScore >= 95 ||
    (!notesSectionFound && confidence !== "High") ||
    (/\bliquidity\s+and\s+capital\s+resources\b/i.test(primary.headingNorm) && confidence !== "High");

  const pathSummary = `${countIndependentStrongPaths(primary.pathsFired)} independent strong paths [${primary.pathsFired.join(", ")}]`;

  let primarySelectionReason = "";
  if (confidence === "High") {
    primarySelectionReason = `Accepted: ${pathSummary}; debt indicators=${primary.segment.bodyIndicators}; body-term hits=${primary.bodyTermHits}; score ${Math.round(primary.totalDebtScore)}.`;
  } else if (confidence === "Medium") {
    primarySelectionReason = `Accepted pending review: ${pathSummary}; score ${Math.round(primary.totalDebtScore)}; heading="${primary.segment.headingDisplay}"; method=${primary.extractionMethod}. Runner-up gap=${runnerUp ? Math.round(primary.totalDebtScore - runnerUp.totalDebtScore) : "n/a"}.`;
  } else if (confidence === "Low") {
    primarySelectionReason = `Not treating as verified debt footnote: ${pathSummary}; ambiguous heading or thin corroboration (top score ${Math.round(primary.totalDebtScore)}).`;
  } else {
    primarySelectionReason = `Insufficient multipath evidence (${pathSummary}); top score ${Math.round(primary.totalDebtScore)}.`;
  }

  if (segmentationHardFailed) {
    primarySelectionReason += ` STEP 11: refused primary — embedded multiple earlier top-level note headings in candidate body.`;
  }

  if (confidence === "Medium") warnings.push("Debt footnote extraction requires review.");
  if (confidence === "Low" || confidence === "Not Found")
    warnings.push("No high-confidence debt footnote found.");

  const diagnosticReport: DebtFootnoteDiagnosticReport = {
    filingFormUsed: formType,
    filingDate,
    accessionNumber,
    itemFloorFound: itemAnchor.found,
    itemFloorKind: itemAnchor.kind,
    notesSectionFound,
    notesSectionStartOffset: notesSectionFound ? notesStart : null,
    noteHeadingCount: headings.length,
    detectedNoteHeadings: headings.map((h) => headingTitleLine(h, cleaned)),
    debtScoresByNoteHeading: scoredMap.map((r) => ({
      heading: r.segment.headingDisplay,
      noteNumber: r.segment.hit.noteNum || null,
      totalScore: Math.round(r.totalDebtScore),
    })),
    topCandidatesSnippet: scoredMap.slice(0, 5).map((r) => ({
      heading: r.segment.headingDisplay,
      totalScore: Math.round(r.totalDebtScore),
      snippet: r.snippet,
    })),
    debtTableAnchorsDetectedInNotes: anchorsInNotes,
    inlineXbrlDebtTextBlocksFound: ixDebtBlockCount > 0,
    extractionPathsFired,
    filingSummaryXmlFound,
    balanceSheetDebtLabelsFound: bsLabels.length > 0,
    balanceSheetDebtLabels: bsLabels.slice(0, 32),
    priorPeriodPatternMatched,
    candidateScoreBreakdown: scoredMap.slice(0, 5).map((r) => ({
      heading: r.segment.headingDisplay,
      noteNumber: r.segment.hit.noteNum || null,
      heading_score: r.headingSpecScore,
      body_score: r.bodySpecScore,
      table_score: r.tableEvidenceScore,
      xbrl_score: r.xbrlBoost,
      filing_summary_score: r.filingSummaryScore,
      balance_sheet_crosscheck_score: r.balanceSheetCrosscheckScore,
      prior_period_score: r.priorPeriodScore,
      negative_score: r.negativeScore,
      total_score: Math.round(r.totalDebtScore),
      paths_fired: r.pathsFired,
    })),
    primarySelectionReason,
    possibleMdandaOrNonNotesLeak: mdandaLeak,
    footnoteSegmentation: {
      ...segResult.diagnostic,
      usedBlockSegmentation,
      segmentationHardFailed,
    },
  };

  if (confidence !== "High") logDebtFootnoteDiagnostics(diagnosticReport);

  const reviewRequired = confidence !== "High" || segmentationHardFailed || segResult.segmentation_failed;

  const financialStatementNotes: DetectedFinancialStatementNote[] = segments.map((s) => ({
    noteNumber: s.hit.noteNum || null,
    heading: s.headingDisplay,
  }));

  const rankedCandidates = [...scoredMap].sort((a, b) => b.totalDebtScore - a.totalDebtScore);

  let emitPrimary = confidence === "High" || confidence === "Medium";
  let segmentationReason: string | undefined;
  if (segmentationHardFailed) {
    emitPrimary = false;
    segmentationReason =
      "Selected note body contains multiple earlier top-level note headings. Do not classify debt until segmentation is repaired.";
  } else if (segResult.segmentation_failed && segResult.failure_reason) {
    segmentationReason = segResult.failure_reason;
  }

  let footHtml = "";
  let footPlainFull = "";
  let mergedTables = "";
  const mdTables: string[] = [];
  let tables: string[] = [];

  if (emitPrimary) {
    const sliceForOutput = preprocessFootnoteSlice(primary.segment.sliceHtml);
    if (detectIxDuplication(stripTagsToPlain(sliceForOutput))) {
      warnings.push("Inline XBRL duplication suspected — verify filing HTML.");
      if (extractionMethod === "body_keyword_fallback") extractionMethod = "xbrl_tag_fallback";
    }

    let pos = 0;
    for (let g = 0; g < 120 && tables.length < 80; g++) {
      const t = extractNextTable(sliceForOutput, pos);
      if (!t) break;
      tables.push(t.html);
      const md = htmlTableToMarkdown(t.html);
      if (md) mdTables.push(md);
      pos = t.end;
    }

    mergedTables =
      tables.length > 0
        ? `<div class="sec-debt-tables">${tables.map((t, i) => `<div class="sec-debt-table-wrap" data-idx="${i}">${t}</div>`).join("")}</div>`
        : "";

    let footPlainRaw = stripTagsToPlain(sliceForOutput);
    footPlainRaw = scrubPlainFootnoteNoise(footPlainRaw);
    footPlainFull = footPlainRaw;

    const MAX_FOOTNOTE_HTML = 900_000;
    footHtml = sliceForOutput;
    const tableTagsInSlice = (sliceForOutput.match(/<table\b/gi) ?? []).length;
    if (tableTagsInSlice === 0 && tables.length > 0 && mergedTables) {
      footHtml =
        mergedTables + (footHtml.trim().length > 40 ? `<div class="sec-debt-footnote-rest">${footHtml}</div>` : "");
    }
    if (footHtml.length > MAX_FOOTNOTE_HTML) {
      footHtml =
        footHtml.slice(0, MAX_FOOTNOTE_HTML) +
        `<p class="sec-debt-trunc"><em>… HTML truncated (${sliceForOutput.length} chars total) …</em></p>`;
    }
  }

  const nextAfter = headings.filter((h) => h.index > primary.segment.hit.index).sort((a, b) => a.index - b.index)[0];
  const endHeading = nextAfter
    ? headingTitleLine(nextAfter, cleaned)
    : "(end of notes region / next heading not detected)";

  const candidates: DebtFootnoteCandidate[] = rankedCandidates.map((row, i) => ({
    noteNumber: row.segment.hit.noteNum || null,
    titleRaw: row.segment.hit.titleRaw,
    headingScore: row.segment.headingScore,
    bodyDebtIndicators: row.segment.bodyIndicators,
    debtLexiconHits: row.segment.debtLexiconHits,
    bodyWordCount: row.segment.bodyWordCount,
    debtLexiconDensity: row.segment.debtLexiconDensity,
    combinedScore: row.segment.combinedScore,
    totalDebtScore: Math.round(row.totalDebtScore),
    heading_score: row.headingSpecScore,
    body_score: row.bodySpecScore,
    table_score: row.tableEvidenceScore,
    xbrl_score: row.xbrlBoost,
    filing_summary_score: row.filingSummaryScore,
    balance_sheet_crosscheck_score: row.balanceSheetCrosscheckScore,
    prior_period_score: row.priorPeriodScore,
    negative_score: row.negativeScore,
    extraction_paths_fired: row.pathsFired,
    snippet: row.snippet,
    rank: i + 1,
    selected: row.segment.start === primary.segment.start && row.segment.end === primary.segment.end,
  }));

  const plainFb = emitPrimary ? footPlainFull.slice(0, 48_000) : "";

  const summaryNote = [
    financialStatementNotes.length
      ? `${financialStatementNotes.length} notes indexed in Item ${formType === "10-Q" ? "1" : "8"}. `
      : "",
    `Confidence: ${confidence}. Method: ${extractionMethod.replace(/_/g, " ")}.`,
    emitPrimary
      ? `Total debt relevance score: ${Math.round(primary.totalDebtScore)}; body indicators: ${primary.segment.bodyIndicators}; body-term hits: ${primary.bodyTermHits}.`
      : `Best candidate score: ${Math.round(primary.totalDebtScore)} — primary footnote withheld (see warnings & candidates).`,
    emitPrimary && tables.length ? `Extracted ${tables.length} HTML table(s).` : "",
    emitPrimary && !tables.length ? "No HTML tables in slice." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    anchorLabel: emitPrimary ? primary.segment.headingDisplay : null,
    anchorIndexInFullDoc: emitPrimary ? primary.segment.start : notesStart,
    tablesHtml: mergedTables,
    plainTextFallback: plainFb,
    note: summaryNote,
    filingFormUsed: formType,
    debtNoteTitle: emitPrimary ? primary.segment.headingDisplay : null,
    noteNumber: emitPrimary ? primary.segment.hit.noteNum || null : null,
    confidence,
    extractionMethod,
    extractedFootnoteText: emitPrimary ? footPlainFull.slice(0, 100_000) : "",
    extractedFootnoteHtml: emitPrimary ? footHtml : "",
    debtTablesMarkdown: mdTables,
    startHeading: emitPrimary ? primary.segment.headingDisplay : null,
    endHeading: emitPrimary ? endHeading : null,
    warnings,
    candidates,
    htmlStartOffset: emitPrimary ? primary.segment.start : notesStart,
    htmlEndOffset: emitPrimary ? primary.segment.end : notesStart,
    financialStatementNotes,
    debtKeywordTableScore: primary.segment.maxDebtTableKeywordScore,
    diagnosticReport,
    reviewRequired,
    segmentationFailed: segResult.segmentation_failed || segmentationHardFailed,
    segmentationReason,
  };
}

function emptyResult(
  msg: string,
  idx: number,
  excerpt: string,
  formType: "10-K" | "10-Q",
  warnings: string[],
  diagnosticReport?: DebtFootnoteDiagnosticReport,
): DebtSectionExtractResult {
  return {
    anchorLabel: null,
    anchorIndexInFullDoc: idx,
    tablesHtml: "",
    plainTextFallback: excerpt,
    note: msg,
    filingFormUsed: formType,
    debtNoteTitle: null,
    noteNumber: null,
    confidence: "Not Found",
    extractionMethod: "direct_heading_match",
    extractedFootnoteText: excerpt,
    extractedFootnoteHtml: "",
    debtTablesMarkdown: [],
    startHeading: null,
    endHeading: null,
    warnings: [...warnings, "Debt footnote not found"],
    candidates: [],
    htmlStartOffset: idx,
    htmlEndOffset: idx,
    financialStatementNotes: [],
    diagnosticReport,
    reviewRequired: true,
  };
}

/** Legacy entry — prefer passing known {@link ExtractDebtFootnoteOptions.formType} from filings metadata. */
export async function extractDebtCapitalTables(
  html: string,
  formType?: "10-K" | "10-Q",
  meta?: Pick<
    ExtractDebtFootnoteOptions,
    | "filingDate"
    | "accessionNumber"
    | "cik"
    | "ticker"
    | "fetchSecArchiveText"
    | "priorDebtPatterns"
    | "enableLlmAdjudication"
    | "llmAdjudicate"
  >,
): Promise<DebtSectionExtractResult> {
  const ft = formType ?? inferFormFromDoc(html);
  return extractDebtFootnote(html, { formType: ft, ...meta });
}
