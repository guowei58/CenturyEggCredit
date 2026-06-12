import { describe, expect, it } from "vitest";
import {
  debtFootnoteHasDisplayHtml,
  pickBestUnverifiedDebtCandidate,
  shouldRollForwardDebtFrom10K,
} from "@/lib/debt-footnote-display";
import type { DebtSectionExtractResult } from "@/lib/secDebtSectionExtract";

function baseExtract(overrides: Partial<DebtSectionExtractResult>): DebtSectionExtractResult {
  return {
    anchorLabel: null,
    anchorIndexInFullDoc: 0,
    tablesHtml: "",
    plainTextFallback: "",
    note: "",
    debtNoteTitle: null,
    noteNumber: null,
    confidence: "Not Found",
    extractionMethod: "direct_heading_match",
    extractedFootnoteText: "",
    extractedFootnoteHtml: "",
    debtTablesMarkdown: [],
    startHeading: null,
    endHeading: null,
    warnings: [],
    candidates: [],
    htmlStartOffset: 0,
    htmlEndOffset: 0,
    financialStatementNotes: [],
    ...overrides,
  };
}

describe("debt-footnote-display", () => {
  it("detects display HTML from footnote or tables", () => {
    expect(debtFootnoteHasDisplayHtml(baseExtract({}))).toBe(false);
    expect(
      debtFootnoteHasDisplayHtml(
        baseExtract({ extractedFootnoteHtml: `<p>${"x".repeat(100)}</p>` })
      )
    ).toBe(true);
  });

  it("requests 10-K roll-forward for empty 10-Q Low/Not Found", () => {
    expect(shouldRollForwardDebtFrom10K("10-K", baseExtract({ confidence: "Low" }))).toBe(false);
    expect(shouldRollForwardDebtFrom10K("10-Q", baseExtract({ confidence: "Low" }))).toBe(true);
    expect(shouldRollForwardDebtFrom10K("10-Q", baseExtract({ confidence: "Not Found" }))).toBe(true);
    expect(
      shouldRollForwardDebtFrom10K(
        "10-Q",
        baseExtract({
          confidence: "High",
          extractedFootnoteHtml: `<table>${"a".repeat(100)}</table>`,
        })
      )
    ).toBe(false);
  });

  it("picks unverified candidate with debt title and score", () => {
    const pick = pickBestUnverifiedDebtCandidate(
      baseExtract({
        candidates: [
          {
            noteNumber: "6",
            titleRaw: "Note 6 - Debt",
            headingScore: 80,
            bodyDebtIndicators: 4,
            debtLexiconHits: 5,
            bodyWordCount: 100,
            debtLexiconDensity: 0.05,
            combinedScore: 80,
            totalDebtScore: 84,
            snippet: "Senior notes due 2027.",
          },
        ],
      })
    );
    expect(pick?.titleRaw).toContain("Debt");
  });
});
