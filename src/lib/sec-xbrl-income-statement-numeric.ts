/**
 * Income statement grid convention:
 *
 * - **Non-negated presentation arcs:** prefer **instance raw** (`rawValues`) so interest / nonop lines stay on one convention.
 * - **Negated preferred label** (SEC “−fact” semantics): prefer **`values`** — the flipped **SEC display**
 *   from {@link normalizeXbrlFactForStatementModel}. That aligns with printed face tables (gain as contra‑expense
 *   in parentheses; loss additive under operating expenses).
 */

import { isNegatedPreferredLabel } from "@/lib/sec-xbrl-display-normalize";

export type IncomeStatementNumericPickRow = {
  values: Record<string, number | null>;
  rawValues: Record<string, number | null>;
  preferredLabelRole?: string | null;
};

export function incomeStatementCellNumeric(row: IncomeStatementNumericPickRow, periodKey: string): number | null {
  const raw = row.rawValues?.[periodKey];
  const disp = row.values[periodKey];
  const negateArc = isNegatedPreferredLabel(row.preferredLabelRole ?? null);

  if (negateArc) {
    if (disp !== null && disp !== undefined && Number.isFinite(disp)) return disp;
    if (raw !== null && raw !== undefined && Number.isFinite(raw)) return raw;
    return null;
  }

  if (raw !== null && raw !== undefined && Number.isFinite(raw)) return raw;
  if (disp !== null && disp !== undefined && Number.isFinite(disp)) return disp;
  return null;
}

export function incomeStatementValuesForExport(
  row: IncomeStatementNumericPickRow,
  periodKeys: string[]
): Record<string, number | null> {
  const o: Record<string, number | null> = {};
  for (const pk of periodKeys) {
    o[pk] = incomeStatementCellNumeric(row, pk);
  }
  return o;
}
