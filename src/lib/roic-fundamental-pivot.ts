/**
 * Pivot Roic v2 fundamental JSON (array of one object per fiscal period) into
 * a line-item × period matrix like their web income statement.
 */

import { getRoicLineItemLabel } from "@/lib/roic-fundamental-line-labels";

export type PivotedFundamental = {
  columnLabels: string[];
  rows: { key: string; label: string; values: unknown[] }[];
};

export type PivotFundamentalOptions = {
  /** Quarterly tab: force column headers to include calendar year + quarter (e.g. 2024 Q3). */
  quarterlyColumnLabels?: boolean;
};

const COLUMN_META = new Set(["ticker", "date", "period", "currency", "fiscal_year", "period_label"]);

function countDuplicateFiscalYears(records: Record<string, unknown>[]): boolean {
  const counts = new Map<string, number>();
  for (const r of records) {
    const fy = String(r.fiscal_year ?? "").trim();
    if (fy === "") continue;
    counts.set(fy, (counts.get(fy) ?? 0) + 1);
  }
  return Array.from(counts.values()).some((c) => c > 1);
}

function sortRecords(records: Record<string, unknown>[], preferDateOrder: boolean): Record<string, unknown>[] {
  if (preferDateOrder) {
    const allHaveDate = records.every((r) => r.date != null && String(r.date).trim() !== "");
    if (allHaveDate) {
      return [...records].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
  }
  return [...records].sort((a, b) => {
    const ya = parseInt(String(a.fiscal_year ?? ""), 10);
    const yb = parseInt(String(b.fiscal_year ?? ""), 10);
    if (Number.isFinite(ya) && Number.isFinite(yb) && ya !== yb) return ya - yb;
    return String(a.date ?? "").localeCompare(String(b.date ?? ""));
  });
}

function normalizeYearQuarterLabel(pl: string): string {
  const yMatch = pl.match(/(19|20)\d{2}/);
  const qMatch = pl.match(/Q\s*([1-4])/i);
  if (yMatch && qMatch) return `${yMatch[0]} Q${qMatch[1]}`;
  return pl;
}

/** Column title for quarterly grids: always include year + quarter. */
function buildQuarterlyColumnLabel(r: Record<string, unknown>): string {
  const pl = String(r.period_label ?? "").trim();
  if (pl && /\d{4}.*Q\s*[1-4]|Q\s*[1-4].*\d{4}/i.test(pl)) {
    return normalizeYearQuarterLabel(pl);
  }

  const dateStr = String(r.date ?? "").trim().slice(0, 10);
  const fy = String(r.fiscal_year ?? "").trim();

  if (dateStr.length === 10) {
    const parts = dateStr.split("-");
    const py = parseInt(parts[0]!, 10);
    const pm = parseInt(parts[1]!, 10);
    if (Number.isFinite(py) && Number.isFinite(pm)) {
      const q = Math.ceil(pm / 3);
      return `${py} Q${q}`;
    }
  }

  const qOnly = pl.match(/Q\s*([1-4])/i);
  if (qOnly && fy) return `${fy} Q${qOnly[1]}`;

  if (fy && pl) return `${fy} ${pl}`;
  if (pl) return normalizeYearQuarterLabel(pl) || pl;
  if (fy) return fy;
  return dateStr || "—";
}

function columnLabelForRow(r: Record<string, unknown>, preferDetail: boolean): string {
  if (preferDetail) {
    const pl = r.period_label;
    if (pl !== undefined && pl !== null && String(pl).trim() !== "") return String(pl);
    const d = r.date;
    if (d !== undefined && d !== null && String(d).trim() !== "") return String(d).slice(0, 10);
  }
  const fy = r.fiscal_year;
  if (fy !== undefined && fy !== null && String(fy).trim() !== "") return String(fy);
  const pl = r.period_label;
  if (pl !== undefined && pl !== null && String(pl).trim() !== "") return String(pl);
  const d = r.date;
  if (d !== undefined && d !== null) return String(d);
  return "—";
}

export function pivotFundamentalSeries(
  records: Record<string, unknown>[],
  options?: PivotFundamentalOptions
): PivotedFundamental {
  if (!Array.isArray(records) || records.length === 0) {
    return { columnLabels: [], rows: [] };
  }

  const explicitQuarterly = records.some((r) => String(r.period ?? "").toLowerCase() === "quarterly");
  const useDetailedColumns = explicitQuarterly || countDuplicateFiscalYears(records);
  const sorted = sortRecords(records, useDetailedColumns);

  const columnLabels = sorted.map((r) =>
    options?.quarterlyColumnLabels ? buildQuarterlyColumnLabel(r) : columnLabelForRow(r, useDetailedColumns)
  );

  const metricKeys = new Set<string>();
  for (const r of sorted) {
    for (const k of Object.keys(r)) {
      if (COLUMN_META.has(k)) continue;
      metricKeys.add(k);
    }
  }

  const keys = Array.from(metricKeys).sort((a, b) => a.localeCompare(b));

  const rows = keys.map((key) => ({
    key,
    label: getRoicLineItemLabel(key),
    values: sorted.map((r) => r[key] ?? null),
  }));

  return { columnLabels, rows };
}
