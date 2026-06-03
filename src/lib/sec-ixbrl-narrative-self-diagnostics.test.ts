import { describe, expect, it } from "vitest";

import {
  runIxbrlNarrativeSelfDiagnostics,
  type IxbrlNarrativeDiagnosticPayload,
} from "@/lib/sec-ixbrl-narrative-self-diagnostics";

function baseDiag(
  opts: {
    form?: string;
    mdna?: Partial<NonNullable<IxbrlNarrativeDiagnosticPayload["diagnostics"]>["mdna"]>;
  } = {}
): NonNullable<IxbrlNarrativeDiagnosticPayload["diagnostics"]> {
  const form = opts.form ?? "10-Q";
  return {
    form,
    mdna: {
      found: true,
      startOffset: 10_000,
      endOffset: 28_000,
      startLabel: "ITEM 2",
      endLabel: "Item 3",
      confidence: "high",
      warnings: [],
      rangeUsedForExtraction: true,
      ...(opts.mdna ?? {}),
    },
    notes: { found: true },
    segmentNote: { found: false, warnings: [], rangeUsedForExtraction: false },
    tables: {
      totalInDocument: 40,
      taggedInMdnaRange: 2,
      taggedInSegmentRange: 0,
      included: 1,
      rejected: 0,
    },
    rejectionReasons: {},
  };
}

describe("runIxbrlNarrativeSelfDiagnostics — MD&A", () => {
  it("passes when range is used, confidence is high, and HTML is present", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      mdnaHeadingFound: true,
      mdnaSectionHtml: "<p>".repeat(400),
      mdnaSectionHtmlTruncated: false,
      diagnostics: baseDiag({ form: "10-Q" }),
      selected: { form: "10-Q" },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.mdnaOk).toBe(true);
    expect(r.mdna.findings.some((f) => f.id === "mdna_html_present" && f.severity === "pass")).toBe(true);
    expect(r.mdna.findings.some((f) => f.severity === "warn")).toBe(false);
  });

  it("warns when range is used but MD&A HTML is empty (slice/build failure)", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      mdnaHeadingFound: true,
      mdnaSectionHtml: "",
      diagnostics: baseDiag(),
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.mdnaOk).toBe(false);
    expect(r.mdna.findings.some((f) => f.id === "mdna_range_but_empty_html")).toBe(true);
  });

  it("warns on very short 10-Q span (likely false Item 3 boundary)", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      mdnaSectionHtml: "<p>x</p>",
      diagnostics: baseDiag({
        form: "10-Q",
        mdna: { startOffset: 100_000, endOffset: 101_500, rangeUsedForExtraction: true, confidence: "high" },
      }),
      selected: { form: "10-Q" },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.mdna.findings.some((f) => f.id === "mdna_short_span_10q")).toBe(true);
  });
});

describe("runIxbrlNarrativeSelfDiagnostics — earnings press release", () => {
  it("passes when exhibit HTML and URL look healthy", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      earningsPressRelease: {
        source: {
          form: "8-K",
          filingDate: "2026-05-01",
          accessionNumber: "000-00-000000",
          primaryDocument: "ex991earnings.htm",
          primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1/000/htm.htm",
          documentRole: "exhibit_99",
        },
        html: "<div>" + "body ".repeat(400) + "</div>",
        truncated: false,
        exhibitClass: "press_release",
      },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.earningsOk).toBe(true);
    expect(r.earningsPressRelease.findings.some((f) => f.id === "earnings_html_ok")).toBe(true);
  });

  it("reports info when no PR embedded but 8-K scan was attempted", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      ebitdaReconciliation: {
        status: "none",
        tables: [],
        nearby8KScan: { candidatesTried: 4 },
      },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.earningsPressRelease.findings.some((f) => f.id === "earnings_scan_no_embed")).toBe(true);
    expect(r.earningsOk).toBe(true);
  });

  it("warns when earnings HTML is barely present", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      earningsPressRelease: {
        source: {
          form: "8-K",
          filingDate: "2026-05-01",
          accessionNumber: "000-00-000000",
          primaryDocument: "empty.htm",
          primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1/000/e.htm",
        },
        html: "<p></p>",
        truncated: false,
      },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.earningsOk).toBe(false);
    expect(r.earningsPressRelease.findings.some((f) => f.id === "earnings_html_tiny")).toBe(true);
  });

  it("batch mode: warns when no adjacent 8-K candidates", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      diagnostics: baseDiag({ form: "10-Q" }),
      mdnaSectionHtml: "<p>x</p>".repeat(50),
      batchEarnings: { adjacent8kCandidates: 0 },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.earningsOk).toBe(false);
    expect(r.earningsPressRelease.findings.some((f) => f.id === "batch_no_adjacent_8k")).toBe(true);
  });

  it("batch mode: info when adjacent 8-K candidates exist", () => {
    const payload: IxbrlNarrativeDiagnosticPayload = {
      ok: true,
      diagnostics: baseDiag({ form: "10-Q" }),
      mdnaSectionHtml: "<p>x</p>".repeat(50),
      batchEarnings: { adjacent8kCandidates: 3 },
    };
    const r = runIxbrlNarrativeSelfDiagnostics(payload);
    expect(r.earningsOk).toBe(true);
    expect(r.earningsPressRelease.findings.some((f) => f.id === "batch_adjacent_8k" && f.severity === "info")).toBe(
      true
    );
  });
});
