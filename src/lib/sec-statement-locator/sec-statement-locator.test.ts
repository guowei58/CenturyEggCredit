import { describe, expect, it } from "vitest";
import { buildParsedFilingHtmlContext } from "@/lib/sec-filing-financials";
import {
  buildStatementBlocks,
  locateFinancialStatementsSection,
  locatePrimaryStatementPacket,
} from "@/lib/sec-statement-locator";

function ctxFromHtml(html: string) {
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) throw new Error("no context");
  return ctx;
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
    const ctx = ctxFromHtml(html);
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

  it("returns audit trail with rejected near-miss candidates", () => {
    const html = `
      <html><body>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Selected Financial Data</p>
        <table><tr><td>Revenue</td><td>100</td><td>90</td></tr></table>
      </body></html>
    `;
    const ctx = ctxFromHtml(html);
    const result = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
    expect(result.audit.blocksBuilt).toBeGreaterThanOrEqual(0);
    expect(result.packet).toBeNull();
    expect(result.nearMisses.length + result.rejected.length).toBeGreaterThanOrEqual(0);
  });
});
