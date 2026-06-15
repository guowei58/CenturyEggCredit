import { describe, expect, it } from "vitest";
import {
  buildPeriodFinancialsFilingLabels,
  filingPeriodLabelToRoicPeriod,
  formatPeriodFinancialsFilingLabel,
  periodLabelToFilenameSlug,
  selectLastNPeriodFinancialsFilings,
} from "@/lib/period-financials-roic";

describe("period-financials filing labels", () => {
  it("labels quarters after each 10-K as 3Q, 2Q, 1Q for the same FY", () => {
    const filings = [
      { accessionNumber: "k26", form: "10-K", filingDate: "2026-05-21", reportDate: "2026-04-03" },
      { accessionNumber: "q3", form: "10-Q", filingDate: "2026-02-06", reportDate: "2026-01-31" },
      { accessionNumber: "q2", form: "10-Q", filingDate: "2025-11-07", reportDate: "2025-10-31" },
      { accessionNumber: "q1", form: "10-Q", filingDate: "2025-08-13", reportDate: "2025-07-31" },
      { accessionNumber: "k25", form: "10-K", filingDate: "2025-05-15", reportDate: "2025-04-03" },
    ];
    const labels = buildPeriodFinancialsFilingLabels(filings);
    expect(labels.get("k26")).toBe("FY 2026");
    expect(labels.get("q3")).toBe("3Q 2026");
    expect(labels.get("q2")).toBe("2Q 2026");
    expect(labels.get("q1")).toBe("1Q 2026");
    expect(labels.get("k25")).toBe("FY 2025");
  });

  it("does not emit bare 10-Q labels for non-calendar period ends", () => {
    const filings = [
      { accessionNumber: "k22", form: "10-K", filingDate: "2022-05-20", reportDate: "2022-04-03" },
      { accessionNumber: "qA", form: "10-Q", filingDate: "2022-11-09", reportDate: "2022-10-31" },
      { accessionNumber: "qB", form: "10-Q", filingDate: "2022-08-05", reportDate: "2022-07-31" },
    ];
    const labels = buildPeriodFinancialsFilingLabels(filings);
    expect(labels.get("qA")).toBe("3Q 2022");
    expect(labels.get("qB")).toBe("2Q 2022");
    for (const v of labels.values()) {
      expect(v).not.toMatch(/10-Q/);
      expect(v).toMatch(/^(FY \d{4}|[123]Q \d{4})$/);
    }
  });

  it("formats dropdown rows with filing date prefix", () => {
    expect(formatPeriodFinancialsFilingLabel({ form: "10-Q", filingDate: "2025-08-13" }, "1Q 2026")).toBe(
      "2025-08-13 · 1Q 2026"
    );
  });

  it("maps fiscal period labels to Roic quarters", () => {
    expect(filingPeriodLabelToRoicPeriod("1Q 2026")).toBe("2026Q1");
    expect(filingPeriodLabelToRoicPeriod("3Q 2025")).toBe("2025Q3");
    expect(filingPeriodLabelToRoicPeriod("FY 2025", "2025-04-03")).toBe("2025Q2");
    // ixbrl period end (same as Period Financials tab) overrides bare filing date
    expect(filingPeriodLabelToRoicPeriod("FY 2025", "2025-04-03", "2025-05-15")).toBe("2025Q2");
  });

  it("selects newest labeled filings up to a cap", () => {
    const filings = [
      { accessionNumber: "q3", form: "10-Q", filingDate: "2026-02-06", reportDate: "2026-01-31" },
      { accessionNumber: "q2", form: "10-Q", filingDate: "2025-11-07", reportDate: "2025-10-31" },
      { accessionNumber: "k", form: "10-K", filingDate: "2025-05-15", reportDate: "2025-04-03" },
    ];
    const picked = selectLastNPeriodFinancialsFilings(filings, 2);
    expect(picked).toHaveLength(2);
    expect(picked.every((p) => p.periodLabel.match(/^(FY \d{4}|[123]Q \d{4})$/))).toBe(true);
  });

  it("builds filename slugs from period labels", () => {
    expect(periodLabelToFilenameSlug("1Q 2026")).toBe("1Q_2026");
  });
});
