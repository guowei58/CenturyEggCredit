import { describe, expect, it } from "vitest";

import {
  coalesceDuplicateBalanceSheetConceptRows,
  dedupeBalanceSheetNearDuplicateCaptionRows,
  dedupeBalanceSheetPresentationNodes,
  mergeBalanceSheetPeriodCompatibleCaptionDuplicates,
  mergeTaxonomyPrefixDuplicateBalanceSheetRows,
} from "@/lib/sec-xbrl-balance-sheet-dedupe";

describe("coalesceDuplicateBalanceSheetConceptRows", () => {
  const pk = ["2024-03-31", "2023-12-31"];

  it("merges values when the same QName appears twice (first row empty, second has facts)", () => {
    const rows = [
      {
        concept: "us-gaap:Assets",
        label: "Assets",
        depth: 0,
        values: { [pk[0]!]: null, [pk[1]!]: null },
        rawValues: { [pk[0]!]: null, [pk[1]!]: null },
        normalizationByPeriod: { [pk[0]!]: null, [pk[1]!]: null },
      },
      {
        concept: "us-gaap:Cash",
        label: "Cash",
        depth: 1,
        values: { [pk[0]!]: 1e6, [pk[1]!]: 2e6 },
        rawValues: { [pk[0]!]: 1e6, [pk[1]!]: 2e6 },
        normalizationByPeriod: { [pk[0]!]: null, [pk[1]!]: null },
      },
      {
        concept: "us-gaap:Assets",
        label: "Assets",
        depth: 1,
        values: { [pk[0]!]: 100e6, [pk[1]!]: 90e6 },
        rawValues: { [pk[0]!]: 100e6, [pk[1]!]: 90e6 },
        normalizationByPeriod: { [pk[0]!]: null, [pk[1]!]: null },
      },
    ];
    const out = coalesceDuplicateBalanceSheetConceptRows(rows, pk);
    const assetRows = out.filter((r) => r.concept === "us-gaap:Assets");
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]!.values[pk[0]!]).toBe(100e6);
    expect(assetRows[0]!.values[pk[1]!]).toBe(90e6);
    expect(out.find((r) => r.concept === "us-gaap:Cash")).toBeDefined();
  });
});

describe("mergeTaxonomyPrefixDuplicateBalanceSheetRows", () => {
  const pk = ["fy18", "q319"] as const;

  it("merges MarketableSecurities into MarketableSecuritiesNoncurrent when duplicate / complementary periods (FICO-style)", () => {
    const rows = [
      {
        concept: "us-gaap:MarketableSecurities",
        label: "Marketable Securities",
        depth: 2,
        values: { fy18: null, q319: 20.05e6 },
        rawValues: { fy18: null, q319: 20.05e6 },
        normalizationByPeriod: { fy18: null, q319: null },
      },
      {
        concept: "us-gaap:MarketableSecuritiesNoncurrent",
        label: "Marketable Securities, Noncurrent",
        depth: 2,
        values: { fy18: 18.06e6, q319: 20.05e6 },
        rawValues: { fy18: 18.06e6, q319: 20.05e6 },
        normalizationByPeriod: { fy18: null, q319: null },
      },
    ];
    const out = mergeTaxonomyPrefixDuplicateBalanceSheetRows(rows, [...pk]);
    expect(out).toHaveLength(1);
    expect(out[0]!.concept).toBe("us-gaap:MarketableSecuritiesNoncurrent");
    expect(out[0]!.values.fy18).toBe(18.06e6);
    expect(out[0]!.values.q319).toBe(20.05e6);
  });

  it("does not merge when the same period has conflicting non-null amounts", () => {
    const rows = [
      {
        concept: "us-gaap:MarketableSecurities",
        label: "Marketable Securities",
        depth: 2,
        values: { fy18: 10e6, q319: 20e6 },
        rawValues: { fy18: 10e6, q319: 20e6 },
        normalizationByPeriod: { fy18: null, q319: null },
      },
      {
        concept: "us-gaap:MarketableSecuritiesNoncurrent",
        label: "Marketable Securities, Noncurrent",
        depth: 2,
        values: { fy18: 18e6, q319: 20e6 },
        rawValues: { fy18: 18e6, q319: 20e6 },
        normalizationByPeriod: { fy18: null, q319: null },
      },
    ];
    expect(mergeTaxonomyPrefixDuplicateBalanceSheetRows(rows, [...pk])).toHaveLength(2);
  });
});

describe("mergeBalanceSheetPeriodCompatibleCaptionDuplicates", () => {
  it("merges other long-term vs other investments with complementary and duplicate period values", () => {
    const pk = ["4q20", "1q22", "4q21", "2q22"];
    const rows = [
      {
        concept: "us-gaap:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 2,
        values: { "4q20": 1.06, "1q22": null, "4q21": 1.31, "2q22": null } as Record<string, number | null>,
        rawValues: { "4q20": 1.06, "1q22": null, "4q21": 1.31, "2q22": null },
        normalizationByPeriod: { "4q20": null, "1q22": null, "4q21": null, "2q22": null },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 2,
        values: { "4q20": null, "1q22": 1.32, "4q21": 1.31, "2q22": 1.29 } as Record<string, number | null>,
        rawValues: { "4q20": null, "1q22": 1.32, "4q21": 1.31, "2q22": 1.29 },
        normalizationByPeriod: { "4q20": null, "1q22": null, "4q21": null, "2q22": null },
      },
    ];
    const out = mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk);
    expect(out).toHaveLength(1);
    expect(out[0]!.values["4q20"]).toBe(1.06);
    expect(out[0]!.values["1q22"]).toBe(1.32);
    expect(out[0]!.values["4q21"]).toBe(1.31);
    expect(out[0]!.values["2q22"]).toBe(1.29);
    expect(out[0]!.label).toMatch(/long-term/i);
    expect(out[0]!.concept).toMatch(/OtherLongTermInvestments/);
  });

  it("does not merge when a period has conflicting amounts", () => {
    const pk = ["a", "b"];
    const rows = [
      {
        concept: "us-gaap:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 1,
        values: { a: 10, b: 5 },
        rawValues: { a: 10, b: 5 },
        normalizationByPeriod: { a: null, b: null },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 1,
        values: { a: 12, b: 5 },
        rawValues: { a: 12, b: 5 },
        normalizationByPeriod: { a: null, b: null },
      },
    ];
    expect(mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk)).toHaveLength(2);
  });

  it("merges two intangible assets net rows when captions match and periods are compatible", () => {
    const pk = ["a", "b"];
    const rows = [
      {
        concept: "fico:IntangibleAssetsNetOld",
        label: "Intangible assets, net",
        depth: 3,
        values: { a: null, b: null },
        rawValues: { a: null, b: null },
        normalizationByPeriod: { a: null, b: null },
      },
      {
        concept: "us-gaap:IntangibleAssetsNetExcludingGoodwill",
        label: "Intangible assets, net",
        depth: 3,
        values: { a: 9.24, b: 1.47 },
        rawValues: { a: 9.24, b: 1.47 },
        normalizationByPeriod: { a: null, b: null },
      },
    ];
    const out = mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk);
    expect(out).toHaveLength(1);
    expect(out[0]!.concept).toBe("us-gaap:IntangibleAssetsNetExcludingGoodwill");
    expect(out[0]!.values.a).toBe(9.24);
    expect(out[0]!.values.b).toBe(1.47);
  });

  it("does not merge rows at different depths", () => {
    const pk = ["a"];
    const rows = [
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 1,
        values: { a: 1 },
        rawValues: { a: 1 },
        normalizationByPeriod: { a: null },
      },
      {
        concept: "us-gaap:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 2,
        values: { a: null },
        rawValues: { a: null },
        normalizationByPeriod: { a: null },
      },
    ];
    expect(mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk)).toHaveLength(2);
  });

  it("does not merge affiliate-style line with successor cost method / other investments (keep two rows)", () => {
    const pk = ["2014", "2015", "2016q3", "2017q1"];
    const rows = [
      {
        concept: "fico:InvestmentsInAdvanceToAffiliates",
        label: "Investments in and Advance to Affiliates, Subsidiaries, Associates, and Joint Ventures, Total",
        depth: 2,
        values: { "2014": 11, "2015": 11, "2016q3": 11, "2017q1": null },
        rawValues: { "2014": 11, "2015": 11, "2016q3": 11, "2017q1": null },
        normalizationByPeriod: { "2014": null, "2015": null, "2016q3": null, "2017q1": null },
      },
      {
        concept: "us-gaap:CostMethodInvestments",
        label: "Cost method investments",
        depth: 2,
        values: { "2014": null, "2015": null, "2016q3": null, "2017q1": 10.5 },
        rawValues: { "2014": null, "2015": null, "2016q3": null, "2017q1": 10.5 },
        normalizationByPeriod: { "2014": null, "2015": null, "2016q3": null, "2017q1": null },
      },
    ];
    const out = mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk);
    expect(out).toHaveLength(2);
  });

  it("does not merge affiliate row with other investments when depth differs (still two rows)", () => {
    const pk = ["2016q3", "2017q1"];
    const rows = [
      {
        concept: "fico:Affil",
        label: "Investments in and Advance to Affiliates, Subsidiaries, Associates, and Joint Ventures, Total",
        depth: 2,
        values: { "2016q3": 11, "2017q1": null },
        rawValues: { "2016q3": 11, "2017q1": null },
        normalizationByPeriod: { "2016q3": null, "2017q1": null },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 3,
        values: { "2016q3": null, "2017q1": 10.5 },
        rawValues: { "2016q3": null, "2017q1": 10.5 },
        normalizationByPeriod: { "2016q3": null, "2017q1": null },
      },
    ];
    expect(mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk)).toHaveLength(2);
  });

  it("does not merge marketable securities with other investments when periods are complementary", () => {
    const pk = ["a", "b"];
    const rows = [
      {
        concept: "us-gaap:MarketableSecuritiesNoncurrent",
        label: "Marketable securities, noncurrent",
        depth: 2,
        values: { a: 5, b: null },
        rawValues: { a: 5, b: null },
        normalizationByPeriod: { a: null, b: null },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 2,
        values: { a: null, b: 6 },
        rawValues: { a: null, b: 6 },
        normalizationByPeriod: { a: null, b: null },
      },
    ];
    expect(mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk)).toHaveLength(2);
  });

  it("merges two all-empty other-investment placeholder rows (subset captions)", () => {
    const pk = ["a", "b", "c"];
    const rows = [
      {
        concept: "us-gaap:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 2,
        values: { a: null, b: null, c: null },
        rawValues: { a: null, b: null, c: null },
        normalizationByPeriod: { a: null, b: null, c: null },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 2,
        values: { a: null, b: null, c: null },
        rawValues: { a: null, b: null, c: null },
        normalizationByPeriod: { a: null, b: null, c: null },
      },
    ];
    const out = mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toMatch(/long-term/i);
  });

  it("merges all-empty other-investment placeholders when depth differs by 1", () => {
    const pk = ["a"];
    const rows = [
      {
        concept: "us-gaap:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 2,
        values: { a: null },
        rawValues: { a: null },
        normalizationByPeriod: { a: null },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 3,
        values: { a: null },
        rawValues: { a: null },
        normalizationByPeriod: { a: null },
      },
    ];
    expect(mergeBalanceSheetPeriodCompatibleCaptionDuplicates(rows, pk)).toHaveLength(1);
  });
});

describe("dedupeBalanceSheetPresentationNodes", () => {
  it("keeps first occurrence of each concept", () => {
    const nodes = [
      { concept: "us-gaap:Foo", depth: 0, label: "A", preferredLabelRole: null },
      { concept: "us-gaap:Bar", depth: 0, label: "B", preferredLabelRole: null },
      { concept: "us-gaap:Foo", depth: 1, label: "A2", preferredLabelRole: null },
    ];
    expect(dedupeBalanceSheetPresentationNodes(nodes)).toEqual([nodes[0], nodes[1]!]);
  });
});

describe("dedupeBalanceSheetNearDuplicateCaptionRows", () => {
  const pk = ["2024-09-30", "2023-09-30"];

  it("removes shorter caption when amounts match (investment-flavored)", () => {
    const rows = [
      {
        concept: "us-gaap:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 1,
        values: { [pk[0]!]: 12.5e6, [pk[1]!]: 10e6 },
      },
      {
        concept: "us-gaap:OtherInvestments",
        label: "Other investments",
        depth: 1,
        values: { [pk[0]!]: 12.5e6, [pk[1]!]: 10e6 },
      },
    ];
    const out = dedupeBalanceSheetNearDuplicateCaptionRows(rows, pk);
    expect(out).toHaveLength(1);
    expect(out[0]!.concept).toBe("us-gaap:OtherLongTermInvestments");
  });

  it("does not remove when labels are not in invest/security gate", () => {
    const rows = [
      {
        concept: "a:Cash",
        label: "Cash",
        depth: 1,
        values: { [pk[0]!]: 1, [pk[1]!]: 1 },
      },
      {
        concept: "b:RestrictedCash",
        label: "Restricted cash",
        depth: 1,
        values: { [pk[0]!]: 1, [pk[1]!]: 1 },
      },
    ];
    expect(dedupeBalanceSheetNearDuplicateCaptionRows(rows, pk)).toHaveLength(2);
  });

  it("keeps both when amounts differ", () => {
    const rows = [
      {
        concept: "a:OtherLongTermInvestments",
        label: "Other long-term investments",
        depth: 1,
        values: { [pk[0]!]: 10, [pk[1]!]: 9 },
      },
      {
        concept: "b:OtherInvestments",
        label: "Other investments",
        depth: 1,
        values: { [pk[0]!]: 11, [pk[1]!]: 9 },
      },
    ];
    expect(dedupeBalanceSheetNearDuplicateCaptionRows(rows, pk)).toHaveLength(2);
  });

  it("drops duplicate when captions differ only by noncurrent wording (marketable securities)", () => {
    const rows = [
      {
        concept: "us-gaap:MarketableSecurities",
        label: "Marketable securities",
        depth: 1,
        values: { [pk[0]!]: 42e6, [pk[1]!]: 40e6 },
      },
      {
        concept: "us-gaap:MarketableSecuritiesNoncurrent",
        label: "Marketable securities, noncurrent",
        depth: 1,
        values: { [pk[0]!]: 42e6, [pk[1]!]: 40e6 },
      },
    ];
    const out = dedupeBalanceSheetNearDuplicateCaptionRows(rows, pk);
    expect(out).toHaveLength(1);
    expect(out[0]!.concept).toBe("us-gaap:MarketableSecuritiesNoncurrent");
  });

  it("drops broader QName when same terse label and amounts (duplicate tagging)", () => {
    const rows = [
      {
        concept: "us-gaap:MarketableSecurities",
        label: "Marketable securities",
        depth: 1,
        values: { [pk[0]!]: 9, [pk[1]!]: 8 },
      },
      {
        concept: "us-gaap:MarketableSecuritiesNoncurrent",
        label: "Marketable securities",
        depth: 1,
        values: { [pk[0]!]: 9, [pk[1]!]: 8 },
      },
    ];
    const out = dedupeBalanceSheetNearDuplicateCaptionRows(rows, pk);
    expect(out).toHaveLength(1);
    expect(out[0]!.concept).toBe("us-gaap:MarketableSecuritiesNoncurrent");
  });
});
