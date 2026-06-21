import { describe, expect, it } from "vitest";

import {
  filterEarningsTranscriptPathsToLastNQuarters,
  filterPeriodFinancialsPathsToLastNQuarters,
  parseFiscalPeriodFromPeriodFinancialsFilename,
} from "@/lib/period-financials-ingest-filter";

describe("parseFiscalPeriodFromPeriodFinancialsFilename", () => {
  it("parses GEN-style transcript and presentation names", () => {
    expect(parseFiscalPeriodFromPeriodFinancialsFilename("GEN_earnings-transcript_1Q_2026.txt")).toEqual({
      quarter: 1,
      year: 2026,
    });
    expect(parseFiscalPeriodFromPeriodFinancialsFilename("GEN_earnings-transcript_FY_2025.txt")).toEqual({
      quarter: 4,
      year: 2025,
    });
    expect(parseFiscalPeriodFromPeriodFinancialsFilename("GEN-Q2-2026-mgmt-presentation.pdf")).toEqual({
      quarter: 2,
      year: 2026,
    });
    expect(parseFiscalPeriodFromPeriodFinancialsFilename("roic-earnings-transcript-2025Q3.txt")).toEqual({
      quarter: 3,
      year: 2025,
    });
  });
});

describe("filterPeriodFinancialsPathsToLastNQuarters", () => {
  it("keeps only the rolling last four quarters", () => {
    const paths = [
      "GEN_earnings-transcript_1Q_2025.txt",
      "GEN_earnings-transcript_2Q_2025.txt",
      "GEN_earnings-transcript_3Q_2025.txt",
      "GEN_earnings-transcript_1Q_2026.txt",
      "GEN_earnings-transcript_2Q_2026.txt",
      "GEN-Q3-2023-mgmt-presentation.pdf",
      "GEN-Q1-2026-mgmt-presentation.pdf",
    ];
    const allowed = filterPeriodFinancialsPathsToLastNQuarters(paths, 4);
    expect(allowed.has("gen_earnings-transcript_2q_2026.txt")).toBe(true);
    expect(allowed.has("gen_earnings-transcript_1q_2026.txt")).toBe(true);
    expect(allowed.has("gen_earnings-transcript_3q_2025.txt")).toBe(true);
    expect(allowed.has("gen_earnings-transcript_2q_2025.txt")).toBe(true);
    expect(allowed.has("gen_earnings-transcript_1q_2025.txt")).toBe(false);
    expect(allowed.has("gen-q1-2026-mgmt-presentation.pdf")).toBe(true);
    expect(allowed.has("gen-q3-2023-mgmt-presentation.pdf")).toBe(false);
  });
});

describe("filterEarningsTranscriptPathsToLastNQuarters", () => {
  it("ignores management presentations", () => {
    const paths = ["GEN-Q1-2026-mgmt-presentation.pdf", "GEN_earnings-transcript_1Q_2026.txt"];
    const allowed = filterEarningsTranscriptPathsToLastNQuarters(paths, 4);
    expect(allowed.has("gen_earnings-transcript_1q_2026.txt")).toBe(true);
    expect(allowed.has("gen-q1-2026-mgmt-presentation.pdf")).toBe(false);
  });
});
