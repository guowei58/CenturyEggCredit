import { describe, expect, it } from "vitest";
import {
  filterVisibleCompilerRows,
  isCompilerLineOnlyPlaceholder,
  looksLikeCompilerFootnoteNarrativeLine,
} from "@/lib/xbrl-compiler-display";

describe("xbrl-compiler-display", () => {
  it("detects line-only placeholder concepts", () => {
    expect(isCompilerLineOnlyPlaceholder("_:lineonly:file|BS|R12")).toBe(true);
    expect(isCompilerLineOnlyPlaceholder("us-gaap:Cash")).toBe(false);
  });

  it("detects footnote narrative labels", () => {
    expect(looksLikeCompilerFootnoteNarrativeLine("[1] Amounts may not add due to rounding.")).toBe(true);
    expect(looksLikeCompilerFootnoteNarrativeLine("Cash and cash equivalents")).toBe(false);
  });

  it("keeps workbook-backed rows even when all period cells are empty", () => {
    const rows = [
      { concept: "us-gaap:IncreaseDecreaseInDeferredRevenue", line: "Change in deferred revenue", _workbookLine: true },
      { concept: "us-gaap:Empty", line: "Empty line" },
    ];
    const out = filterVisibleCompilerRows(rows, ["3Q24", "FY24"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.concept).toBe("us-gaap:IncreaseDecreaseInDeferredRevenue");
  });

  it("keeps rows with any numeric period value", () => {
    const rows = [
      { concept: "us-gaap:Cash", line: "Cash", "1Q25": 100 },
      { concept: "us-gaap:Empty", line: "Empty line" },
    ];
    const out = filterVisibleCompilerRows(rows, ["1Q25", "2Q25"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.concept).toBe("us-gaap:Cash");
  });

  it("drops empty line-only and footnote rows", () => {
    const rows = [
      { concept: "_:lineonly:a|b|R1", line: "[1] Amounts may not add due to rounding." },
      { concept: "us-gaap:Debt", line: "Short-term borrowings", FY25: 500 },
    ];
    const out = filterVisibleCompilerRows(rows, ["FY25"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.line).toBe("Short-term borrowings");
  });
});
