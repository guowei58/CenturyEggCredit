import { describe, expect, it } from "vitest";
import { quarterlyEarningsPackageCoverage } from "@/lib/bulk-earnings-package";
import type { PeriodFinancialsFilingLabelRow } from "@/lib/period-financials-roic";

const filings: PeriodFinancialsFilingLabelRow[] = [
  {
    form: "10-Q",
    filingDate: "2025-11-01",
    reportDate: "2025-09-30",
    accessionNumber: "0000000001-25-000001",
    primaryDocument: "q3.htm",
  },
  {
    form: "10-Q",
    filingDate: "2025-08-01",
    reportDate: "2025-06-30",
    accessionNumber: "0000000001-25-000002",
    primaryDocument: "q2.htm",
  },
];

describe("quarterlyEarningsPackageCoverage", () => {
  it("is incomplete when no saved documents match batch-save stems", () => {
    const r = quarterlyEarningsPackageCoverage("MSFT", filings, ["MSFT_other_doc.pdf"], 2);
    expect(r.complete).toBe(false);
    expect(r.periodsFound).toBe(0);
    expect(r.periodsExpected).toBe(2);
  });

  it("is complete when each period has at least one batch-save document", () => {
    const saved = [
      "MSFT_earnings-transcript_2Q_2025.txt",
      "MSFT_10-Q_1Q_2025.html",
    ];
    const r = quarterlyEarningsPackageCoverage("MSFT", filings, saved, 2);
    expect(r.complete).toBe(true);
    expect(r.periodsFound).toBe(2);
  });

  it("treats partial coverage as incomplete", () => {
    const r = quarterlyEarningsPackageCoverage(
      "MSFT",
      filings,
      ["MSFT_mgmt-presentation_2Q_2025.pdf"],
      2
    );
    expect(r.complete).toBe(false);
    expect(r.periodsFound).toBe(1);
  });
});
