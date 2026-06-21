import { describe, expect, it } from "vitest";
import {
  computeChangeLogUpdatePeriod,
  formatChangeLogPeriodLabel,
  isCalendarDateKeyInChangeLogPeriod,
  isFilingDateInChangeLogPeriod,
  isPublishedAtInChangeLogPeriod,
  subtractCalendarDays,
} from "./period";

describe("computeChangeLogUpdatePeriod", () => {
  it("uses seven calendar days before today for first update", () => {
    const now = new Date(2026, 5, 20, 15, 30, 0);
    const { periodStart, periodEnd, isFirstUpdate } = computeChangeLogUpdatePeriod(now, null);
    expect(isFirstUpdate).toBe(true);
    expect(periodEnd).toBe(now);
    expect(periodStart.getFullYear()).toBe(2026);
    expect(periodStart.getMonth()).toBe(5);
    expect(periodStart.getDate()).toBe(13);
  });

  it("starts subsequent updates from lastChangeLogUpdatedAt", () => {
    const now = new Date(2026, 5, 20, 12, 0, 0);
    const last = "2026-06-10T18:00:00.000Z";
    const { periodStart, isFirstUpdate } = computeChangeLogUpdatePeriod(now, last);
    expect(isFirstUpdate).toBe(false);
    expect(periodStart.toISOString()).toBe(last);
  });

  it("formats period label", () => {
    const start = new Date(2026, 5, 13);
    const end = new Date(2026, 5, 20);
    expect(formatChangeLogPeriodLabel(start, end)).toBe("June 13, 2026–June 20, 2026");
  });

  it("subtractCalendarDays", () => {
    const d = new Date(2026, 5, 20);
    const out = subtractCalendarDays(d, 7);
    expect(out.getDate()).toBe(13);
  });
});

describe("strict change log date cutoffs", () => {
  const periodStart = new Date(2026, 5, 13, 0, 0, 0);
  const periodEnd = new Date(2026, 5, 20, 15, 30, 0);
  const bounds = { periodStart, periodEnd };

  it("rejects missing publication dates", () => {
    expect(isPublishedAtInChangeLogPeriod(null, bounds)).toBe(false);
    expect(isPublishedAtInChangeLogPeriod("", bounds)).toBe(false);
    expect(isPublishedAtInChangeLogPeriod("not-a-date", bounds)).toBe(false);
  });

  it("rejects articles before period start", () => {
    expect(isPublishedAtInChangeLogPeriod("2026-06-10T12:00:00.000Z", bounds)).toBe(false);
  });

  it("accepts articles within the window", () => {
    expect(isPublishedAtInChangeLogPeriod("2026-06-15T12:00:00.000Z", bounds)).toBe(true);
  });

  it("rejects SEC filings before start calendar day", () => {
    expect(isFilingDateInChangeLogPeriod("2026-06-12", bounds)).toBe(false);
  });

  it("accepts SEC filings on start calendar day", () => {
    expect(isFilingDateInChangeLogPeriod("2026-06-13", bounds)).toBe(true);
  });

  it("rejects invalid calendar date keys", () => {
    expect(isCalendarDateKeyInChangeLogPeriod("June 15", bounds)).toBe(false);
  });
});
