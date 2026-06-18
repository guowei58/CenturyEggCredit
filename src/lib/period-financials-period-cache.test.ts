import { describe, expect, it, beforeEach } from "vitest";

import {
  clearPeriodFinancialsPeriodCacheAll,
  getPeriodFinancialsPeriodCache,
  patchPeriodFinancialsPeriodCache,
  periodFinancialsCacheKey,
} from "@/lib/period-financials-period-cache";

describe("period-financials-period-cache", () => {
  beforeEach(() => {
    clearPeriodFinancialsPeriodCacheAll();
  });

  it("keys by ticker and accession without dashes", () => {
    expect(periodFinancialsCacheKey("aapl", "0000320193-24-000123")).toBe("AAPL:000032019324000123");
  });

  it("stores and merges partial snapshots per period", () => {
    patchPeriodFinancialsPeriodCache("MSFT", "0000789019-24-000001", {
      ixErr: null,
      ixbrl: { ok: true, mdnaHeadingFound: true },
    });
    patchPeriodFinancialsPeriodCache("MSFT", "0000789019-24-000001", {
      face: { ok: true, statements: [] },
    });

    const snap = getPeriodFinancialsPeriodCache(periodFinancialsCacheKey("MSFT", "0000789019-24-000001"));
    expect(snap?.ixbrl).toEqual({ ok: true, mdnaHeadingFound: true });
    expect(snap?.face?.ok).toBe(true);
  });
});
