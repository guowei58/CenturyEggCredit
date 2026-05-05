import { describe, expect, it } from "vitest";
import { DEBT_FOOTNOTE_GOLDEN_FIXTURES } from "@/lib/secDebtFootnoteExtract.fixtures";
import { extractDebtFootnote } from "@/lib/secDebtSectionExtract";

function synthetic10kNotes(opts: { weirdDebtHeading?: boolean } = {}): string {
  const debtHeading = opts.weirdDebtHeading
    ? "<b>Note 9 — Other Financing Matters</b>"
    : "<b>Note 7 — Debt</b>";
  return `
<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 3 — Investments</b></p>
<p>Marketable securities are classified as available-for-sale.</p>
<p>${debtHeading}</p>
<p>Our credit agreement provides for a revolving credit facility and a term loan.</p>
<p>The senior notes mature in 2030. Principal amount outstanding reflects borrowings.</p>
<table>
<tr><td>Revolving credit facility</td><td>100</td></tr>
<tr><td>Term loan</td><td>200</td></tr>
<tr><td>Total debt</td><td>300</td></tr>
</table>
<p><b>Note 11 — Goodwill and Intangible Assets</b></p>
<p>Goodwill is tested for impairment annually.</p>
</body></html>`;
}

describe("extractDebtFootnote", () => {
  it("skips Notes header inside TOC #fragment link so real Notes are scanned (QVCGA-style 10-Q)", async () => {
    const tocRow = `<a style="color:#0000ff;font-family:times;text-decoration:underline" href="#noteslice">Notes to Condensed Consolidated Financial Statements (unaudited)</a>`;
    const realNotes = `<div><span style="font-weight:700">Notes to Condensed Consolidated Financial Statements</span></div>
<p><span style="font-weight:700">(7) Long-Term Debt</span></p>
<p>Debt is summarized as follows.</p>
<table><tr><td>Senior secured notes</td><td>Total long-term debt</td></tr></table>`;
    const pad = `<p>${"padding ".repeat(80)}</p>\n`;
    const html = `<html><body>
<p>PART I FINANCIAL INFORMATION</p>
<p>ITEM 1. FINANCIAL STATEMENTS</p>
<table><tr><td>${tocRow}</td></tr></table>
<p>Item 2. Management's Discussion and Analysis (TOC row — not a bold MD&A ceiling)</p>
${pad}
${realNotes}
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-Q" });
    expect(r.confidence).toMatch(/High|Medium/);
    expect(r.extractedFootnoteText.toLowerCase()).toContain("long-term debt");
    expect(r.extractedFootnoteText.toLowerCase()).toContain("senior secured");
  });

  it("extends scan when Notes appear after an early Item 8–9 outline (inline XBRL style)", async () => {
    const earlyToc = `
<p><b>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</b></p>
<p>See pages 36-73.</p>
<p><span style="font-weight:700">SIGNATURES</span></p>
<p>Placeholder signatures block often appears in TOC shells before real statements.</p>`.trim();
    const pad = `<p>${"x".repeat(120)}</p>\n`.repeat(40);
    const notesBlock = `
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 10 — Debt</b></p>
<p>Our revolving credit facility and term loan are described below.</p>
<table><tr><td>Total debt</td><td>100</td></tr></table>
<p><b>Note 11 — Goodwill</b></p>
<p>Goodwill impairment testing.</p>`;
    const html = `<html><body>${earlyToc}${pad}${notesBlock}</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.warnings.some((w) => /expanded scan/i.test(w))).toBe(true);
    expect(r.confidence).toMatch(/High|Medium/);
    expect(r.extractedFootnoteText.toLowerCase()).toContain("revolving credit facility");
  });

  it("maps notes then selects debt note with heading + body + table evidence (10-K)", async () => {
    const r = await extractDebtFootnote(synthetic10kNotes(), {
      formType: "10-K",
      filingDate: "2026-03-01",
      accessionNumber: "0000000000-26-000001",
    });
    expect(r.confidence).toMatch(/High|Medium/);
    expect(r.debtNoteTitle).toBeTruthy();
    expect(r.extractedFootnoteText.toLowerCase()).toContain("revolving credit facility");
    expect(r.extractedFootnoteText.toLowerCase()).toContain("total debt");
    expect(r.candidates.length).toBeGreaterThan(1);
    expect(r.candidates.some((c) => c.snippet)).toBe(true);
    expect(r.diagnosticReport?.notesSectionFound).toBe(true);
    expect(r.diagnosticReport?.itemFloorFound).toBe(true);
    expect(r.financialStatementNotes.length).toBeGreaterThanOrEqual(3);
  });

  it("uses table-anchor fallback when the debt heading is nonstandard", async () => {
    const r = await extractDebtFootnote(synthetic10kNotes({ weirdDebtHeading: true }), { formType: "10-K" });
    expect(r.extractionMethod).toBe("debt_table_anchor");
    expect(r.extractedFootnoteHtml.toLowerCase()).toContain("revolving credit facility");
    expect(r.diagnosticReport?.debtTableAnchorsDetectedInNotes).toBe(true);
  });

  it("does not pick a mis-bound Note — Goodwill heading whose body opens with OCI roll-forward (GTN-style)", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 1 — Summary</b></p>
<p>Organization and basis of presentation.</p>
<p><b>Note 13 "Goodwill and Intangible Assets."</b></p>
<p>67 Accumulated Other Comprehensive Loss . Our accumulated other comprehensive loss balances as of December 31, 2025 consisted of adjustments to our pension asset and the related income tax effects including interest rate caps.</p>
<p><b>Note 2 — Accounting Policies</b></p>
<p>Estimates are required.</p>
<p><b>Note 4 — Debt</b></p>
<p>Our credit agreement provides a revolving credit facility.</p>
<table><tr><td>Total debt</td><td>500</td></tr></table>
<p><b>Note 14 — Income Taxes</b></p>
<p>Tax disclosure.</p>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.debtNoteTitle?.toLowerCase()).toContain("debt");
    expect(r.extractedFootnoteText.toLowerCase()).toContain("credit agreement");
    expect(r.extractedFootnoteText.toLowerCase()).toContain("total debt");
  });

  it("does not emit primary footnote HTML on Low confidence synthetic (no debt cues)", async () => {
    const html = `
<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 1 — Organization</b></p>
<p>We were incorporated in Delaware.</p>
<p><b>Note 2 — Summary of Significant Accounting Policies</b></p>
<p>Estimates and judgments are required.</p>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(["Low", "Not Found"]).toContain(r.confidence);
    expect(r.extractedFootnoteHtml).toBe("");
    expect(r.reviewRequired).toBe(true);
  });

  it("detects split-span numeric headings like `11.` / title (CAR 10-Q style)", async () => {
    const html = `<html><body>
<p>PART I FINANCIAL INFORMATION</p>
<p>ITEM 1. FINANCIAL STATEMENTS</p>
<p>Notes to Condensed Consolidated Financial Statements</p>
<p><span style="font-weight:700">11.</span><span style="font-weight:700"> Long-term Corporate Debt and Borrowing Arrangements</span></p>
<p>Revolving credit facilities and term loans.</p>
<table><tr><td>Total debt</td><td>200</td></tr></table>
<p><span style="font-weight:700">12.</span><span style="font-weight:700"> Debt Under Vehicle Programs</span></p>
<p>Program debt.</p>
<table><tr><td>Vehicle debt</td><td>50</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-Q" });
    const n11 = r.financialStatementNotes.find((n) => n.noteNumber === "11");
    expect(n11?.heading).toMatch(/long[\s-]*term\s+corporate\s+debt/i);
    expect(r.candidates.some((c) => c.noteNumber === "11")).toBe(true);
  });

  it("detects split-span numeric headings with `&nbsp;` gap (CAR / Workiva)", async () => {
    const html = `<html><body>
<p>Notes to Condensed Consolidated Financial Statements</p>
<p><span style="font-weight:700">11.</span>&nbsp;<span style="font-weight:700"> Long-term Corporate Debt and Borrowing Arrangements</span></p>
<p>Revolving credit facilities.</p>
<table><tr><td>Total debt</td><td>100</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-Q" });
    expect(r.financialStatementNotes.some((n) => n.noteNumber === "11")).toBe(true);
  });

  it("detects split-span headings when bold is only on parent `<p>` (inherited)", async () => {
    const html = `<html><body>
<p>Notes to Condensed Consolidated Financial Statements</p>
<p style="font-weight:bold;margin-top:12pt"><span>11.</span>&nbsp;<span> Long-term Corporate Debt and Borrowing Arrangements</span></p>
<p>Credit agreement and revolving facility.</p>
<table><tr><td>Total debt</td><td>100</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-Q" });
    expect(r.financialStatementNotes.some((n) => n.noteNumber === "11")).toBe(true);
    expect(r.candidates.some((c) => c.noteNumber === "11")).toBe(true);
  });

  it("drops MD&A-style Note N to our consolidated financial statements lines as false headings", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p>Note 8 to our consolidated financial statements for the year ended December 31, 2025 included elsewhere in this Annual Report on Form 10-K for more information.</p>
<p><b>8. Long-term debt, net</b></p>
<p>2028 Notes and senior secured convertible notes.</p>
<table><tr><td>Long-term debt</td><td>190</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.financialStatementNotes.some((n) => n.noteNumber === "8")).toBe(true);
    expect(
      r.financialStatementNotes.every(
        (n) => !/\bincluded elsewhere in this annual report\b/i.test(n.heading),
      ),
    ).toBe(true);
  });

  it("keeps a real numeric debt note when prose cites another Note N to our consolidated statements mid-body", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>8. Long-term debt, net</b></p>
<p>Allocation details. See Note 5 to our consolidated financial statements for lease accounting.</p>
<table><tr><td>Senior notes</td><td>100</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.financialStatementNotes.some((n) => n.noteNumber === "8")).toBe(true);
  });

  it("10-K notes region is not clipped at inline Item 2 MD&A prose (notes live under Item 8 after real Item 2)", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p>Additional detail appears in Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations.</p>
<p><b>8. Long-term debt, net</b></p>
<p>Senior secured convertible notes.</p>
<table><tr><td>Long-term debt</td><td>190</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.financialStatementNotes.some((n) => n.noteNumber === "8")).toBe(true);
    expect(r.diagnosticReport?.detectedNoteHeadings?.some((h) => /long[\s-]*term\s+debt/i.test(h))).toBe(true);
  });

  it("drops MD&A cite “Note N of the Notes to Consolidated Financial Statements included in Item 8…” as a heading", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p>Note 2 of the Notes to Consolidated Financial Statements included in Item 8 of this Annual Report on Form 10-K for accounting policies.</p>
<p><b>8. Long-term debt, net</b></p>
<p>Convertible notes due 2028.</p>
<table><tr><td>Principal</td><td>190</td></tr></table>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.financialStatementNotes.some((n) => n.noteNumber === "8")).toBe(true);
    expect(r.financialStatementNotes.every((n) => !/\bnote\s+2\s+of\s+the\s+notes\s+to\b/i.test(n.heading))).toBe(true);
  });

  it("does not treat HTZ-style numbered table footnotes inside Note 7 as separate note headings", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 7-Debt</b></p>
<p>The Company's debt consists of the following ($ in millions) as of December 31, 2025.</p>
<table><tr><td>Revolver</td><td>500</td></tr><tr><td>Total debt</td><td>500</td></tr></table>
<p>(2) Reflects the unamortized discount associated with the Exchange Feature 2030, net of accretive interest.</p>
<p>(13) Other vehicle debt is primarily comprised of borrowings.</p>
<p>(1) Debt issuance costs are amortized to non-vehicle interest expense.</p>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.financialStatementNotes.filter((n) => n.noteNumber === "7").length).toBeLessThanOrEqual(1);
    expect(r.candidates[0]?.noteNumber).toBe("7");
    expect(r.noteNumber).toBe("7");
  });

  it("filters additional HTZ-style table footnotes (maturity reference, debt discounts, disclosed-in-note pointers)", async () => {
    const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 7-Debt</b></p>
<p>The Company's debt consists of the following ($ in millions).</p>
<table><tr><td>Facility</td><td>500</td></tr><tr><td>Total debt</td><td>500</td></tr></table>
<p>(12) Maturity reference is to the earlier "expected final maturity date" as opposed to the subsequent "legal final maturity date."</p>
<p>(3) The Exchange Feature 2030, as disclosed in Note 7, "Debt," was bifurcated as a derivative.</p>
<p>(1) Debt discounts, including the initial fair value, at issuance, of the Exchange Feature 2030, and debt issuance costs are amortized.</p>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.candidates[0]?.noteNumber).toBe("7");
    expect(r.noteNumber).toBe("7");
  });

  it("boosts overlap when inline XBRL debt TextBlock content matches note body", async () => {
    const inner =
      "the company maintains a revolving credit facility and term loan agreement disclosed in the accompanying notes";
    const html = `
<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 4 — Debt</b></p>
<p>${inner}</p>
<table><tr><td>Total debt</td><td>50</td></tr></table>
<ix:nonNumeric name="us-gaap:DebtDisclosureTextBlock">${inner}</ix:nonNumeric>
</body></html>`;
    const r = await extractDebtFootnote(html, { formType: "10-K" });
    expect(r.diagnosticReport?.inlineXbrlDebtTextBlocksFound).toBe(true);
    expect(r.confidence).toMatch(/High|Medium/);
  });

  it("adds filing_summary_report path when FilingSummary.xml references a debt exhibit slice", async () => {
    const html = synthetic10kNotes();
    const filingSummaryXml = `<?xml version="1.0"?>
<FilingSummary>
  <Reports>
    <Report>
      <ShortName>R17.htm</ShortName>
      <LongName>Note — Long-Term Debt</LongName>
      <HtmlFileName>R17.htm</HtmlFileName>
    </Report>
  </Reports>
</FilingSummary>`;
    const reportHtml = `<html><body>
<p>Our credit agreement provides for a revolving credit facility and a term loan.</p>
<p>The senior notes mature in 2030.</p>
</body></html>`;
    const fetchSecArchiveText = async (url: string) => {
      if (url.includes("FilingSummary.xml")) return filingSummaryXml;
      if (url.includes("R17.htm")) return reportHtml;
      return null;
    };
    const r = await extractDebtFootnote(html, {
      formType: "10-K",
      cik: "0000320193",
      accessionNumber: "0000320193-26-000001",
      fetchSecArchiveText,
    });
    expect(r.diagnosticReport?.filingSummaryXmlFound).toBe(true);
    expect(r.diagnosticReport?.extractionPathsFired?.includes("filing_summary_report")).toBe(true);
  });
});

describe("DEBT_FOOTNOTE_GOLDEN_FIXTURES", () => {
  it("has at least 50 labeled scenarios for manual EDGAR verification", () => {
    expect(DEBT_FOOTNOTE_GOLDEN_FIXTURES.length).toBeGreaterThanOrEqual(50);
  });
});
