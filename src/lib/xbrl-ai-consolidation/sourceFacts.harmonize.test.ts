import { describe, expect, it } from "vitest";

import { harmonizeCrossFilingAccrualSigns, mergeLatestFilingWins, type SourceFact } from "@/lib/xbrl-ai-consolidation/sourceFacts";

function sf(
  o: Pick<SourceFact, "kind" | "concept" | "periodLabel" | "value"> & Partial<Omit<SourceFact, "kind" | "concept" | "periodLabel" | "value">>
): SourceFact {
  return {
    line: o.line ?? "Gain (Loss) on Disposition",
    filingDate: o.filingDate ?? "2024-02-01",
    form: o.form ?? "10-Q",
    accession: o.accession ?? "0000000000-24-000001",
    filename: o.filename ?? "x.xlsx",
    ...o,
  };
}

describe("harmonizeCrossFilingAccrualSigns", () => {
  it("negates 9M when Q1+Q2+Q3 matches the arithmetic opposite (Dec FY)", () => {
    const facts = mergeLatestFilingWins([
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets1",
        periodLabel: "2023-01-01 → 2023-03-31",
        value: 1.94,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets1",
        periodLabel: "2023-04-01 → 2023-06-30",
        value: 0,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets1",
        periodLabel: "2023-07-01 → 2023-09-30",
        value: 0,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets1",
        periodLabel: "2023-01-01 → 2023-09-30",
        value: -1.94,
      }),
    ]);
    harmonizeCrossFilingAccrualSigns(facts);
    const nineM = facts.find((f) => f.periodLabel === "2023-01-01 → 2023-09-30");
    expect(nineM?.value).toBe(1.94);
  });

  it("negates FY when full-year equals negative of Q1+Q2+Q3+Q4", () => {
    const facts = mergeLatestFilingWins([
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets2",
        periodLabel: "2023-01-01 → 2023-03-31",
        value: 1.94,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets2",
        periodLabel: "2023-04-01 → 2023-06-30",
        value: 0,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets2",
        periodLabel: "2023-07-01 → 2023-09-30",
        value: 0,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets2",
        periodLabel: "2023-10-01 → 2023-12-31",
        value: -3.88,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets2",
        periodLabel: "2023-01-01 → 2023-12-31",
        value: 1.94,
      }),
    ]);
    harmonizeCrossFilingAccrualSigns(facts);
    const fy = facts.find((f) => f.periodLabel === "2023-01-01 → 2023-12-31");
    expect(fy?.value).toBeCloseTo(-1.94, 5);
  });

  it("fixes FY vs 9M and Q4 when FY has the wrong sign (10-K vs 10-Q bridge)", () => {
    const facts = mergeLatestFilingWins([
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets3",
        periodLabel: "2023-01-01 → 2023-09-30",
        value: 1.94,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets3",
        periodLabel: "2023-10-01 → 2023-12-31",
        value: -3.88,
      }),
      sf({
        kind: "is",
        concept: "us-gaap:GainLossOnDispositionOfAssets3",
        periodLabel: "2023-01-01 → 2023-12-31",
        value: 1.94,
      }),
    ]);
    harmonizeCrossFilingAccrualSigns(facts);
    const fy = facts.find((f) => f.periodLabel === "2023-01-01 → 2023-12-31");
    expect(fy?.value).toBeCloseTo(-1.94, 5);
    const nineM = facts.find((f) => f.periodLabel === "2023-01-01 → 2023-09-30");
    expect(fy!.value - nineM!.value).toBeCloseTo(-3.88, 5);
  });
});
