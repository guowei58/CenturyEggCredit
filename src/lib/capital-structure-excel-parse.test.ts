import { describe, expect, it } from "vitest";

import {
  findCapitalStructureSheetName,
  filterImportableCapitalStructureSecurities,
  parseCapitalStructureSheetRows,
  rowHasImportableCusip,
} from "@/lib/capital-structure-excel-parse";

describe("findCapitalStructureSheetName", () => {
  it("prefers Capital Structure tab", () => {
    expect(findCapitalStructureSheetName(["Notes", "Capital Structure", "Sources"])).toBe("Capital Structure");
  });
});

describe("parseCapitalStructureSheetRows", () => {
  it("parses instrument rows and skips summary lines", () => {
    const rows = [
      ["Instrument", "Seniority", "Amount", "Coupon", "Maturity", "Price", "YTW", "CUSIP"],
      ["Exit Term Loan B", "1L Secured", "2000", "SOFR+600", "Nov 2031", "~95", "~7.8%", "123456789"],
      ["Total Secured Debt", "", "5400", "", "", "", "", ""],
      ["5.000% Sr Sec Notes", "1L Secured", "3400", "5.000%", "Nov 2029", "~82", "~8.4%", ""],
    ];

    const parsed = parseCapitalStructureSheetRows(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      name: "Exit Term Loan B",
      cusip: "123456789",
      coupon: "SOFR+600",
      price: "~95",
      yieldToMaturity: "~7.8%",
      maturityLabel: "Nov 2031",
      instrumentType: "Term Loan",
      lienLevel: "1st Lien",
    });
    expect(parsed[1]).toMatchObject({
      name: "5.000% Sr Sec Notes",
      cusip: null,
      instrumentType: "Senior Secured Notes",
    });
  });

  it("parses Gen Digital-style rows with index column and ranking", () => {
    const rows = [
      ["#", "Instrument", "Issuer", "", "", "Ranking"],
      [
        "Senior Secured Credit Facilities — Amended & Restated Credit Agreement (First Lien)",
        "",
        "",
        "",
        "",
        "",
      ],
      ["1", "Revolving Credit Facility (undrawn)", "Gen Digital Inc.", "", "", "1L Secured"],
      ["2", "Extended Term A Facility", "Gen Digital Inc.", "", "", "1L Secured"],
      ["5", "6.75% Senior Notes due 2027", "Gen Digital Inc.", "", "", "Sr. Unsecured"],
      ["Total Term Loans (1L Secured)", "", "", "", "", ""],
    ];

    const parsed = parseCapitalStructureSheetRows(rows);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      name: "Revolving Credit Facility (undrawn)",
      instrumentType: "Revolver",
      lienLevel: "1st Lien",
      issuer: "Gen Digital Inc.",
    });
    expect(parsed[2]).toMatchObject({
      name: "6.75% Senior Notes due 2027",
      coupon: "6.75%",
      maturityLabel: "2027",
      lienLevel: "Unsecured",
      instrumentType: "Notes",
    });
  });

  it("filters to rows with CUSIP only for securities import", () => {
    const rows = [
      ["Instrument", "Seniority", "CUSIP"],
      ["Exit Term Loan B", "1L Secured", ""],
      ["5.000% Sr Sec Notes", "1L Secured", "123456789"],
      ["Total Secured Debt", "", ""],
    ];
    const parsed = parseCapitalStructureSheetRows(rows);
    const importable = filterImportableCapitalStructureSecurities(parsed);
    expect(parsed).toHaveLength(2);
    expect(importable).toHaveLength(1);
    expect(importable[0]?.name).toBe("5.000% Sr Sec Notes");
    expect(rowHasImportableCusip("N/A")).toBe(false);
    expect(rowHasImportableCusip("123456789")).toBe(true);
  });
});
