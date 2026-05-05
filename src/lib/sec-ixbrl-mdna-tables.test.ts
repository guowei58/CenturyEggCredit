import { describe, expect, it } from "vitest";

import { isPlausibleDataTable, mergeDollarOnlyCellsInRow } from "@/lib/sec-ixbrl-mdna-tables";

describe("isPlausibleDataTable", () => {
  const prose = "We believe market conditions and execution risks described below could affect future performance.".repeat(
    3
  );

  it("rejects prose-only grids without digits in strict mode", () => {
    const rows = [
      ["Risk factor", prose.slice(0, 180)],
      ["Mitigation", prose.slice(180, 360)],
      ["Outlook", prose.slice(360, 540)],
    ];
    expect(isPlausibleDataTable(rows, 0)).toBe(false);
  });

  it("accepts MD&A-style prose grids in narrativeFinancialSection mode", () => {
    const rows = [
      ["Risk factor", prose.slice(0, 180)],
      ["Mitigation", prose.slice(180, 360)],
      ["Outlook", prose.slice(360, 540)],
    ];
    expect(isPlausibleDataTable(rows, 0, { narrativeFinancialSection: true })).toBe(true);
  });

  it("accepts very large prose cells in 2-column narrative tables (issuer-style)", () => {
    const long = `${prose.repeat(40)}`;
    const rows = Array.from({ length: 8 }, (_, i) => [`Label ${i}`, long.slice(i * 400, i * 400 + 12000)]);
    expect(isPlausibleDataTable(rows, 0, { narrativeFinancialSection: true })).toBe(true);
  });
});

describe("mergeDollarOnlyCellsInRow", () => {
  it("merges $ with the following numeric cell", () => {
    expect(mergeDollarOnlyCellsInRow(["QxH", "$", "5,936", "$", "2,357"])).toEqual(["QxH", "$5,936", "$2,357"]);
  });

  it("drops a redundant $ cell when the amount already starts with $", () => {
    expect(mergeDollarOnlyCellsInRow(["A", "$", "$1.2M"])).toEqual(["A", "$1.2M"]);
  });

  it("does not merge when $ is not alone", () => {
    expect(mergeDollarOnlyCellsInRow(["$ millions", "5,936"])).toEqual(["$ millions", "5,936"]);
  });

  it("treats NBSP-wrapped $ as a currency-only cell", () => {
    expect(mergeDollarOnlyCellsInRow(["QxH", "\u00a0$\u00a0", "5,936"])).toEqual(["QxH", "$5,936"]);
  });

  it("does not merge $ with an empty following cell", () => {
    expect(mergeDollarOnlyCellsInRow(["Label", "$", ""])).toEqual(["Label", "$", ""]);
  });
});
