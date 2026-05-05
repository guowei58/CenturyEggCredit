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

/** 10-K MD&A end: Item 7A or Item 8 (financial statements item), earliest after start */
export function findMdnaEnd10K(acc: string, start: number): { index: number; label: string } {
  const tail = acc.slice(start + 1);
  const candidates: { idx: number; label: string }[] = [];

  const r7a = /\bITEM\s+7A[\.\u2014\u2013\-]\s*QUANTITATIVE\b/i.exec(tail);
  if (r7a) candidates.push({ idx: start + 1 + r7a.index, label: "Item 7A" });

  const strong8 = /\bITEM\s+8[\.\u2014\-]\s*FINANCIAL\s+STATEMENTS\b/gi;
  let sm: RegExpExecArray | null;
  while ((sm = strong8.exec(tail)) !== null) {
    const abs = start + 1 + sm.index;
    if (!isItem8FinancialStatementsCrossReference(acc, abs)) {
      candidates.push({ idx: abs, label: "Item 8" });
      break;
    }
  }

  if (candidates.length === 0) {
    const weak8 = /\bITEM\s+8[\.\u2014\-]\s*Financial\s+Statements\b/gi;
    const wm = weak8.exec(tail);
    if (wm) {
      const abs = start + 1 + wm.index;
      if (!isItem8FinancialStatementsCrossReference(acc, abs)) {
        candidates.push({ idx: abs, label: "Item 8 (weak)" });
      }
    }
  }

  const best = candidates.length ? candidates.reduce((a, b) => (a.idx <= b.idx ? a : b)) : null;
  return best ? { index: best.idx, label: best.label } : { index: acc.length, label: "(eof)" };
}

/**
 * Weak Item 3/4/Part II hits inside MD&A prose (“see Item 3”, TOC fragments) collapse the slice to &lt;1k chars
 * so **no** `<table>` offsets land inside — diagnostics show `in MD&A slice 0`, `rejected 0`.
 * Strong headings can still end MD&A early when real.
 */
const MIN_DISTANCE_WEAK_MDNA_END_MARKER_10Q = 3400;

/** 10-Q MD&A end: Item 3, Item 4, Part II — earliest after start */
export function findMdnaEnd10Q(acc: string, start: number): { index: number; label: string } {
  const tail = acc.slice(start + 1);
  const candidates: { idx: number; label: string }[] = [];

  const push = (tailIdx: number, label: string, strong: boolean) => {
    const absIdx = start + 1 + tailIdx;
    if (!strong && absIdx - start < MIN_DISTANCE_WEAK_MDNA_END_MARKER_10Q) return;
    candidates.push({ idx: absIdx, label });
  };

  const r3 = /\bITEM\s+3[\.\u2014\u2013\-]\s*QUANTITATIVE\b/i.exec(tail);
  if (r3) push(r3.index, "Item 3", true);

  const r4 = /\bITEM\s+4[\.\u2014\u2013\-]\s*(?:CONTROLS|MINE\s+SAFETY)/i.exec(tail);
  if (r4) push(r4.index, "Item 4", true);

  const r1lp = /\bITEM\s+1[\.\u2014\u2013\-]\s*LEGAL\s+PROCEEDINGS\b/i.exec(tail);
  if (r1lp) push(r1lp.index, "Item 1 Legal", true);

  /** Omit “Quantitative” — weak: prose references “Item 3.” surface early inside Item 2 */
  const r3Any = /\bITEM\s+3[\.\u2014\u2013\-]/i.exec(tail);
  if (r3Any) push(r3Any.index, "Item 3 (heading)", false);

  const r4Any = /\bITEM\s+4[\.\u2014\u2013\-]/i.exec(tail);
  if (r4Any) push(r4Any.index, "Item 4 (heading)", false);

  const p2 = /\bPART\s+II\b/i.exec(tail);
  if (p2) push(p2.index, "Part II", false);

  const sig = /\bSIGNATURES?\b/i.exec(tail);
  if (sig && sig.index > 120) push(sig.index, "Signatures", false);

  if (candidates.length === 0) {
    const weak3 = /\bITEM\s+3\b/gi.exec(tail);
    if (weak3) push(weak3.index, "Item 3 (weak)", false);
  }

  const best = candidates.length ? candidates.reduce((a, b) => (a.idx <= b.idx ? a : b)) : null;
  return best ? { index: best.idx, label: best.label } : { index: acc.length, label: "(eof)" };
}

const MDNA_START_PATTERNS_10K: RegExp[] = [
  /\bITEM\s+7[\.\u2014\u2013\-]\s*MANAGEMENT'?S\s+DISCUSSION\s+AND\s+ANALYSIS\s+OF\s+FINANCIAL\s+CONDITION\s+AND\s+RESULTS\s+OF\s+OPERATIONS\b/gi,
  /\bITEM\s+7[\.\u2014\u2013\-]\s*Management'?s\s+Discussion\s+and\s+Analysis\s+of\s+Financial\s+Condition\s+and\s+Results\s+of\s+Operations\b/gi,
  /\bITEM\s+7\s+MANAGEMENT'?S\s+DISCUSSION\s+AND\s+ANALYSIS\b/gi,
];

const MDNA_START_PATTERNS_10Q: RegExp[] = [
  /\bITEM\s+2[\.\u2014\u2013\-]\s*MANAGEMENT'?S\s+DISCUSSION\s+AND\s+ANALYSIS\s+OF\s+FINANCIAL\s+CONDITION\s+AND\s+RESULTS\s+OF\s+OPERATIONS\b/gi,
  /\bITEM\s+2[\.\u2014\u2013\-]\s*Management'?s\s+Discussion\s+and\s+Analysis\b/gi,
  /\bITEM\s+2\s+MANAGEMENT'?S\s+DISCUSSION\s+AND\s+ANALYSIS\b/gi,
  /\bITEM\s+2[\.\u2014\u2013\-]\s*MD&A\b/gi,
  /\bPART\s+I\s+ITEM\s+2[\.\u2014\u2013\-]\s*MANAGEMENT'?S\s+DISCUSSION\b/gi,
];

function isProseItemReference(acc: string, index: number, itemN: string): boolean {
  const lead = acc.slice(index, index + 40).toLowerCase();
  return new RegExp(`^item\\s+${itemN}\\s+of\\b`, "i").test(lead);
}

/** TOC-ish: Item line + page number soon after, little substance */
function looksLikeTocMdnaRow(acc: string, start: number): boolean {
  const head = acc.slice(start, start + 420);
  const pageHit = head.search(/\bpage\s*\d{1,3}\b/i);
  if (pageHit <= 0 || pageHit > 320) return false;
  const before = head.slice(0, pageHit);
  const hasSubstance =
    /\b(results\s+of\s+operations|liquidity|capital\s+resources|critical\s+accounting|covid|macroeconomic|overview)\b/i.test(
      before
    );
  return !hasSubstance && before.replace(/\s+/g, " ").trim().length < 200;
}

function hasMdnaNarrativeCue(acc: string, start: number): boolean {
  const sample = acc.slice(start, start + 2500);
  return /\b(results\s+of\s+operations|liquidity|capital\s+resources|critical\s+accounting|covid|macroeconomic|non-gaap|adjusted\s+ebitda|segment|overview)\b/i.test(
    sample
  );
}

/** Broader cues for stubborn 10-Q layouts / thinner prose */
function hasLooseMdnaNarrativeCue(acc: string, start: number): boolean {
  const sample = acc.slice(start, start + 3200);
  return (
    hasMdnaNarrativeCue(acc, start) ||
    /\b(revenue|sales|expenses|margin|earnings|guidance|outlook|performance|financial\s+results|operating\s+results|business\s+overview|interim|quarterly\s+results|cash\s+flows?|covid)\b/i.test(
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
      if (looksLikeTocMdnaRow(acc, start)) continue;
      if (start < minOffset && !hasMdnaNarrativeCue(acc, start)) continue;

      const endInfo = is10K ? findMdnaEnd10K(acc, start) : findMdnaEnd10Q(acc, start);
      const span = endInfo.index - start;
      if (span < minSpan) continue;
      candidates.push({ start, label: m[0].slice(0, 80).replace(/\s+/g, " "), span });
    }
  }

  // Fallback: ITEM N without full title (stricter span + cue)
  if (candidates.length === 0) {
    const loose = new RegExp(`\\bITEM\\s+${itemN}[\\.\u2014\u2013\\-]`, "gi");
    let lm: RegExpExecArray | null;
    while ((lm = loose.exec(acc)) !== null) {
      const start = lm.index;
      if (isProseItemReference(acc, start, itemN)) continue;
      if (looksLikeTocMdnaRow(acc, start)) continue;
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
        if (looksLikeTocMdnaRow(acc, start)) continue;
        if (start < minOffLoose && !hasLooseMdnaNarrativeCue(acc, start)) continue;

        const endInfo = findMdnaEnd10Q(acc, start);
        const span = endInfo.index - start;
        if (span < minSpanLoose) continue;
        candidates.push({ start, label: `${m[0].slice(0, 72).replace(/\s+/g, " ")} (10-Q loose)`, span });
      }
    }
    const looseItem = new RegExp(`\\bITEM\\s+${itemN}[\\.\u2014\u2013\\-]`, "gi");
    let lm: RegExpExecArray | null;
    while ((lm = looseItem.exec(acc)) !== null) {
      const start = lm.index;
      if (isProseItemReference(acc, start, itemN)) continue;
      if (looksLikeTocMdnaRow(acc, start)) continue;
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
    const bare = /\bITEM\s+2[\.\u2014\u2013\-]/gi;
    let bm: RegExpExecArray | null;
    while ((bm = bare.exec(acc)) !== null) {
      const start = bm.index;
      if (isProseItemReference(acc, start, "2")) continue;
      if (looksLikeTocMdnaRow(acc, start)) continue;
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

  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => (a.span >= b.span ? a : b));
  const endInfo = is10K ? findMdnaEnd10K(acc, best.start) : findMdnaEnd10Q(acc, best.start);
  const warnings: string[] = [];
  let confidence: MdnaBounds["confidence"] = "high";
  if (best.start < minOffset) {
    confidence = "medium";
    warnings.push("MD&A start appears before typical body offset — verified by span and narrative cues.");
  }
  if (!hasMdnaNarrativeCue(acc, best.start)) {
    confidence = "low";
    warnings.push(
      hasLooseMdnaNarrativeCue(acc, best.start)
        ? "Limited strict MD&A keyword cues — broader interim cues matched."
        : "Limited MD&A keyword cues after start heading."
    );
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
    /\bITEM\s+1[\.\u2014\-]\s*(?:UNAUDITED\s+)?CONDENSED\s+CONSOLIDATED\s+FINANCIAL\s+STATEMENTS\b/gi,
    /\bITEM\s+1[\.\u2014\-]\s*(?:UNAUDITED\s+)?FINANCIAL\s+STATEMENTS\b/gi,
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
