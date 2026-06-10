import { describe, expect, it } from "vitest";

import { compilerPeriodColumnHeader } from "@/lib/sec-xbrl-compiler-period-headers";
import { faceStatementToWorkbookShape } from "@/lib/sec-ixbrl-face-save-client";
import {
  faceStatementCellNumeric,
  compilerStatementRowEmphasis,
  faceStatementRowEmphasis,
  formatFaceEpsNative,
  formatFaceMonetaryMillions,
  formatFaceShareCountMillions,
  formatFaceStatementCell,
  isFaceEpsRow,
  isFaceShareCountRow,
} from "@/lib/sec-ixbrl-face-display";
import type { FacePresentedStatementRow } from "@/lib/sec-ixbrl-face-extract";

function row(partial: Partial<FacePresentedStatementRow> & Pick<FacePresentedStatementRow, "values">): FacePresentedStatementRow {
  return {
    concept: "html:revenues",
    label: "Total revenues",
    depth: 0,
    preferredLabelRole: null,
    valueFormat: "usd_millions",
    rawValues: { p1: null },
    visibleTextByPeriod: { p1: "518,234" },
    cellIxByPeriod: { p1: null },
    rowKind: "data",
    ...partial,
  };
}

describe("formatFaceStatementCell", () => {
  it("formats monetary values in $ millions (not raw thousands text)", () => {
    expect(formatFaceStatementCell(row({ values: { p1: 518.234 } }), "p1")).toBe("$518.23M");
  });

  it("formats EPS at native per-share scale", () => {
    const eps = row({
      concept: "html:earnings-per-share-diluted",
      label: "Diluted earnings per share",
      valueFormat: "native",
      values: { p1: 3.42 },
      visibleTextByPeriod: { p1: "3.42" },
    });
    expect(isFaceEpsRow(eps)).toBe(true);
    expect(formatFaceStatementCell(eps, "p1")).toBe("$3.42");
  });

  it("formats weighted-average Basic / Diluted share lines without a dollar sign", () => {
    const basic = row({
      concept: "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
      label: "Basic",
      valueFormat: "native",
      values: { p1: 998_891 },
      visibleTextByPeriod: { p1: "998,891" },
    });
    expect(isFaceEpsRow(basic)).toBe(false);
    expect(isFaceShareCountRow(basic, "income-statement")).toBe(true);
    expect(formatFaceStatementCell(basic, "p1", "income-statement")).toBe("998.89M");
  });

  it("recognizes face labels Basic / Diluted as EPS (no unit scaling)", () => {
    const basic = row({
      label: "Basic",
      valueFormat: "native",
      values: { p1: 0.00342 },
      visibleTextByPeriod: { p1: "3.42" },
    });
    expect(isFaceEpsRow(basic)).toBe(true);
    expect(formatFaceStatementCell(basic, "p1")).toBe("$3.42");
  });

  it("formats share counts in millions of shares", () => {
    const sh = row({
      concept: "html:weighted-average-shares",
      label: "Weighted average shares, diluted",
      valueFormat: "native",
      values: { p1: 24_380 },
      visibleTextByPeriod: { p1: "24,380" },
    });
    expect(isFaceShareCountRow(sh, "income-statement")).toBe(true);
    expect(formatFaceStatementCell(sh, "p1", "income-statement")).toBe("24.38M");
  });

  it("does not treat balance sheet lines with shares in the label as share counts", () => {
    const bsRow = row({
      concept: "us-gaap:CommonStockValue",
      label:
        "Common stock, no par value, authorized 2,200,000 shares, issued and outstanding 1,029,980 shares",
      valueFormat: "usd_millions",
      values: { p1: 19_165 },
      visibleTextByPeriod: { p1: "19,165" },
    });
    expect(isFaceShareCountRow(bsRow, "balance-sheet")).toBe(false);
    expect(formatFaceStatementCell(bsRow, "p1", "balance-sheet")).toBe("$19,165.00M");
  });

  it("compiler period headers prefer canonical short labels, else SEC prose", () => {
    expect(
      compilerPeriodColumnHeader(
        { label: "Year ended December 31, 2025", shortLabel: "FY25", end: "2025-12-31", start: null },
        "10-K"
      )
    ).toBe("FY25");
    expect(
      compilerPeriodColumnHeader(
        { label: "Three months ended June 28, 2024", end: "2024-06-28", start: "2024-04-01" },
        "10-Q"
      )
    ).toBe("Three months ended June 28, 2024");
  });

  it("workbook cells are numeric at the same scale as the on-screen grid", () => {
    const stmt = {
      id: "balance-sheet" as const,
      title: "Balance sheet",
      role: "balance",
      periods: [{ key: "p1", label: "Dec 31, 2025", shortLabel: "Dec 2025", end: "2025-12-31", start: null }],
      rows: [
        row({
          concept: "us-gaap:CommonStockValue",
          label:
            "Common shares, no par value, unlimited shares authorized, 373,464,760 issued and outstanding",
          valueFormat: "usd_millions",
          values: { p1: 10_542 },
          visibleTextByPeriod: { p1: "10,542" },
        }),
      ],
    };
    const r = stmt.rows[0]!;
    const wbRow = faceStatementToWorkbookShape(stmt, { form: "10-K", filingDate: "2025-12-31", accessionNumber: "x" })
      .rows[0]!;
    expect(faceStatementCellNumeric(r, "p1", "balance-sheet")).toBe(10_542);
    expect(wbRow.workbookCells?.p1).toBe(10_542);
    expect(formatFaceStatementCell(r, "p1", "balance-sheet")).toBe("$10,542.00M");
  });

  it("workbook share counts are millions of shares as numbers", () => {
    const basic = row({
      concept: "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
      label: "Basic",
      valueFormat: "native",
      values: { p1: 998_891 },
      visibleTextByPeriod: { p1: "998,891" },
    });
    expect(faceStatementCellNumeric(basic, "p1", "income-statement")).toBeCloseTo(998.891, 3);
  });
});

describe("formatFaceMonetaryMillions", () => {
  it("handles negatives", () => {
    expect(formatFaceMonetaryMillions(-12.5)).toBe("-$12.50M");
    expect(formatFaceMonetaryMillions(100)).toBe("$100.00M");
  });
});

describe("faceStatementRowEmphasis", () => {
  it("highlights income statement subtotals", () => {
    expect(faceStatementRowEmphasis({ label: "Gross profit", rowKind: "data" }, "income-statement")).toBe("subtotal");
    expect(faceStatementRowEmphasis({ label: "Net revenues", rowKind: "data" }, "income-statement")).toBe("subtotal");
    expect(faceStatementRowEmphasis({ label: "Total operating expenses", rowKind: "data" }, "income-statement")).toBe(
      "subtotal"
    );
    expect(faceStatementRowEmphasis({ label: "Operating income (loss)", rowKind: "data" }, "income-statement")).toBe(
      "subtotal"
    );
    expect(
      faceStatementRowEmphasis({ label: "Income (loss) before income taxes", rowKind: "data" }, "income-statement")
    ).toBe("subtotal");
    expect(faceStatementRowEmphasis({ label: "Sales and marketing", rowKind: "data" }, "income-statement")).toBe("normal");
  });

  it("highlights balance sheet and cash flow anchors", () => {
    expect(faceStatementRowEmphasis({ label: "Total assets", rowKind: "data" }, "balance-sheet")).toBe("subtotal");
    expect(faceStatementRowEmphasis({ label: "Current assets", rowKind: "data" }, "balance-sheet")).toBe("subtotal");
    expect(faceStatementRowEmphasis({ label: "Current liabilities", rowKind: "data" }, "balance-sheet")).toBe("subtotal");
    expect(
      faceStatementRowEmphasis(
        { label: "Net cash provided by operating activities", rowKind: "data" },
        "cash-flow"
      )
    ).toBe("subtotal");
  });

  it("treats parser headings separately from subtotals", () => {
    expect(faceStatementRowEmphasis({ label: "Operating expenses", rowKind: "heading" }, "income-statement")).toBe(
      "heading"
    );
  });
});

describe("compilerStatementRowEmphasis", () => {
  it("maps compiler statement keys to face emphasis rules", () => {
    expect(compilerStatementRowEmphasis("Gross profit", "income_statement")).toBe("subtotal");
    expect(compilerStatementRowEmphasis("Total assets", "balance_sheet")).toBe("subtotal");
    expect(compilerStatementRowEmphasis("Net cash provided by operating activities", "cash_flow")).toBe("subtotal");
  });
});

describe("formatFaceShareCountMillions", () => {
  it("scales thousands of shares to millions", () => {
    expect(formatFaceShareCountMillions(24_380)).toBe("24.38M");
  });
});

describe("formatFaceEpsNative", () => {
  it("shows negative EPS", () => {
    expect(formatFaceEpsNative(-0.12)).toBe("−$0.12");
  });
});
