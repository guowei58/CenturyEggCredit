/**
 * Fiscal-period parsing and rolling-quarter filters for Period Financials saved documents
 * (management presentations and earnings transcripts).
 */

import path from "path";

import {
  isPeriodFinancialsEarningsTranscriptFilename,
  isPeriodFinancialsMgmtPresentationFilename,
} from "@/lib/kpi-workspace-sources";

export type ParsedFiscalQuarter = { quarter: 1 | 2 | 3 | 4; year: number };

export const PERIOD_FINANCIALS_INGEST_MAX_QUARTERS = 4;

/** Sortable key: higher = more recent. Q4 FY2025 → 2025*4+3. */
export function fiscalQuarterSortKey(period: ParsedFiscalQuarter): number {
  return period.year * 4 + (period.quarter - 1);
}

/**
 * Parse fiscal quarter from Period Financials saved-document basenames, e.g.
 * `GEN_earnings-transcript_1Q_2026.txt`, `GEN-Q2-2026-mgmt-presentation.pdf`,
 * `MSFT_earnings-transcript_2024-Q3.txt`, `roic-earnings-transcript-2025Q3.txt`.
 */
export function parseFiscalPeriodFromPeriodFinancialsFilename(filename: string): ParsedFiscalQuarter | null {
  const base = path.basename(filename.replace(/\\/g, "/"));
  const n = base.toLowerCase();

  let m = /_(?:fy|([1-4])q)_(\d{4})/i.exec(n);
  if (m) {
    if (m[1]) {
      const quarter = parseInt(m[1], 10);
      if (quarter >= 1 && quarter <= 4) {
        return { quarter: quarter as 1 | 2 | 3 | 4, year: parseInt(m[2]!, 10) };
      }
    }
    return { quarter: 4, year: parseInt(m[2]!, 10) };
  }

  m = /(\d{4})-q([1-4])/i.exec(n);
  if (m) {
    return { quarter: parseInt(m[2]!, 10) as 1 | 2 | 3 | 4, year: parseInt(m[1]!, 10) };
  }

  m = /-q([1-4])-(\d{4})/i.exec(n);
  if (m) {
    return { quarter: parseInt(m[1]!, 10) as 1 | 2 | 3 | 4, year: parseInt(m[2]!, 10) };
  }

  m = /-fy-(\d{4})/i.exec(n);
  if (m) {
    return { quarter: 4, year: parseInt(m[1]!, 10) };
  }

  m = /roic-earnings-transcript-(\d{4})q([1-4])/i.exec(n);
  if (m) {
    return { quarter: parseInt(m[2]!, 10) as 1 | 2 | 3 | 4, year: parseInt(m[1]!, 10) };
  }

  return null;
}

export function isPeriodFinancialsIngestFilename(filename: string): boolean {
  const base = path.basename(filename.replace(/\\/g, "/"));
  return (
    isPeriodFinancialsMgmtPresentationFilename(base) || isPeriodFinancialsEarningsTranscriptFilename(base)
  );
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/**
 * Keep only management presentations / earnings transcripts whose fiscal period falls in the
 * rolling last `maxQuarters` quarters relative to the newest parseable file in `relPaths`.
 */
export function filterPeriodFinancialsPathsToLastNQuarters(
  relPaths: string[],
  maxQuarters: number = PERIOD_FINANCIALS_INGEST_MAX_QUARTERS
): Set<string> {
  const parsed: { norm: string; key: number }[] = [];
  for (const rel of relPaths) {
    const base = path.basename(rel.replace(/\\/g, "/"));
    if (!isPeriodFinancialsIngestFilename(base)) continue;
    const period = parseFiscalPeriodFromPeriodFinancialsFilename(base);
    if (!period) continue;
    parsed.push({ norm: normalizeRelPath(rel), key: fiscalQuarterSortKey(period) });
  }
  if (parsed.length === 0) return new Set();

  const maxKey = Math.max(...parsed.map((p) => p.key));
  const minKey = maxKey - Math.max(0, maxQuarters - 1);
  return new Set(parsed.filter((p) => p.key >= minKey).map((p) => p.norm));
}

/** Earnings transcripts only — same rolling-quarter window as {@link filterPeriodFinancialsPathsToLastNQuarters}. */
export function filterEarningsTranscriptPathsToLastNQuarters(
  relPaths: string[],
  maxQuarters: number = PERIOD_FINANCIALS_INGEST_MAX_QUARTERS
): Set<string> {
  const transcripts = relPaths.filter((rel) => {
    const base = path.basename(rel.replace(/\\/g, "/"));
    return isPeriodFinancialsEarningsTranscriptFilename(base);
  });
  return filterPeriodFinancialsPathsToLastNQuarters(transcripts, maxQuarters);
}
