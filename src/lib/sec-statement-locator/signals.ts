import type { StatementKind } from "./types";

export function normalizeSpace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Positive statement headings by kind. */
export const POSITIVE_HEADINGS: Record<StatementKind, RegExp[]> = {
  is: [
    /\bcondensed\s+consolidated\s+statements?\s+of\s+(?:operations|income|earnings|loss)\b/i,
    /\bconsolidated\s+statements?\s+of\s+(?:operations|income|earnings|loss)\b/i,
    /\bstatements?\s+of\s+(?:operations|income|earnings|loss)\b/i,
  ],
  bs: [
    /\bcondensed\s+consolidated\s+balance\s+sheets?\b/i,
    /\bconsolidated\s+balance\s+sheets?\b/i,
    /\bstatements?\s+of\s+financial\s+position\b/i,
    /\bbalance\s+sheets?\b/i,
  ],
  cf: [
    /\bcondensed\s+consolidated\s+statements?\s+of\s+cash\s+flows?\b/i,
    /\bconsolidated\s+statements?\s+of\s+cash\s+flows?\b/i,
    /\bstatements?\s+of\s+cash\s+flows?\b/i,
  ],
};

/** Positive row-label anchors by kind. */
export const POSITIVE_ROW_ANCHORS: Record<StatementKind, RegExp[]> = {
  is: [
    /\b(?:net\s+)?revenues?\b/i,
    /\bnet\s+sales\b/i,
    /\bcost\s+of\s+(?:revenue|sales)\b/i,
    /\bgross\s+profit\b/i,
    /\boperating\s+(?:income|loss)\b/i,
    /\binterest\s+expense\b/i,
    /\bincome\s+tax\s+expense\b/i,
    /\bnet\s+(?:income|loss)\b/i,
    /\bearnings\s+per\s+share\b/i,
    /\bweighted\s+average\s+shares\b/i,
  ],
  bs: [
    /\bassets\b/i,
    /\bcurrent\s+assets\b/i,
    /\bcash\s+and\s+cash\s+equivalents\b/i,
    /\baccounts\s+receivable\b/i,
    /\binventory\b/i,
    /\bproperty\s+and\s+equipment\b/i,
    /\bgoodwill\b/i,
    /\bliabilities\b/i,
    /\bcurrent\s+liabilities\b/i,
    /\baccounts\s+payable\b/i,
    /\bdebt\b/i,
    /\bstockholders['']?\s+equity\b/i,
    /\bshareholders['']?\s+equity\b/i,
    /\btotal\s+assets\b/i,
    /\btotal\s+liabilities\s+and\s+(?:stockholders|shareholders)['']?\s+equity\b/i,
  ],
  cf: [
    /\bnet\s+(?:income|loss)\b/i,
    /\bdepreciation\s+and\s+amortization\b/i,
    /\bstock[- ]based\s+compensation\b/i,
    /\bnet\s+cash\s+(?:provided|used)\s+by\s+operating\s+activities\b/i,
    /\bnet\s+cash\s+(?:provided|used)\s+by\s+investing\s+activities\b/i,
    /\bcapital\s+expenditures\b/i,
    /\bnet\s+cash\s+(?:provided|used)\s+by\s+financing\s+activities\b/i,
    /\beffect\s+of\s+exchange\s+rates\b/i,
    /\bcash\s+at\s+beginning\s+of\s+(?:the\s+)?period\b/i,
    /\bcash\s+at\s+end\s+of\s+(?:the\s+)?period\b/i,
  ],
};

/** Nearby headings / contexts that should penalize or reject a block. */
export const NEGATIVE_CONTEXT_PATTERNS: RegExp[] = [
  /\bselected\s+financial\s+data\b/i,
  /\bresults\s+of\s+operations\b/i,
  /\bmanagement['']?s\s+discussion\b/i,
  /\bliquidity\s+and\s+capital\s+resources\b/i,
  /\bsegment\s+information\b/i,
  /\bsupplemental\b/i,
  /\bnon[- ]gaap\b/i,
  /\badjusted\s+ebitda\b/i,
  /\breconciliation\b/i,
  /\bnon[- ]guarantor\b/i,
  /\bguarantor\b/i,
  /\bcondensed\s+consolidating\b/i,
  /\bparent\s+company\b/i,
  /\bschedule\s+i\b/i,
  /\bquarterly\s+financial\s+data\b/i,
  /\bpro\s+forma\b/i,
  /\bpercentage\s+of\s+(?:net\s+)?revenues?\b/i,
  /\bas\s+a\s+percentage\b/i,
  /\bother\s+comprehensive\s+income\b/i,
  /\btable\s+of\s+contents\b/i,
  /\bindex\s+to\s+financial\s+statements\b/i,
];

export const ITEM1_START_PATTERN =
  /\bITEM\s+1[\.\u2014\u2013\-]?\s*(?:(?:condensed|consolidated|combined|unaudited)\s+){0,4}FINANCIAL\s+STATEMENTS\b/gi;

export const ITEM8_START_PATTERNS: RegExp[] = [
  /\bITEM\s+8[\.\u2014\u2013\-:]+\s*(?:(?:CONDENSED|CONSOLIDATED|COMBINED|UNAUDITED|AUDITED|ANNUAL)\s+){0,4}FINANCIAL\s+STATEMENTS?\b/gi,
  /\bITEM\s+8[\.\u2014\u2013\-:]+\s*INDEX\s+TO\s+(?:THE\s+)?(?:CONSOLIDATED\s+)?FINANCIAL\s+STATEMENTS\b/gi,
  /\bITEM\s+8[\.\u2014\u2013\-:]+\s*FINANCIAL\s+STATEMENTS?\b/gi,
];

/**
 * 10-Q IS/BS/CF almost always appear in the first few pages of Item 1 — not in later notes.
 * 10-K face tables can be much deeper (Part IV exhibits); do not apply this window to 10-K.
 */
export const TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START = 42_000;

/** Bonus band: tables within this distance from Item 1 start are strongly preferred on 10-Q. */
export const TEN_Q_PRIMARY_FACE_STRONG_EARLY_CHARS = 14_000;

/** Row/heading cues that a block is a footnote schedule, not a primary face statement (10-Q notes). */
/** Equity rollforward / stockholders' equity tables mistaken for income statements on 10-Q. */
export const IS_EQUITY_ROLLFORWARD_PATTERNS: RegExp[] = [
  /\bbalance\s+as\s+of\b/i,
  /\bother\s+comprehensive\s+income\b/i,
  /\brepurchases?\s+of\s+common\s+stock\b/i,
  /\bshares\s+withheld\s+for\s+taxes\b/i,
  /\bdividends?\s+declared\b/i,
  /\baccumulated\s+other\s+comprehensive\b/i,
];

export const TEN_Q_FOOTNOTE_TABLE_PATTERNS: RegExp[] = [
  /\bnote\s+\d+\b/i,
  /\bshares?\s+repurchased\b/i,
  /\baverage\s+price\s+per\s+share\b/i,
  /\bper\s+share\s*[-–—]\s*(?:basic|diluted)\b/i,
  /\bweighted[- ]average\s+shares\b/i,
  /\bseverance\s+and\s+termination\b/i,
  /\bcontract\s+cancellation\s+charges\b/i,
  /\bforeign\s+exchange\s+contracts\b/i,
  /\bderivative\s+instruments?\b/i,
  /\brestructuring\b/i,
  /\bdividend\s+equivalent\s+rights\b/i,
];

export const NOTES_HEADING_PATTERNS: RegExp[] = [
  /\bnotes\s+to\s+(?:the\s+)?(?:unaudited\s+)?(?:condensed\s+)?consolidated\s+financial\s+statements\b/gi,
  /\bnotes\s+to\s+(?:the\s+)?consolidated\s+financial\s+statements\b/gi,
];

export function countPatternHits(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const re of patterns) {
    re.lastIndex = 0;
    if (re.test(text)) hits += 1;
  }
  return hits;
}

export function looksLikeInstantPeriodHeader(text: string): boolean {
  return /\b(?:as\s+of|at)\b/i.test(text) || /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i.test(text);
}

export function looksLikeDurationPeriodHeader(text: string): boolean {
  return (
    /\b(?:year|years|quarter|months?)\s+ended\b/i.test(text) ||
    /\b(?:three|six|nine|twelve)\s+months?\s+ended\b/i.test(text) ||
    /\bfor\s+the\s+(?:year|quarter|period)\s+ended\b/i.test(text)
  );
}

export function periodStructureMatchesKind(kind: StatementKind, periodHeaders: string[]): { ok: boolean; reason?: string } {
  const blob = periodHeaders.join(" ").toLowerCase();
  if (!blob.trim()) return { ok: true };
  if (kind === "bs") {
    const instant = looksLikeInstantPeriodHeader(blob);
    const duration = looksLikeDurationPeriodHeader(blob);
    if (duration && !instant) return { ok: false, reason: "balance_sheet_duration_periods" };
    return { ok: true };
  }
  const instant = looksLikeInstantPeriodHeader(blob) && !looksLikeDurationPeriodHeader(blob);
  if (instant) return { ok: false, reason: "income_or_cf_instant_periods" };
  return { ok: true };
}
