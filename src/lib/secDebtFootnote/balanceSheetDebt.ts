/**
 * Balance-sheet debt line labels (plain substring cues) for cross-checking notes.
 */

function collapseWs(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&#8209;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripTagsToPlainLocal(fragment: string): string {
  return collapseWs(decodeBasicEntities(fragment.replace(/<[^>]+>/g, " ")));
}

function normalizePlainForMatch(s: string): string {
  return collapseWs(
    decodeBasicEntities(s)
      .replace(/[\u2014\u2013\u2012\u2015]/g, "-")
      .replace(/[""'']/g, "'")
      .toLowerCase(),
  );
}

/** Normalized substrings searched in the balance-sheet window (before Notes). */
export const BALANCE_SHEET_DEBT_LABEL_SNIPPETS: ReadonlyArray<string> = [
  "short-term debt",
  "short term debt",
  "current portion of long-term debt",
  "current portion of long term debt",
  "current maturities of long-term debt",
  "current maturities of long term debt",
  "long-term debt",
  "long term debt",
  "long-term debt, net",
  "notes payable",
  "borrowings",
  "finance lease liabilities",
  "finance lease obligation",
  "debt, net",
];

/**
 * Scan plain text between financial-statements floor and Notes start for BS debt rows.
 * Operating lease liabilities are included only when no other debt snippet matched (spec).
 */
export function extractBalanceSheetDebtLabels(html: string, floor: number, notesStart: number): string[] {
  const hi = Math.max(floor + 1, notesStart);
  const slice = html.slice(floor, hi);
  const plain = normalizePlainForMatch(stripTagsToPlainLocal(slice));
  const found = new Set<string>();
  for (const lab of BALANCE_SHEET_DEBT_LABEL_SNIPPETS) {
    if (plain.includes(lab)) found.add(lab);
  }
  if (
    found.size === 0 &&
    plain.includes("operating lease liabilities") &&
    !plain.includes("long-term debt") &&
    !plain.includes("notes payable")
  ) {
    found.add("operating lease liabilities");
  }
  return [...found];
}

export function balanceSheetCrosscheckScore(noteBodyNorm: string, labels: string[]): number {
  if (!labels.length) return 0;
  let n = 0;
  for (const L of labels) {
    if (noteBodyNorm.includes(L)) n += 14;
  }
  return Math.min(n, 52);
}
