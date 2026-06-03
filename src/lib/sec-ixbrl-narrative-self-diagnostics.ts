import type { EarningsPressReleasePayload, IxbrlEbitdaReconciliation, IxbrlExtractionDiagnostics } from "@/lib/sec-ixbrl-mdna-tables";

export type NarrativeDiagSeverity = "pass" | "info" | "warn";

export type NarrativeDiagFinding = {
  id: string;
  severity: NarrativeDiagSeverity;
  message: string;
};

export type IxbrlNarrativeDiagnosticPayload = {
  ok: true;
  mdnaHeadingFound?: boolean;
  mdnaSectionHtml?: string | null;
  mdnaSectionHtmlTruncated?: boolean;
  diagnostics?: IxbrlExtractionDiagnostics | null;
  earningsPressRelease?: EarningsPressReleasePayload | null;
  ebitdaReconciliation?: IxbrlEbitdaReconciliation | null;
  selected?: { form?: string };
  /**
   * When set, earnings checks use adjacent Form 8-K ranking only (batch sweep), not embedded Exhibit HTML
   * from the single-filing API.
   */
  batchEarnings?: { adjacent8kCandidates: number } | null;
};

export type IxbrlNarrativeSelfDiagnostics = {
  mdna: { findings: NarrativeDiagFinding[] };
  earningsPressRelease: { findings: NarrativeDiagFinding[] };
  /** True when there are no `warn` findings in that bucket (`info` / `pass` only). */
  mdnaOk: boolean;
  earningsOk: boolean;
};

function mdnaForm(d: IxbrlExtractionDiagnostics | null | undefined, selectedForm: string | undefined): string {
  const f = (d?.form ?? selectedForm ?? "").trim();
  return f;
}

function mdnaSpan(d: IxbrlExtractionDiagnostics | null | undefined): number | null {
  const a = d?.mdna?.startOffset;
  const b = d?.mdna?.endOffset;
  if (typeof a !== "number" || typeof b !== "number" || b <= a) return null;
  return b - a;
}

/**
 * Client-side checks for the MD&A HTML box and the earnings press-release box on SEC XBRL Financials.
 * Uses the same fields as `/api/sec/xbrl/ixbrl-mdna-tables/` so results match what the tab renders.
 */
export function runIxbrlNarrativeSelfDiagnostics(payload: IxbrlNarrativeDiagnosticPayload): IxbrlNarrativeSelfDiagnostics {
  const mdnaFindings: NarrativeDiagFinding[] = [];
  const erFindings: NarrativeDiagFinding[] = [];

  const diag = payload.diagnostics ?? null;
  const form = mdnaForm(diag, payload.selected?.form);
  const is10K = form.includes("10-K");
  const is10Q = form.includes("10-Q");
  const mdnaFound = diag?.mdna?.found === true || payload.mdnaHeadingFound === true;
  const rangeUsed = diag?.mdna?.rangeUsedForExtraction === true;
  const htmlLen = (payload.mdnaSectionHtml ?? "").trim().length;
  const span = mdnaSpan(diag);

  if (!mdnaFound) {
    mdnaFindings.push({
      id: "mdna_no_heading",
      severity: "warn",
      message: "No MD&A section heading/bounds were detected in the filing HTML (Item 7 / Item 2).",
    });
  } else if (!rangeUsed) {
    mdnaFindings.push({
      id: "mdna_range_suppressed",
      severity: "info",
      message:
        "MD&A bounds were uncertain or filtered (range not used for extraction), so the tab may omit the HTML excerpt while still showing diagnostics.",
    });
    if (htmlLen === 0) {
      mdnaFindings.push({
        id: "mdna_no_html_expected",
        severity: "info",
        message: "No MD&A HTML is expected until boundaries are high/medium enough (or include-uncertain is enabled server-side).",
      });
    }
  } else {
    mdnaFindings.push({
      id: "mdna_range_ok",
      severity: "pass",
      message: `MD&A text range is active (${diag?.mdna?.startLabel ?? "start"} → ${diag?.mdna?.endLabel ?? "end"}, confidence ${diag?.mdna?.confidence ?? "—"}).`,
    });
    if (htmlLen === 0) {
      mdnaFindings.push({
        id: "mdna_range_but_empty_html",
        severity: "warn",
        message: "Range was used but MD&A HTML is empty — check DOM structure or collectElementsInTextRange coverage.",
      });
    } else {
      mdnaFindings.push({
        id: "mdna_html_present",
        severity: "pass",
        message: `MD&A HTML excerpt length ${htmlLen.toLocaleString()} characters.`,
      });
    }
  }

  if (payload.mdnaSectionHtmlTruncated) {
    mdnaFindings.push({
      id: "mdna_truncated",
      severity: "info",
      message: "MD&A HTML was truncated by the server size cap; open the full filing for the complete section.",
    });
  }

  if (rangeUsed && diag?.mdna?.confidence === "low") {
    mdnaFindings.push({
      id: "mdna_low_confidence",
      severity: "warn",
      message: "MD&A boundary confidence is low — verify the excerpt against the SEC filing.",
    });
  }

  if (rangeUsed && span != null) {
    if (is10Q && span < 2_500) {
      mdnaFindings.push({
        id: "mdna_short_span_10q",
        severity: "warn",
        message: `10-Q MD&A span is only ${span.toLocaleString()} characters — possible early Item 3 / Part II false match (compare to prior fix for hyphen "Item 3 - Quantitative" cites).`,
      });
    }
    if (is10K && span < 4_000) {
      mdnaFindings.push({
        id: "mdna_short_span_10k",
        severity: "warn",
        message: `10-K MD&A span is only ${span.toLocaleString()} characters — may be a TOC row, incorporation stub, or wrong end anchor.`,
      });
    }
  }

  if (rangeUsed && diag && span != null && span >= 4000 && diag.tables.taggedInMdnaRange === 0 && diag.tables.totalInDocument > 0) {
    mdnaFindings.push({
      id: "mdna_no_tables_in_range",
      severity: "info",
      message:
        "No tables fell inside the MD&A slice (tables may live outside the detected range or be layout-only) — EBITDA/table extraction may use the wider document.",
    });
  }

  const pr = payload.earningsPressRelease;
  if (pr) {
    const prLen = (pr.html ?? "").trim().length;
    const url = (pr.source.primaryDocumentUrl ?? "").trim();
    if (prLen < 200) {
      erFindings.push({
        id: "earnings_html_tiny",
        severity: "warn",
        message: "Earnings exhibit body HTML is very short after extraction — possible fetch/parse issue.",
      });
    } else {
      erFindings.push({
        id: "earnings_html_ok",
        severity: "pass",
        message: `Earnings body HTML ${prLen.toLocaleString()} characters (${pr.exhibitClass === "slide_deck" ? "slide deck" : "press release"} heuristic).`,
      });
    }
    if (!url) {
      erFindings.push({
        id: "earnings_missing_url",
        severity: "warn",
        message: "Earnings payload is missing primaryDocumentUrl — “Open on SEC.gov” may not appear.",
      });
    } else {
      erFindings.push({
        id: "earnings_url_ok",
        severity: "pass",
        message: "SEC primary document URL is present for the earnings exhibit.",
      });
    }
    if (pr.truncated) {
      erFindings.push({
        id: "earnings_truncated",
        severity: "info",
        message: "Earnings HTML was truncated by the response size cap.",
      });
    }
  } else if (payload.batchEarnings != null) {
    const n = payload.batchEarnings.adjacent8kCandidates;
    if (n <= 0) {
      erFindings.push({
        id: "batch_no_adjacent_8k",
        severity: "warn",
        message:
          "No Form 8-K filings fell in the ranked earnings-adjacency window for this period (period end or filing date) — the tab may not find a press release for this quarter either.",
      });
    } else {
      erFindings.push({
        id: "batch_adjacent_8k",
        severity: "info",
        message: `${n} adjacent Form 8-K candidate(s) in the earnings window (batch mode does not fetch Exhibit 99 — open this filing in the tab for full HTML checks).`,
      });
    }
  } else {
    const scan = payload.ebitdaReconciliation?.nearby8KScan;
    if (scan && scan.candidatesTried > 0) {
      erFindings.push({
        id: "earnings_scan_no_embed",
        severity: "info",
        message: `No earnings Exhibit 99 / 8-K HTML was embedded after ranking ${scan.candidatesTried} adjacent Form 8-K candidate(s).`,
      });
    } else {
      erFindings.push({
        id: "earnings_not_resolved",
        severity: "info",
        message: "No earnings press release / Exhibit 99 block in this response (scan may not have run for this filing).",
      });
    }
    const sug = payload.ebitdaReconciliation?.suggestedPressRelease;
    if (sug?.primaryDocumentUrl) {
      erFindings.push({
        id: "earnings_suggested_link",
        severity: "info",
        message: "A suggested Form 8-K link is available below the empty state — open it on SEC.gov if needed.",
      });
    }
  }

  const mdnaOk = !mdnaFindings.some((f) => f.severity === "warn");
  const earningsOk = !erFindings.some((f) => f.severity === "warn");

  return { mdna: { findings: mdnaFindings }, earningsPressRelease: { findings: erFindings }, mdnaOk, earningsOk };
}
