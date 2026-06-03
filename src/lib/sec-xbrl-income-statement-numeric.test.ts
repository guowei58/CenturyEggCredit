import { describe, expect, it } from "vitest";

import { incomeStatementCellNumeric, incomeStatementValuesForExport } from "@/lib/sec-xbrl-income-statement-numeric";

const XBRL_NEGATED_TERSE_ROLE = "http://www.xbrl.org/2009/role/negatedTerseLabel";

describe("incomeStatementCellNumeric", () => {
  const pk = "2022-01-01..2022-12-31";

  it("prefers SEC display values when preferredLabel is negated (matches printed face)", () => {
    const row = {
      preferredLabelRole: XBRL_NEGATED_TERSE_ROLE,
      values: { [pk]: 700 },
      rawValues: { [pk]: -700 },
    };
    expect(incomeStatementCellNumeric(row, pk)).toBe(700);
  });

  it("prefers raw values on non-negated lines (prior behavior)", () => {
    const row = {
      preferredLabelRole: "http://www.xbrl.org/2003/role/terseLabel",
      values: { [pk]: 100 },
      rawValues: { [pk]: 100 },
    };
    expect(incomeStatementCellNumeric(row, pk)).toBe(100);
  });

  it("defaults to raw-first when preferredLabelRole is omitted", () => {
    expect(
      incomeStatementCellNumeric({ values: { [pk]: 1 }, rawValues: { [pk]: 2 } }, pk)
    ).toBe(2);
  });

  it("falls back when display absent but raw present", () => {
    const row = {
      preferredLabelRole: XBRL_NEGATED_TERSE_ROLE,
      values: { [pk]: null },
      rawValues: { [pk]: -700 },
    };
    expect(incomeStatementCellNumeric(row, pk)).toBe(-700);
  });

  it("projection across periods preserves negated-vs-raw rule per cell", () => {
    const periodKeys = [pk];
    expect(
      incomeStatementValuesForExport(
        {
          preferredLabelRole: XBRL_NEGATED_TERSE_ROLE,
          values: { [pk]: 700 },
          rawValues: { [pk]: -700 },
        },
        periodKeys
      )
    ).toEqual({ [pk]: 700 });
  });
});
