/**
 * Pure boundary + segment-note scoring for Inline XBRL MD&A / segment table extraction.
 * Operates on flattened visible text (`acc`) aligned with DOM table offset indexing.
 */

export type MdnaBounds = {
  start: number;
  end: number;
  startMatchLabel: string;
  endMatchLabel: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

export type SegmentNotePick = {
  start: number;
  end: number;
  headingText: string;
  score: number;
  headingScore: number;
  bodyScore: number;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

export type NotesSectionBounds = { start: number; end: number; notesHeadingFound: boolean };

/** Annual MD&A is long; quarterly Item 2 is often much shorter — do not require 4k chars for 10-Q. */
const MIN_MDNA_SPAN_CHARS_10K = 4000;
const MIN_MDNA_SPAN_CHARS_10Q = 1500;
/** Last-resort 10-Q pass when numbered headings / spans are unusually tight */
const MIN_MDNA_SPAN_CHARS_10Q_LOOSE = 600;
/** Ignore very early matches (TOC / cover) unless span proves otherwise */
const MIN_MDNA_BODY_OFFSET_10K = 12_000;
const MIN_MDNA_BODY_OFFSET_10Q = 5000;
const MIN_MDNA_BODY_OFFSET_10Q_LOOSE = 3200;
/** 10-Q: first "Item 1 Financial Statements" often matches the TOC; prefer a later body hit. */
const MIN_ITEM1_FS_ANCHOR_OFFSET_10Q = 4500;
/** Minimum offset before trusting a global “Notes to…” hit for 10-Q (skip TOC). */
const MIN_GLOBAL_NOTES_HEADING_OFFSET_10Q = 1800;

const SEGMENT_NOTE_MIN_SCORE_HIGH = 55;
const SEGMENT_NOTE_MIN_SCORE_MEDIUM = 32;

function isItem8FinancialStatementsCrossReference(acc: string, item8MatchStart: number): boolean {
  const w = acc.slice(item8MatchStart, item8MatchStart + 200);
  const m = w.match(/\bITEM\s+8\s*[\.\u2014\u2013\-]\s*Financial\s+Statements\s+and\s+Supplementary\s+Data/i);
  if (!m) return false;
  const rel = w.slice((m.index ?? 0) + m[0].length);
  const t = rel.trimStart();
  if (/^[,;]/.test(t)) return true;
  if (/^["\u201c\u201d]/.test(t)) return true;
  if (/^\.\s*[\u201c\u201d\u2018\u2019"]+\s*[A-Za-z]/.test(t)) return true;
  if (/^\.\s+[a-z]/.test(t)) return true;
  return false;
}

/** 10-K MD&A end: Item 7A or Item 8 (financial statements item), earliest after start */
export function findMdnaEnd10K(acc: string, start: number): { index: number; label: string } {
  const tail = acc.slice(start + 1);
  const candidates: { idx: number; label: string }[] = [];

  /** Same punctuation rule as 10-Q Item 3: exclude ASCII `-` so inline cites (`Item 7A - Quantitative`) do not end MD&A early. */
  const r7a = /\bITEM\s+7\s*A\s*[\.\u2014\u2013]\s*QUANTITATIVE\b/i.exec(tail);
  if (r7a) candidates.push({ idx: start + 1 + r7a.index, label: "Item 7A" });

  /** “ITEM 7A.” without a space before A (common on EDGAR) */
  const r7aCompact = /\bITEM\s+7A\s*[\.\u2014\u2013]\s*QUANTITATIVE\b/i.exec(tail);
  if (r7aCompact) candidates.push({ idx: start + 1 + r7aCompact.index, label: "Item 7A" });

  /** Risk-only caption still ends MD&A when punctuation is statutory-style */
  const r7aMarket = /\bITEM\s+7\s*A\s*[\.\u2014\u2013]\s*MARKET\s+RISK\b/i.exec(tail);
  if (r7aMarket) candidates.push({ idx: start + 1 + r7aMarket.index, label: "Item 7A (market risk)" });

  const strong8 = /\bITEM\s+8\s*[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi;
  let sm: RegExpExecArray | null;
  while ((sm = strong8.exec(tail)) !== null) {
    const abs = start + 1 + sm.index;
    if (!isItem8FinancialStatementsCrossReference(acc, abs)) {
      candidates.push({ idx: abs, label: "Item 8" });
      break;
    }
  }

  if (candidates.length === 0) {
    const weak8 = /\bITEM\s+8\s*[\.\u2014\-]\s*Financial\s+Statements\b/gi;
    const wm = weak8.exec(tail);
    if (wm) {
      const abs = start + 1 + wm.index;
      if (!isItem8FinancialStatementsCrossReference(acc, abs)) {
        candidates.push({ idx: abs, label: "Item 8 (weak)" });
      }
    }
  }

  const best = candidates.length ? candidates.reduce((a, b) => (a.idx <= b.idx ? a : b)) : null;
  if (best) return { index: best.idx, label: best.label };

  /** Legacy / noisy flattening: no 7A/8 heading matched — cap at FS Item 8 anchor when present (avoids whole-document “MD&A”) */
  const fsCap = findFinancialStatementsAnchor(acc, "10-K");
  if (fsCap != null && fsCap > start + MIN_MDNA_SPAN_CHARS_10K) {
    return { index: fsCap, label: "Item 8 (FS anchor cap)" };
  }
  return { index: acc.length, label: "(eof)" };
}

/**
 * 10‑Q MD&A end: prefer a **too-long** slice over a falsely **short** one.
 *
 * Only **high-confidence headings** terminate the slice: statutory-style Item 3 (+ “Quantitative…”), Item 4 (controls /
 * mine safety), and Part II “Item 1 Legal proceedings.” Prose hyphen cites stay excluded (`ITEM 3 - Quantitative…`, HSY).
 *
 * We intentionally **do not** use weak `\bPART II\b`, fragments of Item 3, or **Signatures**: those routinely appear in
 * forward-looking / incorporation clauses and clipped real MD&A.
 *
 * If nothing matches strongly, callers get `{ index: acc.length, label: "(eof)" }` so downstream consumers keep more text.
 */
export function findMdnaEnd10Q(acc: string, start: number): { index: number; label: string } {
  const tail = acc.slice(start + 1);
  const candidates: { idx: number; label: string }[] = [];

  const pushStrong = (tailIdx: number, label: string) => {
    candidates.push({ idx: start + 1 + tailIdx, label });
  };

  /** Demand `.` / unicode dashes — not ASCII hyphen, which appears in prose cites (`Item 3 - Quantitative…`, HSY). */
  const r3re = /\bITEM\s+3\s*[\.\u2014\u2013]\s*QUANTITATIVE\b/gi;
  let r3m: RegExpExecArray | null;
  while ((r3m = r3re.exec(tail)) !== null) {
    pushStrong(r3m.index, "Item 3");
    break;
  }

  const r4 = /\bITEM\s+4\s*[\.\u2014\u2013\-]\s*(?:CONTROLS|MINE\s+SAFETY)/i.exec(tail);
  if (r4) pushStrong(r4.index, "Item 4");

  const r1lp = /\bITEM\s+1\s*[\.\u2014\u2013\-]\s*LEGAL\s+PROCEEDINGS\b/i.exec(tail);
  if (r1lp) pushStrong(r1lp.index, "Item 1 Legal");

  const best = candidates.length ? candidates.reduce((a, b) => (a.idx <= b.idx ? a : b)) : null;
  return best ? { index: best.idx, label: best.label } : { index: acc.length, label: "(eof)" };
}

/**
 * SEC HTML often uses a curly apostrophe (U+2019) in “Management’s”; ASCII `'` alone misses many real headings
 * (e.g. Tesla 2018 Q1 10-Q) so MD&A boundaries were never found and `mdnaSectionHtml` stayed empty.
 */
const MGMT_POSS_S = "MANAGEMENT(?:'|\u2019)?S";
const MGMT_POSS_S_TITLE = "Management(?:'|\u2019)?s";

const MDNA_START_PATTERNS_10K: RegExp[] = [
  new RegExp(
    `\\bITEM\\s+7\\s*[\\.\\u2014\\u2013\\-]\\s*${MGMT_POSS_S}\\s+DISCUSSION\\s+AND\\s+ANALYSIS\\s+OF\\s+FINANCIAL\\s+CONDITION\\s+AND\\s+RESULTS\\s+OF\\s+OPERATIONS\\b`,
    "gi"
  ),
  new RegExp(
    `\\bITEM\\s+7\\s*[\\.\\u2014\\u2013\\-]\\s*${MGMT_POSS_S_TITLE}\\s+Discussion\\s+and\\s+Analysis\\s+of\\s+Financial\\s+Condition\\s+and\\s+Results\\s+of\\s+Operations\\b`,
    "gi"
  ),
  new RegExp(
    `\\bITEM\\s+7\\s*[\\.\\u2014\\u2013\\-]?\\s*${MGMT_POSS_S}\\s+DISCUSSION\\s+AND\\s+ANALYSIS\\b`,
    "gi"
  ),
];

const MDNA_START_PATTERNS_10Q: RegExp[] = [
  new RegExp(
    `\\bITEM\\s+2\\s*[\\.\\u2014\\u2013\\-]\\s*${MGMT_POSS_S}\\s+DISCUSSION\\s+AND\\s+ANALYSIS\\s+OF\\s+FINANCIAL\\s+CONDITION\\s+AND\\s+RESULTS\\s+OF\\s+OPERATIONS\\b`,
    "gi"
  ),
  new RegExp(`\\bITEM\\s+2\\s*[\\.\\u2014\\u2013\\-]\\s*${MGMT_POSS_S_TITLE}\\s+Discussion\\s+and\\s+Analysis\\b`, "gi"),
  new RegExp(
    `\\bITEM\\s+2\\s*[\\.\\u2014\\u2013\\-]?\\s*${MGMT_POSS_S}\\s+DISCUSSION\\s+AND\\s+ANALYSIS\\b`,
    "gi"
  ),
  /\bITEM\s+2\s*[\.\u2014\u2013\-]\s*MD&A\b/gi,
  new RegExp(`\\bPART\\s+I\\s+ITEM\\s+2\\s*[\\.\\u2014\\u2013\\-]\\s*${MGMT_POSS_S}\\s+DISCUSSION\\b`, "gi"),
];

function isProseItemReference(acc: string, index: number, itemN: string): boolean {
  const lead = acc.slice(index, index + 40).toLowerCase();
  return new RegExp(`^item\\s+${itemN}\\s+of\\b`, "i").test(lead);
}

/** Skip the statutory MD&A title — it always contains “results of operations”, etc., and breaks TOC vs body heuristics */
const MDNA_HEADING_LEAD_SKIP_CHARS = 220;

function isMdnaItemInlineCrossReferenceLine(acc: string, start: number, itemN: string): boolean {
  const lead = acc.slice(start, start + 120).trimStart();
  return new RegExp(`^ITEM\\s+${itemN}\\s*[\\.\\u2014\\u2013\\-]\\s*under\\b`, "i").test(lead);
}

/**
 * Inline cites like BLCO FY2025 10-K: `Item 7. "… MD&A title — … Subsection" of this Form 10-K` —
 * not the real section heading (`Item 7. Management's Discussion…`). Both share the same Item 7A end anchor,
 * so longest-span selection otherwise prefers the early cite.
 */
function isMdnaItemQuotedInlineCitation(acc: string, start: number, itemN: string): boolean {
  const w = acc.slice(start, start + 220).replace(/\s+/g, " ");
  return new RegExp(`\\bITEM\\s+${itemN}\\s*[\\.\\u2014\\u2013\\-]\\s*["\u201c]`, "i").test(w);
}

/**
 * Item 1A / risk prose often repeats the statutory MD&A clause then flows into “…Operations **and Note** N…”
 * Same `OPERATIONS` word boundary our title regex matches, but longest-span wrongly prefers this over real Item 7 (SBGI FY2024 10‑K).
 */
function isMdnaStatutoryTitleFlowingIntoNoteCitation(acc: string, start: number): boolean {
  const head = acc.slice(start, start + 400).replace(/\s+/g, " ");
  return /\bRESULTS\s+OF\s+OPERATIONS\s+AND\s+NOTE\b/i.test(head);
}

/**
 * “… see "Item 7 – …" …” inside another Item — a citation to MD&A text, not the section heading
 * (e.g. LUMN/CenturyTel 2006 10-K Item 7A market-risk prose).
 */
function isQuotedSeeItemHeadingRef(acc: string, start: number): boolean {
  const back = acc.slice(Math.max(0, start - 88), start).replace(/\s+/g, " ");
  return /(?:\bsee|\brefer to)\s+["\u201c\u2018]\s*$/i.test(back) || /\(\s*see\s+["\u201c\u2018]\s*$/i.test(back);
}

/**
 * Statutory MD&A title match that falls inside an unclosed `see "…` cross-reference string (same CenturyTel pattern).
 */
function isStatutoryTitleAfterOpenQuoteSee(acc: string, start: number): boolean {
  const winStart = Math.max(0, start - 700);
  const collapsed = acc.slice(winStart, start).replace(/\s+/g, " ");
  const ms = [...collapsed.matchAll(/\b(?:see|refer to)\s+(["\u201c\u2018])/gi)];
  if (ms.length === 0) return false;
  const last = ms[ms.length - 1]!;
  const idx = last.index ?? 0;
  const openCh = last[1]!;
  const openEnd = idx + last[0].length;
  const tail = collapsed.slice(openEnd);
  const closeCh = openCh === "\u201c" ? "\u201d" : openCh === "\u2018" ? "\u2019" : '"';
  return tail.indexOf(closeCh) < 0;
}

/**
 * Forward‑looking boilerplate cites the statutory MD&A title in quotes: Item 2, "Management's Discussion… Operations"
 * then `" in this Quarterly Report…` Same phrase as real MD&A heading but inside a citation, not Item 2 body (Alphabet /
 * GOOG 2026‑Q1 10‑Q). The statutory‑title‑only matcher must skip this or longest‑span wrongly starts MD&A thousands of
 * characters early.
 */
function isStatutoryMdnaQuotedClosingInForwardLookingReport(acc: string, start: number): boolean {
  const w = acc.slice(start, start + 260).replace(/\s+/g, " ");
  return /\bOPERATIONS\b["\u201d]\s+in\s+this\s+(?:Quarterly|Annual)\s+Report\b/i.test(w);
}

/**
 * E.W. Scripps (SSP) and some shells: Item 7 is only an incorporation-by-reference pointer, and the real
 * MD&A narrative begins later under the statutory title **without** repeating "Item 7." Treat those pointers
 * (and financial-statement index lines) like TOC noise — otherwise we never find a long Item 7 span.
 */
function isMdnaIncorporationOrFsIndexStub(acc: string, start: number): boolean {
  const w = acc.slice(start, start + 820).replace(/\s+/g, " ");
  if (/required by this item is filed as part of/i.test(w)) return true;
  if (/required by this item are filed as part of/i.test(w)) return true;
  if (/\bsee index to consolidated financial statement/i.test(w)) return true;
  if (/\b(?:RESULTS\s+OF\s+)?OPERATIONS\s+F-\s*\d/i.test(w)) return true;
  return false;
}

/**
 * Item 7/2 heading line that only **points** to MD&A content “included elsewhere” (subsections, exhibit shells)
 * before any narrative — otherwise longest-span selection prefers these over the real “The following discussion…” body.
 */
function isMdnaElsewherePointerWithoutNarrative(acc: string, start: number): boolean {
  const w = acc.slice(start, start + 700).replace(/\s+/g, " ");
  if (!/\bincluded elsewhere\b/i.test(w)) return false;
  const idxElse = w.search(/\bincluded elsewhere\b/i);
  /**
   * Real MD&A sometimes mentions “included elsewhere” deep in the intro (e.g. cross-refs). The shell pattern we
   * target is a **short** Item 7 line that only points to content elsewhere (AMC 2013-style) — “included elsewhere”
   * appears in the heading/lede, not hundreds of characters into narrative.
   */
  if (idxElse > 350) return false;
  const idxNarr = w.search(/\bThe following discussion\b/i);
  if (idxNarr >= 0 && idxNarr < idxElse) return false;
  return true;
}

const MDNA_STATUTORY_TITLE_INLINE_RE = new RegExp(
  `\\b${MGMT_POSS_S}\\s+DISCUSSION\\s+AND\\s+ANALYSIS\\s+OF\\s+FINANCIAL\\s+CONDITION\\s+AND\\s+RESULTS\\s+OF\\s+OPERATIONS\\b`,
  "gi"
);

/** TOC-ish: Item line + page number soon after, little substance */
function looksLikeTocMdnaRow(acc: string, start: number, is10K: boolean): boolean {
  const head = acc.slice(start, start + 520);

  /**
   * iXBRL flattening often produces: "Item 7 … Operations 39 Item 7A …" — two **different** items close together (CHTR / Workiva).
   * Two mentions of the **same** item number (e.g. intro + repeated "Item 7") are often real headings, not a two-item TOC strip.
   */
  const itemTok = [...head.matchAll(/\bITEM\s+(\d+[A-Z]?)\b/gi)];
  if (itemTok.length >= 2) {
    const idx2 = itemTok[1]!.index ?? 9999;
    if (idx2 < 430) {
      const a = (itemTok[0]![1] ?? "").toUpperCase();
      const b = (itemTok[1]![1] ?? "").toUpperCase();
      if (a !== b) {
        /** 10-Q MD&A often cites Part I, Item 1 FS in the opening graf — not a two-item TOC strip (CHTR-style). */
        const isPart1Item1CiteAfterItem2 =
          a === "2" && b === "1" && /\bpart\s+i\b/i.test(head.slice(0, idx2));
        /**
         * Alphabet / GOOG‑style opener: cites consolidated FS “under ITEM 1 of this Quarterly Report” in the same
         * flattened window as ITEM 2’s statutory title — not a TOC row (TOC uses page integers / Item 3 next).
         */
        const isItem1ThisReportBridgeAfterItem2 =
          !is10K &&
          a === "2" &&
          b === "1" &&
          /\bITEM\s+1\b[^\n]{0,220}?\bof\s+this\s+(Quarterly\s+Report|Quarterly\s+Report\s+on\s+Form\s+10\s*[\u2011-]?\s*Q)/i.test(
            head.slice(idx2),
          );
        /** Same pattern on 10‑K Item 7 — “…included under ITEM 1 of this Annual Report on Form 10‑K” (GOOG FY2025). */
        const isItem1AnnualReportBridgeAfterItem7 =
          is10K &&
          a === "7" &&
          b === "1" &&
          /\bITEM\s+1\b[^\n]{0,220}?\bof\s+this\s+(Annual\s+Report|Annual\s+Report\s+on\s+Form\s+10\s*[\u2011-]?\s*K)/i.test(
            head.slice(idx2),
          );
        if (!isPart1Item1CiteAfterItem2 && !isItem1ThisReportBridgeAfterItem2 && !isItem1AnnualReportBridgeAfterItem7)
          return true;
      }
    }
  }
  if (is10K && /\b(?:RESULTS\s+OF\s+)?OPERATIONS\s+\d{1,3}\s+ITEM\s+7A\b/i.test(head)) return true;
  if (!is10K && /\b(?:RESULTS\s+OF\s+)?OPERATIONS\s+\d{1,3}\s+ITEM\s+3\b/i.test(head)) return true;

  /**
   * GE-style TOC: title ends with “(MD&A)” then a section number and next heading (“(MD&A) 4 Consolidated…”);
   * narrative body uses a period before prose (“(MD&A). Our consolidated…”).
   */
  if (!is10K && /\(MD&A\)\s+\d{1,3}\s+[A-Z]/i.test(head)) return true;

  const pageHit = head.search(/\bpage\s*\d{1,3}\b/i);
  if (pageHit <= 0 || pageHit > 360) return false;
  const before = head.slice(0, pageHit);
  const hasSubstance =
    /\b(results\s+of\s+operations|liquidity|capital\s+resources|critical\s+accounting|covid|macroeconomic|overview)\b/i.test(
      before
    );
  return !hasSubstance && before.replace(/\s+/g, " ").trim().length < 200;
}

const MDNA_STRICT_NARRATIVE_CUE_RE =
  /\b(results\s+of\s+operations|liquidity|capital\s+resources|critical\s+accounting|covid|macroeconomic|non-gaap|adjusted\s+ebitda|segment|overview)\b/i;

/** Offsets past long titles / cover lines — strict MD&A keywords often appear slightly later */
const MDNA_DEEP_CUE_EXTRA_SKIPS = [520, 900, 1400, 2200] as const;

function hasMdnaNarrativeCue(acc: string, start: number): boolean {
  const sample = acc.slice(start + MDNA_HEADING_LEAD_SKIP_CHARS, start + MDNA_HEADING_LEAD_SKIP_CHARS + 2800);
  return MDNA_STRICT_NARRATIVE_CUE_RE.test(sample);
}

function hasMdnaNarrativeCueDeep(acc: string, start: number): boolean {
  for (const extra of MDNA_DEEP_CUE_EXTRA_SKIPS) {
    const from = start + MDNA_HEADING_LEAD_SKIP_CHARS + extra;
    const sample = acc.slice(from, from + 2800);
    if (MDNA_STRICT_NARRATIVE_CUE_RE.test(sample)) return true;
  }
  return false;
}

/** Broader cues for stubborn 10-Q layouts / thinner prose */
function hasLooseMdnaNarrativeCue(acc: string, start: number): boolean {
  const sample = acc.slice(start + MDNA_HEADING_LEAD_SKIP_CHARS, start + MDNA_HEADING_LEAD_SKIP_CHARS + 3200);
  return (
    hasMdnaNarrativeCue(acc, start) ||
    /\b(revenue|sales|expenses|margin|earnings|guidance|outlook|performance|financial\s+results|operating\s+results|business\s+overview|interim|quarterly\s+results|cash\s+flows?|covid|consolidated\s+financial\s+statements)\b/i.test(
      sample
    )
  );
}

export function findMdnaBounds(acc: string, form: string): MdnaBounds | null {
  const is10K = form.includes("10-K");
  const patterns = is10K ? MDNA_START_PATTERNS_10K : MDNA_START_PATTERNS_10Q;
  const minOffset = is10K ? MIN_MDNA_BODY_OFFSET_10K : MIN_MDNA_BODY_OFFSET_10Q;
  const itemN = is10K ? "7" : "2";
  const minSpan = is10K ? MIN_MDNA_SPAN_CHARS_10K : MIN_MDNA_SPAN_CHARS_10Q;

  const candidates: { start: number; label: string; span: number }[] = [];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(acc)) !== null) {
      const start = m.index;
      if (isProseItemReference(acc, start, itemN)) continue;
      if (isMdnaItemInlineCrossReferenceLine(acc, start, itemN)) continue;
      if (isMdnaItemQuotedInlineCitation(acc, start, itemN)) continue;
      if (isMdnaStatutoryTitleFlowingIntoNoteCitation(acc, start)) continue;
      if (isQuotedSeeItemHeadingRef(acc, start)) continue;
      if (looksLikeTocMdnaRow(acc, start, is10K)) continue;
      if (isMdnaIncorporationOrFsIndexStub(acc, start)) continue;
      if (isMdnaElsewherePointerWithoutNarrative(acc, start)) continue;
      if (start < minOffset && !hasMdnaNarrativeCue(acc, start)) continue;

      const endInfo = is10K ? findMdnaEnd10K(acc, start) : findMdnaEnd10Q(acc, start);
      const span = endInfo.index - start;
      if (span < minSpan) continue;
      candidates.push({ start, label: m[0].slice(0, 80).replace(/\s+/g, " "), span });
    }
  }

  // Fallback: ITEM N without full title (stricter span + cue)
  if (candidates.length === 0) {
    const loose = new RegExp(`\\bITEM\\s+${itemN}\\s*[\\.\u2014\u2013\\-]`, "gi");
    let lm: RegExpExecArray | null;
    while ((lm = loose.exec(acc)) !== null) {
      const start = lm.index;
      if (isProseItemReference(acc, start, itemN)) continue;
      if (isMdnaItemInlineCrossReferenceLine(acc, start, itemN)) continue;
      if (isMdnaItemQuotedInlineCitation(acc, start, itemN)) continue;
      if (isMdnaStatutoryTitleFlowingIntoNoteCitation(acc, start)) continue;
      if (isQuotedSeeItemHeadingRef(acc, start)) continue;
      if (looksLikeTocMdnaRow(acc, start, is10K)) continue;
      if (isMdnaIncorporationOrFsIndexStub(acc, start)) continue;
      if (isMdnaElsewherePointerWithoutNarrative(acc, start)) continue;
      if (start < minOffset && !hasMdnaNarrativeCue(acc, start)) continue;
      const head = acc.slice(start, start + 220);
      if (!/discussion|analysis|financial\s+condition|results\s+of\s+operations|md\s*&\s*a|mda\b/i.test(head)) continue;

      const endInfo = is10K ? findMdnaEnd10K(acc, start) : findMdnaEnd10Q(acc, start);
      const span = endInfo.index - start;
      if (span < minSpan) continue;
      candidates.push({ start, label: `ITEM ${itemN} (fallback)`, span });
    }
  }

  /** Extra-loose 10-Q pass: shorter spans + earlier body + broader prose cues */
  if (candidates.length === 0 && !is10K) {
    const minSpanLoose = MIN_MDNA_SPAN_CHARS_10Q_LOOSE;
    const minOffLoose = MIN_MDNA_BODY_OFFSET_10Q_LOOSE;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(acc)) !== null) {
        const start = m.index;
        if (isProseItemReference(acc, start, itemN)) continue;
        if (isMdnaItemInlineCrossReferenceLine(acc, start, itemN)) continue;
        if (isMdnaItemQuotedInlineCitation(acc, start, itemN)) continue;
        if (isMdnaStatutoryTitleFlowingIntoNoteCitation(acc, start)) continue;
        if (isQuotedSeeItemHeadingRef(acc, start)) continue;
        if (looksLikeTocMdnaRow(acc, start, is10K)) continue;
        if (isMdnaIncorporationOrFsIndexStub(acc, start)) continue;
      if (isMdnaElsewherePointerWithoutNarrative(acc, start)) continue;
        if (start < minOffLoose && !hasLooseMdnaNarrativeCue(acc, start)) continue;

        const endInfo = findMdnaEnd10Q(acc, start);
        const span = endInfo.index - start;
        if (span < minSpanLoose) continue;
        candidates.push({ start, label: `${m[0].slice(0, 72).replace(/\s+/g, " ")} (10-Q loose)`, span });
      }
    }
    const looseItem = new RegExp(`\\bITEM\\s+${itemN}\\s*[\\.\u2014\u2013\\-]`, "gi");
    let lm: RegExpExecArray | null;
    while ((lm = looseItem.exec(acc)) !== null) {
      const start = lm.index;
      if (isProseItemReference(acc, start, itemN)) continue;
      if (isMdnaItemInlineCrossReferenceLine(acc, start, itemN)) continue;
      if (isMdnaItemQuotedInlineCitation(acc, start, itemN)) continue;
      if (isMdnaStatutoryTitleFlowingIntoNoteCitation(acc, start)) continue;
      if (isQuotedSeeItemHeadingRef(acc, start)) continue;
      if (looksLikeTocMdnaRow(acc, start, is10K)) continue;
      if (isMdnaIncorporationOrFsIndexStub(acc, start)) continue;
      if (isMdnaElsewherePointerWithoutNarrative(acc, start)) continue;
      if (start < minOffLoose && !hasLooseMdnaNarrativeCue(acc, start)) continue;
      const head = acc.slice(start, start + 280);
      if (!/discussion|analysis|financial|operations|results|condition|md\s*&\s*a/i.test(head)) continue;

      const endInfo = findMdnaEnd10Q(acc, start);
      const span = endInfo.index - start;
      if (span < minSpanLoose) continue;
      candidates.push({ start, label: `ITEM ${itemN} (10-Q loose)`, span });
    }
  }

  /** Some 10-Q renderings flatten to a bare “ITEM 2.” line without the long statutory title */
  if (candidates.length === 0 && !is10K) {
    const bare = /\bITEM\s+2\s*[\.\u2014\u2013\-]/gi;
    let bm: RegExpExecArray | null;
    while ((bm = bare.exec(acc)) !== null) {
      const start = bm.index;
      if (isProseItemReference(acc, start, "2")) continue;
      if (isMdnaItemInlineCrossReferenceLine(acc, start, "2")) continue;
      if (isMdnaItemQuotedInlineCitation(acc, start, "2")) continue;
      if (isMdnaStatutoryTitleFlowingIntoNoteCitation(acc, start)) continue;
      if (isQuotedSeeItemHeadingRef(acc, start)) continue;
      if (looksLikeTocMdnaRow(acc, start, is10K)) continue;
      if (isMdnaIncorporationOrFsIndexStub(acc, start)) continue;
      if (isMdnaElsewherePointerWithoutNarrative(acc, start)) continue;
      if (start < 1400 && !hasLooseMdnaNarrativeCue(acc, start)) continue;
      const head = acc.slice(start, start + 420);
      if (!/(discussion|analysis|financial|operations|results|condition|management|md\s*&|overview|liquidity)/i.test(head))
        continue;

      const endInfo = findMdnaEnd10Q(acc, start);
      const span = endInfo.index - start;
      if (span < MIN_MDNA_SPAN_CHARS_10Q_LOOSE) continue;
      candidates.push({ start, label: "ITEM 2 (10-Q bare heading)", span });
    }
  }

  /**
   * Incorporation-by-reference shells (e.g. SSP): Item 7/2 is only a pointer; narrative starts at the long
   * statutory title again with **no** leading `Item N.` (offset far into the document — avoid Item 1 Business hits).
   */
  if (candidates.length === 0) {
    const titleOnlyMin = is10K ? Math.max(minOffset, Math.floor(acc.length * 0.18)) : minOffset;
    MDNA_STATUTORY_TITLE_INLINE_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = MDNA_STATUTORY_TITLE_INLINE_RE.exec(acc)) !== null) {
      const start = tm.index;
      if (start < titleOnlyMin) continue;
      if (isProseItemReference(acc, start, itemN)) continue;
      if (isMdnaItemInlineCrossReferenceLine(acc, start, itemN)) continue;
      if (isMdnaStatutoryTitleFlowingIntoNoteCitation(acc, start)) continue;
      if (looksLikeTocMdnaRow(acc, start, is10K)) continue;
      if (isMdnaIncorporationOrFsIndexStub(acc, start)) continue;
      if (isMdnaElsewherePointerWithoutNarrative(acc, start)) continue;
      if (!hasMdnaNarrativeCue(acc, start) && !hasMdnaNarrativeCueDeep(acc, start) && !hasLooseMdnaNarrativeCue(acc, start))
        continue;
      if (isStatutoryTitleAfterOpenQuoteSee(acc, start)) continue;
      if (isStatutoryMdnaQuotedClosingInForwardLookingReport(acc, start)) continue;

      const endInfo = is10K ? findMdnaEnd10K(acc, start) : findMdnaEnd10Q(acc, start);
      const span = endInfo.index - start;
      if (span < minSpan) continue;
      candidates.push({
        start,
        label: `${is10K ? "10-K" : "10-Q"} statutory MD&A title (no Item ${itemN} prefix)`,
        span,
      });
    }
  }

  if (candidates.length === 0) return null;

  /**
   * Prefer the **longest** span among non-TOC candidates — real MD&A is typically much longer than index rows,
   * cross-references, or duplicate headings. (Earliest-only selection wrongly locked onto flattened TOC runs for
   * issuers like CHTR where “Item 7 … 39 Item 7A …” appears before the narrative body.)
   */
  const best = candidates.reduce((a, b) => (a.span >= b.span ? a : b));
  const endInfo = is10K ? findMdnaEnd10K(acc, best.start) : findMdnaEnd10Q(acc, best.start);
  const warnings: string[] = [];
  let confidence: MdnaBounds["confidence"] = "high";
  if (best.start < minOffset) {
    confidence = "medium";
    warnings.push("MD&A start appears before typical body offset — verified by span and narrative cues.");
  }

  const strictCue = hasMdnaNarrativeCue(acc, best.start);
  const deepCue = !strictCue && hasMdnaNarrativeCueDeep(acc, best.start);
  const span = endInfo.index - best.start;
  const canonicalEnd10k =
    is10K &&
    (endInfo.label.startsWith("Item 7A") ||
      endInfo.label.startsWith("Item 8"));

  if (deepCue && !strictCue) {
    warnings.push("Strict MD&A keyword cues appear after an extended heading / title block.");
  }

  if (!strictCue && !deepCue) {
    if (
      canonicalEnd10k &&
      span >= 25_000 &&
      hasLooseMdnaNarrativeCue(acc, best.start) &&
      endInfo.label !== "(eof)"
    ) {
      if (confidence === "high") confidence = "medium";
      warnings.push(
        "Limited strict MD&A keyword cues near heading; canonical Item 7A/8 end, long span, and broader prose cues — confidence elevated to medium."
      );
    } else {
      confidence = "low";
      warnings.push(
        hasLooseMdnaNarrativeCue(acc, best.start)
          ? "Limited strict MD&A keyword cues — broader interim cues matched."
          : "Limited MD&A keyword cues after start heading."
      );
    }
  }

  return {
    start: best.start,
    end: endInfo.index,
    startMatchLabel: best.label,
    endMatchLabel: endInfo.label,
    confidence,
    warnings,
  };
}

export function findFinancialStatementsAnchor(acc: string, form: string): number | null {
  if (form.includes("10-K")) {
    const re = /\bITEM\s+8\s*[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi;
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
    /\bITEM\s+1\s*[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi,
    /\bITEM\s+1\s*[\.\u2014\-]\s*(?:UNAUDITED\s+)?CONDENSED\s+CONSOLIDATED\s+FINANCIAL\s+STATEMENTS\b/gi,
    /\bITEM\s+1\s*[\.\u2014\-]\s*(?:UNAUDITED\s+)?FINANCIAL\s+STATEMENTS\b/gi,
    /\bPART\s+I[\s,]+ITEM\s+1\b/gi,
    /\bCONDENSED\s+CONSOLIDATED\s+FINANCIAL\s+STATEMENTS\b/gi,
  ];
  const hits10q: number[] = [];
  for (const r of q10q) {
    r.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = r.exec(acc)) !== null) {
      hits10q.push(mm.index);
    }
  }
  if (hits10q.length === 0) return null;
  hits10q.sort((a, b) => a - b);
  const bodyHits = hits10q.filter((i) => i >= MIN_ITEM1_FS_ANCHOR_OFFSET_10Q);
  if (bodyHits.length) return bodyHits[0]!;
  const loose = hits10q.filter((i) => i >= 2_000);
  if (loose.length) return loose[0]!;
  return hits10q[0]!;
}

/** Shared across FS-relative and global 10-Q notes discovery */
export const NOTES_TO_FINANCIAL_STATEMENTS_HEADING_RES: RegExp[] = [
  /\bNotes\s+to\s+Consolidated\s+Financial\s+Statements\b/i,
  /\bNotes\s+to\s+Financial\s+Statements\b/i,
  /\bNotes\s+to\s+Condensed\s+Consolidated\s+Financial\s+Statements\b/i,
  /\bNotes\s+to\s+Unaudited\s+Condensed\s+Consolidated\s+Financial\s+Statements\b/i,
  /\bNotes\s+to\s+Unaudited\s+Financial\s+Statements\b/i,
  /\bNotes\s+to\s+Condensed\s+Financial\s+Statements\b/i,
  /\bNotes\s+to\s+Interim\s+Financial\s+Statements\b/i,
];

/** Earliest notes-heading match at or after `minIndex` (full document). */
export function findNotesHeadingEarliestFrom(acc: string, minIndex: number): number | null {
  let best: number | null = null;
  for (const re of NOTES_TO_FINANCIAL_STATEMENTS_HEADING_RES) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const r = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(acc)) !== null) {
      if (m.index < minIndex) continue;
      if (best === null || m.index < best) best = m.index;
    }
  }
  return best;
}

export function findNotesToFinancialStatementsStart(acc: string, fsAnchor: number): number | null {
  return findNotesHeadingEarliestFrom(acc, fsAnchor);
}

/** End of notes umbrella section (before signatures / Part IV / exhibit index) */
export function findNotesSectionEnd(acc: string, form: string, notesStart: number): number {
  const tail = acc.slice(notesStart);
  const stops: number[] = [];

  if (form.includes("10-K")) {
    const reList = [
      /\bITEM\s+9[\.\u2014\-]\s*/i,
      /\bITEM\s+15[\.\u2014\-]/i,
      /\bPART\s+IV\b/i,
      /\bSIGNATURES?\b/i,
      /\bEXHIBIT\s+INDEX\b/i,
    ];
    for (const re of reList) {
      const x = re.exec(tail);
      if (x && x.index > 100) stops.push(x.index);
    }
  } else {
    const p2 = /\bPART\s+II\b/i.exec(tail);
    if (p2 && p2.index > 80) stops.push(p2.index);
    const p3 = /\bPART\s+III\b/i.exec(tail);
    if (p3 && p3.index > 80) stops.push(p3.index);
    const sig = /\bSIGNATURES?\b/i.exec(tail);
    if (sig && sig.index > 120) stops.push(sig.index);
    const item6 = /\bITEM\s+6[\.\u2014\u2013\-]/i.exec(tail);
    if (item6 && item6.index > 80) stops.push(item6.index);
  }

  const end = stops.length ? Math.min(...stops) : tail.length;
  return notesStart + Math.min(end, tail.length, 900_000);
}

function buildNotesSectionBoundsPrimary(acc: string, form: string): NotesSectionBounds | null {
  const fs = findFinancialStatementsAnchor(acc, form);
  if (fs == null) return null;
  const notesHead = findNotesToFinancialStatementsStart(acc, fs);
  const start = notesHead ?? fs + 80;
  const end = findNotesSectionEnd(acc, form, start);
  if (end <= start + 200) return null;
  return { start, end, notesHeadingFound: notesHead != null };
}

/** When Item 1 anchor is non-standard, still locate notes + segment tables from headings */
function buildNotesSectionBoundsGlobal10Q(acc: string, form: string): NotesSectionBounds | null {
  const gh = findNotesHeadingEarliestFrom(acc, MIN_GLOBAL_NOTES_HEADING_OFFSET_10Q);
  if (gh == null) return null;
  const end = findNotesSectionEnd(acc, form, gh);
  if (end <= gh + 200) return null;
  return { start: gh, end, notesHeadingFound: true };
}

export function buildNotesSectionBounds(acc: string, form: string): NotesSectionBounds | null {
  const primary = buildNotesSectionBoundsPrimary(acc, form);
  if (primary) return primary;
  if (!form.toUpperCase().includes("10-Q")) return null;
  return buildNotesSectionBoundsGlobal10Q(acc, form);
}

function headingNegative(heading: string): boolean {
  const h = heading.toLowerCase();
  if (/\b(debt|lease|income\s+tax|fair\s+value|stock\s+compensation|equity|earnings\s+per\s+share|pension|commitments?\s+and\s+contingencies)\b/i.test(h)) {
    if (!/\bsegment|disaggregat|revenue\s+by|operating\s+segment|reportable\b/i.test(h)) return true;
  }
  return false;
}

export function scoreSegmentNoteCandidate(heading: string, bodySnippet: string): {
  total: number;
  headingScore: number;
  bodyScore: number;
} {
  const h = heading.toLowerCase();
  const b = bodySnippet.toLowerCase();

  if (headingNegative(heading)) {
    return { total: -100, headingScore: -100, bodyScore: 0 };
  }

  let headingScore = 0;
  /** Parenthetical style e.g. "(15) Information About … Operating Segments" */
  if (/\binformation\s+about\b.*\boperating\s+segments\b/i.test(h)) headingScore += 48;
  if (/\bsegment\s+information\b/.test(h)) headingScore += 50;
  if (/\boperating\s+segments\b/.test(h)) headingScore += 50;
  if (/\breportable\s+segments\b/.test(h)) headingScore += 45;
  if (/\bsegment\s+reporting\b/.test(h)) headingScore += 40;
  if (/\bsegment\s+and\s+geographic\b/.test(h)) headingScore += 35;
  if (/\bdisaggregated\s+revenue\b/.test(h)) headingScore += 30;
  if (/\brevenue\s+by\s+segment\b/.test(h)) headingScore += 28;
  if (/\bgeographic\s+information\b/.test(h)) headingScore += 25;
  if (/\bmajor\s+customers\b/.test(h)) headingScore += 20;

  const revenueHeading =
    /\brevenue\s+recognition\b/.test(h) ||
    /^note\s+\d+.*\brevenue\b/i.test(heading) ||
    /\bnet\s+revenue\b/.test(h);

  let bodyScore = 0;
  if (/\breportable\s+segment\b/.test(b)) bodyScore += 20;
  if (/\boperating\s+segment\b/.test(b)) bodyScore += 20;
  if (/\bdisaggregated\s+revenue\b/.test(b)) bodyScore += 15;
  if (/\bgeographic\s+revenue\b/.test(b)) bodyScore += 15;
  if (/\bsegment\s+revenue\b/.test(b)) bodyScore += 15;
  if (/\bsegment\s+profit\b/.test(b)) bodyScore += 15;
  if (/\bchief\s+operating\s+decision\s+maker\b/.test(b)) bodyScore += 15;
  if (/\bproduct\s+revenue|\bservice\s+revenue|\bcustomer\s+type|\bbusiness\s+unit|\boperating\s+division|\bgeograph/i.test(b))
    bodyScore += 10;

  if (revenueHeading) {
    const hasSeg =
      /\bsegment|reportable\s+segment|operating\s+segment|disaggregated\s+revenue|revenue\s+by\s+segment|geographic\s+revenue|product\s+revenue|service\s+revenue|business\s+unit\b/i.test(
        b
      );
    if (hasSeg) headingScore += 25;
    else headingScore -= 15;
  } else if (/\brevenue\b/.test(h) && !/\bsegment|disaggregat|geographic\b/.test(h)) {
    headingScore += /\bsegment|disaggregat|geographic|product|service|customer\b/i.test(b) ? 20 : -10;
  }

  return { total: headingScore + bodyScore, headingScore, bodyScore };
}

function parenNumberIsNoteNotYear(numToken: string): boolean {
  const n = parseInt(numToken.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return true;
  if (n >= 1900 && n <= 2100) return false;
  return n >= 1 && n <= 999;
}

export type NoteBoundary = {
  idx: number;
  num: string;
  fullMatch: string;
  /** `note` = “Note 5”; `paren` = “(5) ” — list markers “(1) ” inside a note also match `paren`. */
  source: "note" | "paren";
};

/** Leading digits of note labels like “15” or “15A” for ordering parenthetical notes. */
export function parseNoteOrdinal(numToken: string): number {
  const m = numToken.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Next boundary starts a *new* note vs an in-note list like “(1) QVC … (2) …” under “(15) Segments”.
 * - Every `Note N` match is structural (new note heading).
 * - For `(N)`, only structural when N increases past the *opening* note’s ordinal (e.g. (16) after (15)).
 */
export function isStructuralNoteBoundary(opening: NoteBoundary, candidate: NoteBoundary): boolean {
  if (candidate.source === "note") return true;
  return parseNoteOrdinal(candidate.num) > parseNoteOrdinal(opening.num);
}

/** End offset in slice (exclusive): either next structural boundary or EOF. */
export function computeStructuralNoteEndOffset(
  boundaries: NoteBoundary[],
  startIndex: number,
  sliceLength: number
): number {
  if (startIndex >= boundaries.length) return sliceLength;
  const opening = boundaries[startIndex];
  for (let j = startIndex + 1; j < boundaries.length; j++) {
    if (isStructuralNoteBoundary(opening, boundaries[j])) return boundaries[j].idx;
  }
  return sliceLength;
}

/**
 * Note headers in many filings: "Note 5 — …" or parenthetical "(15) Information About …" (QVC, others).
 */
export function collectNoteBlockStartIndicesInSlice(slice: string): NoteBoundary[] {
  const out: NoteBoundary[] = [];
  const seen = new Set<number>();

  const reNote = /\b(?:Note|NOTE)\s+(\d+[A-Za-z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = reNote.exec(slice)) !== null) {
    if (!seen.has(m.index)) {
      seen.add(m.index);
      out.push({ idx: m.index, num: m[1], fullMatch: m[0], source: "note" });
    }
  }

  const reParen = /\(\s*(\d{1,3}[A-Za-z]?)\s*\)\s+/g;
  while ((m = reParen.exec(slice)) !== null) {
    if (!parenNumberIsNoteNotYear(m[1])) continue;
    if (!seen.has(m.index)) {
      seen.add(m.index);
      out.push({ idx: m.index, num: m[1], fullMatch: m[0], source: "paren" });
    }
  }

  out.sort((a, b) => a.idx - b.idx);
  return out;
}

const SEGMENT_KEYWORD_FALLBACK_RE =
  /\b(?:Operating\s+Segments?|Segment\s+Information|Segments?\s+and\s+Geographic(?:\s+Information)?|Geographic\s+Information|Disaggregated\s+(?:Net\s+)?Revenue|Revenue\s+by\s+(?:Operating\s+)?Segment|Revenue\s+by\s+Geograph|Business\s+Segments?|Reportable\s+Segments?)\b/i;

export function findSegmentKeywordFallbackPick(acc: string, notes: NotesSectionBounds): SegmentNotePick | null {
  const slice = acc.slice(notes.start, notes.end);
  const m = SEGMENT_KEYWORD_FALLBACK_RE.exec(slice);
  if (!m || m.index < 0) return null;
  const rel = notes.start + m.index;
  const padStart = 700;
  const maxSpan = 200_000;
  const start = Math.max(notes.start, rel - padStart);
  const end = Math.min(notes.end, rel + maxSpan);
  if (end <= start + 400) return null;
  const headingLine = acc
    .slice(rel, Math.min(acc.length, rel + Math.max(m[0].length, 120)))
    .replace(/\s+/g, " ")
    .trim();
  return {
    start,
    end,
    headingText: headingLine.slice(0, 200),
    score: 44,
    headingScore: 44,
    bodyScore: 0,
    confidence: "medium",
    warnings: ["Segment window from keyword fallback (numbered note headings missing or unscored)."],
  };
}

/**
 * Enumerate note-sized blocks after "Note N" or "(N)" headings inside notes section; pick best segment candidate.
 */
export function findBestSegmentNoteRange(acc: string, notes: NotesSectionBounds): SegmentNotePick | null {
  const slice = acc.slice(notes.start, notes.end);
  const noteStarts = collectNoteBlockStartIndicesInSlice(slice);

  let best: SegmentNotePick | null = null;

  if (noteStarts.length === 0) {
    return findSegmentKeywordFallbackPick(acc, notes);
  }

  for (let i = 0; i < noteStarts.length; i++) {
    const ns = noteStarts[i];
    const blockStart = notes.start + ns.idx;
    const blockEndRel = computeStructuralNoteEndOffset(noteStarts, i, slice.length);
    const blockEnd = notes.start + blockEndRel;
    const blockText = acc.slice(blockStart, blockEnd);
    const headingLine = blockText.slice(0, Math.min(blockText.length, 220)).replace(/\s+/g, " ").trim();
    const bodySnippet = blockText.slice(0, 4500);

    const sc = scoreSegmentNoteCandidate(headingLine, bodySnippet);
    if (sc.total < -50) continue;

    const warnings: string[] = [];
    let confidence: SegmentNotePick["confidence"] = "low";
    if (sc.total >= SEGMENT_NOTE_MIN_SCORE_HIGH) confidence = "high";
    else if (sc.total >= SEGMENT_NOTE_MIN_SCORE_MEDIUM) confidence = "medium";
    else warnings.push("Low segment relevance score — tables may be excluded unless uncertain mode is enabled.");

    const pick: SegmentNotePick = {
      start: blockStart,
      end: blockEnd,
      headingText: headingLine.slice(0, 200),
      score: sc.total,
      headingScore: sc.headingScore,
      bodyScore: sc.bodyScore,
      confidence,
      warnings,
    };

    if (!best || sc.total > best.score) best = pick;
  }

  if (!best) {
    return findSegmentKeywordFallbackPick(acc, notes);
  }
  return best;
}
