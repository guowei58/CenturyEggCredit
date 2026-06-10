import { describe, expect, it } from "vitest";
import {
  classifyDocumentType,
  companyNameMatchesText,
  computeFinalConfidence,
  inferPeriodFromText,
  parseFiscalPeriodToken,
  periodsMatch,
  prominentForeignTickerInTitle,
  reviewStatusForConfidence,
  roicPeriodToPresentationPeriod,
  tickerMatchesDocument,
} from "@/lib/presentations/discovery";
import type { PresentationValidationResult, RawPresentationLink } from "@/lib/presentations/discovery/types";

describe("parseFiscalPeriodToken", () => {
  it("parses Q3 2025 and 2025Q3", () => {
    expect(parseFiscalPeriodToken("Q3 2025")).toEqual({ label: "Q3 2025", quarter: 3, year: 2025 });
    expect(parseFiscalPeriodToken("2025Q3")).toEqual({ label: "Q3 2025", quarter: 3, year: 2025 });
    expect(parseFiscalPeriodToken("2Q 2026")).toEqual({ label: "Q2 2026", quarter: 2, year: 2026 });
  });

  it("converts roic period", () => {
    expect(roicPeriodToPresentationPeriod("2025Q3")).toBe("Q3 2025");
  });
});

describe("inferPeriodFromText", () => {
  it("finds quarter tokens in titles", () => {
    expect(inferPeriodFromText("Apple Q3 2025 Earnings Presentation")).toBe("Q3 2025");
    expect(inferPeriodFromText("Investor deck — Third Quarter 2024")).toBe("Q3 2024");
  });
});

describe("periodsMatch", () => {
  it("matches equivalent periods", () => {
    const fp = parseFiscalPeriodToken("Q2 2024")!;
    expect(periodsMatch(fp, "Q2 2024")).toBe(true);
    expect(periodsMatch(fp, "Q3 2024")).toBe(false);
  });
});

describe("companyNameMatchesText", () => {
  it("requires meaningful token overlap", () => {
    expect(companyNameMatchesText("Apple Inc.", "Apple reported Q3 results")).toBe(true);
    expect(companyNameMatchesText("Microsoft Corporation", "Apple reported Q3 results")).toBe(false);
  });

  it("does not match Gen Digital via generic substrings in another deck", () => {
    const similarwebSample =
      "Similarweb Q1 2026 Investor Presentation. We help brands understand digital consumer behavior and general market trends.";
    expect(
      companyNameMatchesText("Gen Digital Inc.", similarwebSample, {
        ticker: "GEN",
        title: "[PDF] SMWB Q1 2026 Investor Presentation",
      })
    ).toBe(false);
  });

  it("matches when ticker is present", () => {
    expect(
      companyNameMatchesText("Gen Digital Inc.", "GEN Q2 2026 results overview", {
        ticker: "GEN",
        title: "GEN Q2 2026 Investor Presentation",
      })
    ).toBe(true);
  });
});

describe("prominentForeignTickerInTitle", () => {
  it("detects another company ticker in the presentation title", () => {
    expect(prominentForeignTickerInTitle("[PDF] SMWB Q1 2026 Investor Presentation", "GEN")).toBe("SMWB");
    expect(prominentForeignTickerInTitle("GEN Q2 2026 Investor Presentation", "GEN")).toBeNull();
    expect(prominentForeignTickerInTitle("Q4 FY26 Presentation", "GEN")).toBeNull();
  });
});

describe("tickerMatchesDocument", () => {
  it("uses word boundaries", () => {
    expect(tickerMatchesDocument("GEN", "GEN Q2 2026 Investor Presentation", "", "")).toBe(true);
    expect(tickerMatchesDocument("GEN", "SMWB Q1 2026 Investor Presentation", "", "")).toBe(false);
  });
});

describe("classifyDocumentType", () => {
  it("detects presentations vs press releases", () => {
    expect(classifyDocumentType("Quarterly investor presentation overview", "Q3 Deck")).toBe("investor_presentation");
    expect(classifyDocumentType("Earnings press release", "Release")).toBe("press_release");
  });

  it("rejects earnings call transcripts", () => {
    expect(
      classifyDocumentType(
        "Operator: Welcome to the Gen Digital Q2 2026 earnings call. Question-and-answer session follows.",
        "[PDF] Q2 2026 Gen Digital Inc Earnings Call"
      )
    ).toBe("earnings_transcript");
    expect(classifyDocumentType("", "Q2 2026 Gen Digital Inc Earnings Call")).toBe("earnings_transcript");
  });
});

describe("reviewStatusForConfidence", () => {
  it("applies thresholds", () => {
    expect(reviewStatusForConfidence(90)).toBe("auto_accept");
    expect(reviewStatusForConfidence(70)).toBe("review");
    expect(reviewStatusForConfidence(50)).toBe("reject");
  });
});

describe("computeFinalConfidence", () => {
  const raw: RawPresentationLink = {
    url: "https://example.com/deck.pdf",
    title: "Q3 2025 Investor Presentation",
    source_page_url: "https://ir.example.com/presentations",
    source_type: "live_ir",
    file_type: "pdf",
    document_date: null,
    pre_score: 55,
    evidence: ["live_ir", "keyword:presentation"],
  };

  const validation: PresentationValidationResult = {
    downloaded: true,
    company_name_match: true,
    document_type: "investor_presentation",
    period_match: true,
    inferred_period: "Q3 2025",
    inferred_document_date: null,
    keyword_hits: ["investor presentation", "quarterly results"],
  };

  it("scores strong matches above auto-accept threshold", () => {
    const score = computeFinalConfidence(raw, validation, "Q3 2025");
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it("penalizes wrong company", () => {
    const score = computeFinalConfidence(raw, { ...validation, company_name_match: false }, "Q3 2025");
    expect(score).toBeLessThan(65);
  });

  it("penalizes earnings transcripts", () => {
    const score = computeFinalConfidence(
      { ...raw, source_type: "web_search", title: "Q2 2026 Gen Digital Inc Earnings Call" },
      {
        ...validation,
        document_type: "earnings_transcript",
        reject_reason: "Document classified as earnings call transcript, not slide deck",
      },
      "Q2 2026"
    );
    expect(score).toBeLessThan(65);
  });
});
