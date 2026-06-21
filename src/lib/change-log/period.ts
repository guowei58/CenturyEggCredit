/** Compute the update window for a Change Log refresh. */
export function computeChangeLogUpdatePeriod(
  now: Date,
  lastChangeLogUpdatedAt: string | null
): { periodStart: Date; periodEnd: Date; periodLabel: string; isFirstUpdate: boolean } {
  const periodEnd = now;
  let periodStart: Date;

  if (lastChangeLogUpdatedAt) {
    const parsed = Date.parse(lastChangeLogUpdatedAt);
    periodStart = Number.isFinite(parsed) ? new Date(parsed) : subtractCalendarDays(startOfLocalDay(now), 7);
  } else {
    periodStart = subtractCalendarDays(startOfLocalDay(now), 7);
  }

  return {
    periodStart,
    periodEnd,
    periodLabel: formatChangeLogPeriodLabel(periodStart, periodEnd),
    isFirstUpdate: !lastChangeLogUpdatedAt,
  };
}

export type ChangeLogPeriodBounds = {
  periodStart: Date;
  periodEnd: Date;
};

export function parseStrictTimestamp(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? t : null;
}

/** Inclusive timestamp window — rejects missing or unparseable dates. */
export function isTimestampInChangeLogPeriod(ts: number, bounds: ChangeLogPeriodBounds): boolean {
  return ts >= bounds.periodStart.getTime() && ts <= bounds.periodEnd.getTime();
}

/** True when a parseable publication timestamp falls strictly inside the update window. */
export function isPublishedAtInChangeLogPeriod(
  publishedAt: string | null | undefined,
  bounds: ChangeLogPeriodBounds
): boolean {
  const ts = parseStrictTimestamp(publishedAt);
  if (ts == null) return false;
  return isTimestampInChangeLogPeriod(ts, bounds);
}

import { parseIsoFilingDateUtcMs } from "@/lib/sec-edgar";

/** UTC calendar date YYYY-MM-DD — matches SEC filingDate fields. */
export function toUtcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * SEC filing dates are date-only (YYYY-MM-DD). Inclusive from the period start UTC calendar day
 * through the period end UTC calendar day (filings lack acceptance timestamps).
 */
export function isFilingDateInChangeLogPeriod(filingDate: string, bounds: ChangeLogPeriodBounds): boolean {
  const key = filingDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  if (parseIsoFilingDateUtcMs(key) == null) return false;
  const startKey = toUtcDateKey(bounds.periodStart);
  const endKey = toUtcDateKey(bounds.periodEnd);
  return key >= startKey && key <= endKey;
}

/** Calendar date key YYYY-MM-DD within the update window. */
export function isCalendarDateKeyInChangeLogPeriod(dateKey: string, bounds: ChangeLogPeriodBounds): boolean {
  const key = dateKey.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return isFilingDateInChangeLogPeriod(key, bounds);
}

export function calendarDateKeyFromTimestamp(ts: number): string {
  return toIsoDateKey(new Date(ts));
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function subtractCalendarDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - days);
  return out;
}

export function formatChangeLogPeriodLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" };
  const a = start.toLocaleDateString("en-US", opts);
  const b = end.toLocaleDateString("en-US", opts);
  return `${a}–${b}`;
}

export function toIsoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDateWithinPeriod(isoDate: string, periodStart: Date, periodEnd: Date): boolean {
  return isCalendarDateKeyInChangeLogPeriod(isoDate, { periodStart, periodEnd });
}
