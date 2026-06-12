/** Display helpers for compiled XBRL statement grids (Historical Financial Statements). */

export type CompilerModelRow = Record<string, string | number | null | string[] | undefined>;

export function compilerRowPeriodValue(row: CompilerModelRow, period: string): number | null {
  const v = row[period];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function compilerRowHasNumericInPeriods(row: CompilerModelRow, periods: readonly string[]): boolean {
  for (const p of periods) {
    if (compilerRowPeriodValue(row, p) !== null) return true;
  }
  return false;
}

/** Synthetic workbook keys for face labels without an XBRL concept. */
export function isCompilerLineOnlyPlaceholder(concept: string): boolean {
  return (concept ?? "").trim().startsWith("_:lineonly:");
}

/**
 * Footnote / narrative prose that sometimes lands in the Line column during bulk save.
 * Safe to drop when the row has no numeric facts in the visible grid.
 */
export function looksLikeCompilerFootnoteNarrativeLine(label: string): boolean {
  const t = (label ?? "").trim();
  if (!t) return false;
  if (/^\[\d+\]/.test(t)) return true;
  if (/^amounts may not add due to rounding/i.test(t)) return true;
  if (/^the (decrease|increase|change) (in|from)/i.test(t)) return true;
  if (/^as a result of the reorganization/i.test(t)) return true;
  if (/^note \d+ (in|to) our consolidated financial/i.test(t)) return true;
  if (/^note \d+ for further information/i.test(t)) return true;
  return false;
}

/**
 * Keep rows that have at least one numeric cell in the active period columns.
 * Always drop line-only placeholders and footnote narrative lines when empty.
 */
/** Row appears on at least one saved workbook (compiler sets `_workbookLine`). */
export function isCompilerWorkbookBackedRow(row: CompilerModelRow): boolean {
  return row._workbookLine === true;
}

export function filterVisibleCompilerRows<T extends CompilerModelRow>(
  rows: readonly T[],
  periods: readonly string[]
): T[] {
  if (!periods.length) return [...rows];
  return rows.filter((row) => {
    const concept = String(row.concept ?? "");
    const label = String(row.line ?? row.concept ?? "");
    const hasNumeric = compilerRowHasNumericInPeriods(row, periods);

    if (isCompilerWorkbookBackedRow(row)) return true;
    if (isCompilerLineOnlyPlaceholder(concept)) return hasNumeric;
    if (!hasNumeric && looksLikeCompilerFootnoteNarrativeLine(label)) return false;
    return hasNumeric;
  });
}
