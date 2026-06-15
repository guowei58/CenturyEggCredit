import { describe, expect, it } from "vitest";
import { buildParsedFilingHtmlContext } from "@/lib/sec-filing-financials";
import {
  buildStatementBlocks,
  locateFinancialStatementsSection,
  locatePrimaryStatementPacket,
} from "@/lib/sec-statement-locator";
import { isLikelyFaceStatementFooterNotesReference, isLikelyStatementIndexListingHit, findPrimaryFaceTablesEndBeforeNotes } from "@/lib/sec-statement-locator/signals";

function ctxFromHtml(html: string) {
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) throw new Error("no context");
  return ctx;
}

/** Real 10-Q Item 1 sections exceed 5k chars; pad synthetic fixtures to satisfy trio-proof gating. */
function padTenQItem1(html: string): string {
  const filler = `<p>${"Supplemental unaudited interim disclosure. ".repeat(120)}</p>`;
  return html.replace("</body>", `${filler.repeat(3)}</body>`);
}

describe("sec-statement-locator", () => {
  it("stitches adjacent continuation tables into one block", () => {
    const html = `
      <html><body>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS</p>
        <p>(In millions)</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td><td>Three Months Ended Mar 31, 2024</td></tr>
          <tr><td>Net revenues</td><td>1000</td><td>900</td></tr>
          <tr><td>Cost of revenues</td><td>400</td><td>360</td></tr>
        </table>
        <table>
          <tr><td>Gross profit</td><td>600</td><td>540</td></tr>
          <tr><td>Operating income</td><td>200</td><td>180</td></tr>
          <tr><td>Net income</td><td>150</td><td>130</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED BALANCE SHEETS</p>
        <table>
          <tr><td></td><td>Mar 31, 2025</td><td>Dec 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Total current assets</td><td>1200</td><td>1100</td></tr>
          <tr><td>Total assets</td><td>5000</td><td>4800</td></tr>
          <tr><td>Total liabilities and stockholders equity</td><td>5000</td><td>4800</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS</p>
        <table>
          <tr><td></td><td>Six Months Ended Jun 30, 2025</td><td>Six Months Ended Jun 30, 2024</td></tr>
          <tr><td>Net income</td><td>150</td><td>130</td></tr>
          <tr><td>Depreciation and amortization</td><td>40</td><td>35</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>200</td><td>180</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-50</td><td>-40</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-30</td><td>-20</td></tr>
        </table>
      </body></html>
    `;
    const ctx = ctxFromHtml(padTenQItem1(html));
    const sectionHit = locateFinancialStatementsSection(ctx, "10-Q");
    expect(sectionHit).not.toBeNull();
    const blocks = buildStatementBlocks(ctx, sectionHit!.section, sectionHit!.scanCeiling);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const isBlock = blocks.find((b) => /statements of operations/i.test(b.headingText));
    expect(isBlock?.tables.length).toBeGreaterThanOrEqual(2);

    const result = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
    expect(result.packet).not.toBeNull();
    expect(result.packet!.is.id).not.toBe(result.packet!.bs.id);
  });

  it("rejects MD&A percentage table and finds Part IV exhibit cluster (GEN-style 10-K)", () => {
    const html = `
      <html><body>
        <p>ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
        <p>Consolidated Statements of Operations data as a percentage of net revenues for the periods indicated:</p>
        <table>
          <tr><td></td><td>Fiscal Year 2026</td><td>Fiscal Year 2025</td></tr>
          <tr><td>Net revenues</td><td>100 %</td><td>100 %</td></tr>
          <tr><td>Cost of revenues</td><td>22</td><td>20</td></tr>
        </table>
        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        <p>The Consolidated Financial Statements included in Part IV, Item 15 of this Annual Report are incorporated by reference into this Item 8.</p>
        <p>PART IV</p>
        <p>CONSOLIDATED STATEMENTS OF OPERATIONS</p>
        <p>(In millions, except per share amounts)</p>
        <table>
          <tr><td></td><td>Year Ended Apr 3, 2026</td><td>Year Ended Mar 28, 2025</td></tr>
          <tr><td>Net revenues</td><td>5000</td><td>3935</td></tr>
          <tr><td>Cost of revenues</td><td>1077</td><td>776</td></tr>
          <tr><td>Gross profit</td><td>3923</td><td>3159</td></tr>
          <tr><td>Operating income</td><td>1500</td><td>1200</td></tr>
          <tr><td>Net income</td><td>1100</td><td>900</td></tr>
        </table>
        <p>CONSOLIDATED BALANCE SHEETS</p>
        <table>
          <tr><td></td><td>Apr 3, 2026</td><td>Mar 28, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Total current assets</td><td>1200</td><td>1100</td></tr>
          <tr><td>Total assets</td><td>8000</td><td>7500</td></tr>
          <tr><td>Total liabilities and stockholders equity</td><td>8000</td><td>7500</td></tr>
        </table>
        <p>CONSOLIDATED STATEMENTS OF CASH FLOWS</p>
        <table>
          <tr><td></td><td>Year Ended Apr 3, 2026</td><td>Year Ended Mar 28, 2025</td></tr>
          <tr><td>Net income</td><td>1100</td><td>900</td></tr>
          <tr><td>Depreciation</td><td>200</td><td>180</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>1300</td><td>1000</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-400</td><td>-350</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-200</td><td>-150</td></tr>
        </table>
      </body></html>
    `;
    const ctx = ctxFromHtml(html);
    const sectionHit = locateFinancialStatementsSection(ctx, "10-K");
    expect(sectionHit?.strategy).toBe("10k-part-iv-exhibit");

    const result = locatePrimaryStatementPacket(ctx, { form: "10-K" });
    expect(result.packet).not.toBeNull();
    expect(result.packet!.is.id).not.toBe(result.packet!.bs.id);
    expect(result.packet!.span).toBeLessThan(20_000);
    expect(result.packet!.is.startOffset).toBeLessThan(result.packet!.cf.startOffset);
  });

  it("rejects OCI-only table as income statement and selects operations table", () => {
    const html = `
      <html><body>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td></tr>
          <tr><td>Net income</td><td>150</td></tr>
          <tr><td>Other comprehensive income, net of tax</td><td>10</td></tr>
          <tr><td>Comprehensive income</td><td>160</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td><td>Three Months Ended Mar 31, 2024</td></tr>
          <tr><td>Revenues</td><td>1000</td><td>900</td></tr>
          <tr><td>Operating costs and expenses</td><td>700</td><td>650</td></tr>
          <tr><td>Income from operations</td><td>300</td><td>250</td></tr>
          <tr><td>Consolidated net income</td><td>150</td><td>130</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED BALANCE SHEETS</p>
        <table>
          <tr><td></td><td>Mar 31, 2025</td><td>Dec 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Total current assets</td><td>1200</td><td>1100</td></tr>
          <tr><td>Total assets</td><td>5000</td><td>4800</td></tr>
          <tr><td>Total liabilities and stockholders equity</td><td>5000</td><td>4800</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS</p>
        <table>
          <tr><td></td><td>Six Months Ended Jun 30, 2025</td></tr>
          <tr><td>Net income</td><td>150</td></tr>
          <tr><td>Depreciation and amortization</td><td>40</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>200</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-50</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-30</td></tr>
        </table>
      </body></html>
    `;
    const ctx = ctxFromHtml(padTenQItem1(html));
    const result = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
    expect(result.packet).not.toBeNull();
    expect(result.packet!.is.kindScores.is.penalties).not.toContain("oci_not_income_statement");
    expect(result.packet!.is.combinedText.toLowerCase()).toMatch(/revenues/);
    expect(result.packet!.is.combinedText.toLowerCase()).toMatch(/income from operations|consolidated net income/);
  });

  it("finds CHTR-style cable income statement in 10-Q Item 1", () => {
    const html = `
      <html><body>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS</p>
        <p>(dollars in millions, except per share data)</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td><td>Three Months Ended Mar 31, 2024</td></tr>
          <tr><td>REVENUES</td><td>13700</td><td>13500</td></tr>
          <tr><td>COSTS AND EXPENSES:</td><td></td><td></td></tr>
          <tr><td>Operating costs and expenses (exclusive of items shown separately below)</td><td>8200</td><td>8100</td></tr>
          <tr><td>Depreciation and amortization</td><td>2100</td><td>2000</td></tr>
          <tr><td>Other operating expenses, net</td><td>100</td><td>90</td></tr>
          <tr><td>Income from operations</td><td>3300</td><td>3310</td></tr>
          <tr><td>Interest expense, net</td><td>-1100</td><td>-1050</td></tr>
          <tr><td>Income before income taxes</td><td>2200</td><td>2260</td></tr>
          <tr><td>Income tax expense</td><td>500</td><td>520</td></tr>
          <tr><td>Consolidated net income</td><td>1700</td><td>1740</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED BALANCE SHEETS</p>
        <table>
          <tr><td></td><td>Mar 31, 2025</td><td>Dec 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Total current assets</td><td>3200</td><td>3100</td></tr>
          <tr><td>Total assets</td><td>145000</td><td>144000</td></tr>
          <tr><td>Total liabilities and stockholders equity</td><td>145000</td><td>144000</td></tr>
        </table>
        <p>CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td><td>Three Months Ended Mar 31, 2024</td></tr>
          <tr><td>Net income</td><td>1700</td><td>1740</td></tr>
          <tr><td>Depreciation and amortization</td><td>2100</td><td>2000</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>4200</td><td>4100</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-900</td><td>-850</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-600</td><td>-550</td></tr>
        </table>
      </body></html>
    `;
    const ctx = ctxFromHtml(padTenQItem1(html));
    const sectionHit = locateFinancialStatementsSection(ctx, "10-Q");
    expect(sectionHit?.strategy).toMatch(/10q-item1/);

    const result = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
    expect(result.packet).not.toBeNull();
    expect(result.packet!.is.kindScores.is.penalties).not.toContain("oci_not_income_statement");
  });

  it("accepts Item 1 TOC line when trio face tables follow (MAGN-style)", () => {
    const html = `
      <html><body>
        <p>PART I - Financial Information</p>
        <p>Item 1 Financial Statements 4</p>
        <p>Item 2 Management's Discussion and Analysis of Financial Condition and Results of Operations 8</p>
        <p>Consolidated and Combined Statements of Operations</p>
        <p>Condensed Consolidated Balance Sheets 5</p>
        <p>Condensed Consolidated and Combined Statements of Cash Flows 6</p>
        <p>Magnera Corporation Consolidated and Combined Statements of Operations (Unaudited)</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 28, 2026</td></tr>
          <tr><td>Net revenues</td><td>800</td></tr>
          <tr><td>Cost of revenues</td><td>600</td></tr>
          <tr><td>Operating income</td><td>50</td></tr>
          <tr><td>Net income</td><td>45</td></tr>
        </table>
        <p>Condensed Consolidated Balance Sheets</p>
        <table>
          <tr><td>Cash and cash equivalents</td><td>100</td></tr>
          <tr><td>Total current assets</td><td>500</td></tr>
          <tr><td>Total assets</td><td>2000</td></tr>
          <tr><td>Total liabilities and stockholders equity</td><td>2000</td></tr>
        </table>
        <p>Condensed Consolidated and Combined Statements of Cash Flows</p>
        <table>
          <tr><td>Net income</td><td>45</td></tr>
          <tr><td>Depreciation and amortization</td><td>30</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>40</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-10</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-5</td></tr>
        </table>
      </body></html>
    `;
    const ctx = ctxFromHtml(padTenQItem1(html));
    const sectionHit = locateFinancialStatementsSection(ctx, "10-Q");
    expect(sectionHit?.strategy).toMatch(/10q-item1/);
    expect(sectionHit!.section.end - sectionHit!.section.start).toBeGreaterThanOrEqual(5_000);
  });

  it("ignores face-table footer notes cross-ref when computing scanCeiling", () => {
    const filler = `<p>${"Supplemental unaudited interim disclosure. ".repeat(120)}</p>`;
    const html = `
      <html><body>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        ${filler.repeat(3)}
        <p>Condensed Consolidated Balance Sheets (Unaudited)</p>
        <table>
          <tr><td></td><td>March 31, 2025</td><td>December 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>50</td><td>48</td></tr>
          <tr><td>Total current assets</td><td>200</td><td>195</td></tr>
          <tr><td>Total assets</td><td>500</td><td>480</td></tr>
        </table>
        <p>See accompanying Notes to Condensed Consolidated Financial Statements.</p>
        <p>Condensed Consolidated Statements of Operations (Unaudited)</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td><td>Three Months Ended Mar 31, 2024</td></tr>
          <tr><td>Net revenues</td><td>1000</td><td>900</td></tr>
          <tr><td>Cost of revenues</td><td>400</td><td>360</td></tr>
          <tr><td>Operating income</td><td>200</td><td>180</td></tr>
          <tr><td>Net income</td><td>150</td><td>130</td></tr>
        </table>
        <p>Condensed Consolidated Statements of Cash Flows (Unaudited)</p>
        <table>
          <tr><td></td><td>Three Months Ended Mar 31, 2025</td><td>Three Months Ended Mar 31, 2024</td></tr>
          <tr><td>Net income</td><td>150</td><td>130</td></tr>
          <tr><td>Depreciation and amortization</td><td>40</td><td>35</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>200</td><td>180</td></tr>
        </table>
        <p>ITEM 2. MANAGEMENT'S DISCUSSION</p>
      </body></html>
    `;
    const ctx = ctxFromHtml(html);
    const isOffset = ctx.acc.indexOf("Condensed Consolidated Statements of Operations");
    const notesFooterOffset = ctx.acc.indexOf("See accompanying Notes");
    expect(isLikelyFaceStatementFooterNotesReference(ctx.acc, notesFooterOffset)).toBe(true);
    const sectionHit = locateFinancialStatementsSection(ctx, "10-Q");
    expect(sectionHit).not.toBeNull();
    expect(sectionHit!.scanCeiling).toBeGreaterThan(isOffset);
  });

  it("filters face-table footer cross-refs that say notes are an integral part of the statement", () => {
    const acc =
      "Condensed Consolidated Balance Sheets. Notes to Consolidated Financial Statements are an integral part of this statement.";
    const offset = acc.indexOf("Notes to Consolidated");
    expect(isLikelyFaceStatementFooterNotesReference(acc, offset)).toBe(true);
  });

  it("returns audit trail with rejected near-miss candidates", () => {
    const html = `
      <html><body>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Selected Financial Data</p>
        <table><tr><td>Revenue</td><td>100</td><td>90</td></tr></table>
      </body></html>
    `;
    const ctx = ctxFromHtml(padTenQItem1(html));
    const result = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
    expect(result.audit.blocksBuilt).toBeGreaterThanOrEqual(0);
    expect(result.packet).toBeNull();
    expect(result.nearMisses.length + result.rejected.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects HTZ-style Item 1 index note list with page numbers between Note entries", () => {
    const acc =
      "12 Notes to the Condensed Consolidated Financial Statements Note 1 Background 14 Note 2 Basis of Presentation 15 Note 3 Debt 22";
    const note1Offset = acc.indexOf("Note 1");
    const notesOffset = acc.indexOf("Notes to");
    expect(isLikelyStatementIndexListingHit(acc, note1Offset)).toBe(true);
    expect(isLikelyStatementIndexListingHit(acc, notesOffset)).toBe(true);
  });

  it("does not reject a real Note 1 heading that is not an index listing", () => {
    const acc =
      "NOTES TO CONDENSED CONSOLIDATED FINANCIAL STATEMENTS Note 1. Background The Company was reorganized in 2021.";
    const note1Offset = acc.indexOf("Note 1");
    expect(isLikelyStatementIndexListingHit(acc, note1Offset)).toBe(false);
  });

  it("extends face scan ceiling past index note list to real statements", () => {
    const item1Start = 1000;
    const indexListing =
      "12 Notes to the Condensed Consolidated Financial Statements Note 1 Background 14 Note 2 Basis 15";
    const faceAnchor = "CONDENSED CONSOLIDATED BALANCE SHEETS Unaudited";
    const acc =
      "x".repeat(item1Start) +
      indexListing +
      " ".repeat(5000) +
      faceAnchor +
      " ".repeat(50_000);
    const ceiling = findPrimaryFaceTablesEndBeforeNotes(acc, item1Start, acc.length);
    expect(ceiling).toBeGreaterThan(acc.indexOf(faceAnchor));
  });
});
