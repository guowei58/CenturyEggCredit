import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import type { FilingHtmlStatement } from "@/lib/sec-filing-financials";
import {
  __test_detectDataStart,
  __test_extractAnnualReportExhibitUrl,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_flatAccFromHtml,
  isLikelyCashRollupCrossReferenceToCashFlowStatement,
  parsePrimaryFilingStatementHtml,
  parsePrimaryFilingStatementsFromHtml,
  resolveEdgarArchivesDataCikForSubmission,
  __test_countStatementTableNumericCellsOrTags,
  __test_extractMonetaryUnitsFromText,
  __test_mergeStatementsById,
  __test_statementTableTextLooksLikePrimaryFace,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
  __test_validateSinglePrimaryStatementShape,
  buildPrimaryFaceShapeTemplateFromStatement,
  scoreShapeTemplateSimilarity,
} from "@/lib/sec-filing-financials";
import { __test_validateStatementShape } from "@/lib/sec-filing-financials-diagnostics";

function makeStatement(id: FilingHtmlStatement["id"], rows: string[], periods = ["p1", "p2"]): FilingHtmlStatement {
  return {
    id,
    title: id,
    role: id,
    periods: periods.map((label, idx) => ({ key: `p${idx + 1}`, label })),
    rows: rows.map((label, idx) => ({
      concept: `row-${idx + 1}`,
      label,
      depth: 0,
      rowKind: "data",
      valueFormat: "native",
      values: { p1: idx + 1, p2: idx + 2 },
      displayValues: { p1: String(idx + 1), p2: String(idx + 2) },
    })),
  };
}

function makeIncomeStatement(rows: string[], periods = ["p1", "p2"]): FilingHtmlStatement {
  return makeStatement("income-statement", rows, periods);
}

/** Pad fixture tables so period columns meet the >10-numerics-per-column gate. */
function densifyPrimaryFaceFixtureHtml(html: string): string {
  const fillerRows = Array.from({ length: 12 }, (_, i) =>
    `<tr><td>Supplemental disclosure ${i + 1}</td><td>${5000 + i}</td><td>${4900 + i}</td><td>${4800 + i}</td><td>${4700 + i}</td></tr>`
  ).join("");
  return html.replace(/<\/table>/gi, `${fillerRows}</table>`);
}

function parseFixtureStatementHtml(
  html: string,
  opts: Parameters<typeof parsePrimaryFilingStatementHtml>[1]
) {
  return parsePrimaryFilingStatementHtml(densifyPrimaryFaceFixtureHtml(html), opts);
}

function parseFixtureStatementsFromHtml(
  html: string,
  opts: Parameters<typeof parsePrimaryFilingStatementsFromHtml>[1]
) {
  return parsePrimaryFilingStatementsFromHtml(densifyPrimaryFaceFixtureHtml(html), opts);
}

describe("resolveEdgarArchivesDataCikForSubmission", () => {
  it("prefers the CIK in the submissions docUrl over the ticker-resolved issuer CIK", () => {
    expect(
      resolveEdgarArchivesDataCikForSubmission({
        issuerCik: "0001652044",
        accessionNumber: "0001288776-14-000088",
        docUrl: "https://www.sec.gov/Archives/edgar/data/1288776/000128877614000088/goog-10qk.htm",
      })
    ).toBe("0001288776");
  });

  it("falls back to the accession-number filer CIK when docUrl is missing", () => {
    expect(
      resolveEdgarArchivesDataCikForSubmission({
        issuerCik: "9999999999",
        accessionNumber: "0001652044-15-000005",
      })
    ).toBe("0001652044");
  });

  it("falls back to issuer CIK when accession lacks expected dashes", () => {
    expect(
      resolveEdgarArchivesDataCikForSubmission({
        issuerCik: "0001652044",
        accessionNumber: "MALFORMED",
      })
    ).toBe("0001652044");
  });
});

describe("parsePrimaryFilingStatementHtml", () => {
  it("parses the face statement table from the main filing html", () => {
    const html = `
      <html><body>
        <p>Table of contents</p>
        <a href="#CONSOLIDATED_BALANCE_SHEETS">Consolidated Balance Sheets</a>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Tesla, Inc.</p>
        <p>Consolidated Balance Sheets</p>
        <p>(in thousands, except for par values)</p>
        <table>
          <tr>
            <td></td>
            <td></td>
            <td>March 31,</td>
            <td></td>
            <td></td>
            <td>December 31,</td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td></td>
            <td>2018</td>
            <td></td>
            <td></td>
            <td>2017</td>
            <td></td>
          </tr>
          <tr>
            <td>Assets</td>
          </tr>
          <tr>
            <td>Current assets</td>
          </tr>
          <tr>
            <td>Cash and cash equivalents</td>
            <td></td>
            <td>$</td>
            <td>2,665,673</td>
            <td></td>
            <td>$</td>
            <td>3,367,914</td>
          </tr>
          <tr>
            <td>Operating lease vehicles, net</td>
            <td></td>
            <td></td>
            <td>2,315,124</td>
            <td></td>
            <td></td>
            <td>4,116,604</td>
          </tr>
          <tr>
            <td>Solar energy systems, leased and to be leased, net</td>
            <td></td>
            <td></td>
            <td>6,346,374</td>
            <td></td>
            <td></td>
            <td>6,347,490</td>
          </tr>
          <tr>
            <td>Total assets</td>
            <td></td>
            <td>$</td>
            <td>27,271,429</td>
            <td></td>
            <td>$</td>
            <td>28,655,372</td>
          </tr>
        </table>
        <p>Consolidated Statements of Operations</p>
        <p>(in thousands)</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2018</td><td>Three Months Ended March 31, 2017</td></tr>
          <tr><td>Total revenues</td><td>3,409,000</td><td>2,696,000</td></tr>
          <tr><td>Net loss</td><td>(785,000)</td><td>(397,000)</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <p>(in thousands)</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2018</td><td>Three Months Ended March 31, 2017</td></tr>
          <tr><td>Net cash used in operating activities</td><td>(398,000)</td><td>(61,000)</td></tr>
          <tr><td>Net cash used in investing activities</td><td>(651,000)</td><td>(763,000)</td></tr>
        </table>
        <p>Note 6 - Solar Energy Systems, Leased and To Be Leased, Net</p>
        <table>
          <tr>
            <td></td>
            <td>March 31,</td>
            <td>2018</td>
            <td>Gross Carrying Amount</td>
            <td>Net Carrying Amount</td>
          </tr>
          <tr>
            <td>Developed technology</td>
            <td>125,889</td>
            <td>(23,780)</td>
            <td>26,899</td>
            <td>128,998</td>
          </tr>
        </table>
      </body></html>
    `;

    const parsed = parseFixtureStatementHtml(html, {
      kind: "bs",
      form: "10-Q",
      primaryDocument: "tsla-10q_20180331.htm",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.sourceHtmlFile).toBe("tsla-10q_20180331.htm");
    expect(parsed?.periods.map((p) => p.label)).toEqual([
      "March 31, 2018",
      "December 31, 2017",
    ]);
    expect(parsed?.rows.map((row) => row.label).slice(0, 4)).toEqual([
      "Cash and cash equivalents",
      "Operating lease vehicles, net",
      "Solar energy systems, leased and to be leased, net",
      "Total assets",
    ]);
    expect(parsed?.rows[0]?.valueFormat).toBe("usd_millions");
    expect(parsed?.rows[0]?.values.p1).toBeCloseTo(2665.673, 6);
    expect(parsed?.rows[1]?.values.p1).toBeCloseTo(2315.124, 6);
    expect(parsed?.rows[1]?.displayValues.p2).toBe("4,116,604");
    expect(parsed?.rows[2]?.values.p1).toBeCloseTo(6346.374, 6);
    expect(parsed?.rows[3]?.rowKind).toBe("total");
  });

  it("does not truncate a 10-K section on inline Item 9A references inside the audit report", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA 45</p>
        <p>ITEM 9A. CONTROLS AND PROCEDURES 96</p>
        <p>Report of Independent Registered Public Accounting Firm</p>
        <p>
          We evaluated internal control over financial reporting appearing under Item 9A.
          Our responsibility is to express opinions on the consolidated financial statements.
        </p>
        <p>Consolidated Balance Sheets</p>
        <p>(in millions)</p>
        <table>
          <tr><td></td><td>December 31, 2021</td><td>December 31, 2020</td></tr>
          <tr><td>Cash and cash equivalents</td><td>17,576</td><td>19,384</td></tr>
          <tr><td>Accounts receivable, net</td><td>1,913</td><td>1,886</td></tr>
          <tr><td>Inventory</td><td>5,757</td><td>4,101</td></tr>
          <tr><td>Total current assets</td><td>27,100</td><td>26,717</td></tr>
          <tr><td>Property, plant and equipment, net</td><td>31,621</td><td>25,431</td></tr>
          <tr><td>Total assets</td><td>62,131</td><td>52,148</td></tr>
        </table>
        <p>Consolidated Statements of Operations</p>
        <p>(in millions)</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2021</td><td>Year Ended December 31, 2020</td></tr>
          <tr><td>Total revenues</td><td>53,823</td><td>31,536</td></tr>
          <tr><td>Cost of revenues</td><td>40,217</td><td>24,906</td></tr>
          <tr><td>Gross profit</td><td>13,606</td><td>6,630</td></tr>
          <tr><td>Operating expenses</td><td>6,523</td><td>4,453</td></tr>
          <tr><td>Income before income taxes</td><td>6,834</td><td>1,154</td></tr>
          <tr><td>Net income</td><td>5,519</td><td>721</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <p>(in millions)</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2021</td><td>Year Ended December 31, 2020</td></tr>
          <tr><td>Net income</td><td>5,519</td><td>721</td></tr>
          <tr><td>Depreciation and amortization</td><td>2,911</td><td>2,322</td></tr>
          <tr><td>Operating activities:</td><td></td><td></td></tr>
          <tr><td>Net cash provided by operating activities</td><td>11,497</td><td>5,943</td></tr>
          <tr><td>Net cash used in investing activities</td><td>(6,482)</td><td>(3,132)</td></tr>
          <tr><td>Net cash provided by financing activities</td><td>5,203</td><td>9,973</td></tr>
        </table>
        <p>ITEM 9A. CONTROLS AND PROCEDURES</p>
      </body></html>
    `;

    const parsed = parseFixtureStatementHtml(html, {
      kind: "bs",
      form: "10-K",
      primaryDocument: "tsla-20211231.htm",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rows[0]?.label).toBe("Cash and cash equivalents");
    expect(parsed?.rows.some((row) => /report of independent/i.test(row.label))).toBe(false);
    expect(parsed?.periods.map((p) => p.label)).toEqual([
      "December 31, 2021",
      "December 31, 2020",
    ]);
  });

  it("ignores Item 6 selected-financial-data summaries when full Item 8 statements appear later (GOOG-style)", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 6. FINANCIAL DATA</p>
        <p>Selected consolidated financial data (unaudited)</p>

        <!-- Condensed summaries like Alphabet/Google 2016 10‑K Selected Financial Data -->
        <table>
          <tr><td></td><td>Dec 31, 2016</td><td>Dec 31, 2015</td><td>Dec 31, 2014</td><td>Dec 31, 2013</td><td>Dec 31, 2012</td></tr>
          <tr><td>Revenues</td><td>90272</td><td>74989</td><td>66001</td><td>55519</td><td>46039</td></tr>
          <tr><td>Income from operations</td><td>23716</td><td>19360</td><td>16496</td><td>15403</td><td>13834</td></tr>
          <tr><td>Net income</td><td>19478</td><td>16348</td><td>13620</td><td>13160</td><td>11435</td></tr>
        </table>

        <table>
          <tr><td></td><td>Dec 31, 2016</td><td>Dec 31, 2015</td><td>Dec 31, 2014</td><td>Dec 31, 2013</td><td>Dec 31, 2012</td></tr>
          <tr><td>Cash, cash equivalents, and marketable securities</td><td>86333</td><td>73066</td><td>64395</td><td>58717</td><td>48088</td></tr>
          <tr><td>Total assets</td><td>167497</td><td>147461</td><td>129187</td><td>109050</td><td>92711</td></tr>
          <tr><td>Total long-term liabilities</td><td>11705</td><td>7820</td><td>8548</td><td>6165</td><td>6662</td></tr>
          <tr><td>Total stockholders' equity</td><td>139036</td><td>120331</td><td>103860</td><td>86977</td><td>71570</td></tr>
        </table>

        <table>
          <tr><td></td><td>2016</td><td>2015</td><td>2014</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>36036</td><td>26572</td><td>23024</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-31165</td><td>-23711</td><td>-21055</td></tr>
        </table>

        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        <p>INDEX TO CONSOLIDATED FINANCIAL STATEMENTS</p>

        <p>Consolidated Statements of Income</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2016</td><td>Year Ended December 31, 2015</td><td>Year Ended December 31, 2014</td></tr>
          <tr><td>Revenues</td><td>90272</td><td>74989</td><td>66001</td></tr>
          <tr><td>Cost of revenues</td><td>35058</td><td>28164</td><td>25000</td></tr>
          <tr><td>Research and development</td><td>13948</td><td>12282</td><td>11000</td></tr>
          <tr><td>Income from operations</td><td>23716</td><td>19360</td><td>18000</td></tr>
          <tr><td>Net income</td><td>19478</td><td>16348</td><td>15000</td></tr>
        </table>

        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>December 31, 2016</td><td>December 31, 2015</td></tr>
          <tr><td>Cash and cash equivalents</td><td>12918</td><td>16949</td></tr>
          <tr><td>Accounts receivable, net</td><td>9179</td><td>7538</td></tr>
          <tr><td>Total current assets</td><td>105408</td><td>88948</td></tr>
          <tr><td>Total assets</td><td>167497</td><td>147461</td></tr>
        </table>

        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2016</td><td>Year Ended December 31, 2015</td><td>Year Ended December 31, 2014</td></tr>
          <tr><td>Net income</td><td>19478</td><td>16348</td><td>15000</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>36036</td><td>26572</td><td>23024</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-31165</td><td>-23711</td><td>-21055</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-930</td><td>-3962</td><td>-3000</td></tr>
        </table>

        <p>Notes to Consolidated Financial Statements</p>
      </body></html>
    `;

    const isParsed = parseFixtureStatementHtml(html, {
      kind: "is",
      form: "10-K",
      primaryDocument: "goog-sample.htm",
    });
    expect(isParsed?.rows.some((row) => /cost of revenues/i.test(row.label))).toBe(true);

    const bsParsed = parseFixtureStatementHtml(html, {
      kind: "bs",
      form: "10-K",
      primaryDocument: "goog-sample.htm",
    });
    expect(bsParsed?.rows[0]?.label).toBe("Cash and cash equivalents");
    expect(bsParsed?.rows.some((row) => /marketable securities/i.test(row.label) && /^Cash/i.test(row.label))).toBe(false);

    const cfParsed = parseFixtureStatementHtml(html, {
      kind: "cf",
      form: "10-K",
      primaryDocument: "goog-sample.htm",
    });
    expect(cfParsed?.rows.some((row) => /financing activities/i.test(row.label))).toBe(true);
  });

  it("ignores MD&A-style five-year trend tables when consolidated Item 8 statements appear later (early GOOG/Alphabet 10‑K)", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
        <p>Historical financial summaries (similar to Alphabet 2009 10-K)</p>

        <table>
          <tr><td></td><td>2008</td><td>2007</td><td>2006</td><td>2005</td><td>2004</td></tr>
          <tr><td>Revenues</td><td>21796</td><td>16594</td><td>10605</td><td>6139</td><td>3189</td></tr>
          <tr><td>Costs and expenses</td><td></td><td></td><td></td><td></td><td></td></tr>
          <tr><td>Cost of revenues</td><td>8622</td><td>6649</td><td>4225</td><td>2577</td><td>1469</td></tr>
          <tr><td>Research and development</td><td>2793</td><td>2120</td><td>1229</td><td>600</td><td>395</td></tr>
        </table>

        <table>
          <tr><td></td><td>2008</td><td>2007</td><td>2006</td><td>2005</td><td>2004</td></tr>
          <tr><td>Cash, cash equivalents and marketable securities</td><td>15846</td><td>15175</td><td>11768</td><td>8492</td><td>5791</td></tr>
          <tr><td>Total assets</td><td>31768</td><td>24805</td><td>14386</td><td>10303</td><td>6104</td></tr>
          <tr><td>Total long-term liabilities</td><td>1227</td><td>890</td><td>90</td><td>100</td><td>137</td></tr>
          <tr><td>Deferred stock-based compensation</td><td></td><td></td><td></td><td></td><td></td></tr>
          <tr><td>Total stockholders' equity</td><td>28239</td><td>22684</td><td>14286</td><td>10103</td><td>5953</td></tr>
        </table>

        <table>
          <tr><td></td><td>2008</td><td>2007</td><td>2006</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>7853</td><td>5775</td><td>3581</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-5319</td><td>-3682</td><td>-6899</td></tr>
          <tr><td>Net cash provided by financing activities</td><td>88</td><td>403</td><td>2966</td></tr>
        </table>

        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>

        <p>Consolidated Statements of Income</p>
        <table>
          <tr><td></td><td>Year Ended Dec 31, 2008</td><td>Year Ended Dec 31, 2007</td><td>Year Ended Dec 31, 2006</td></tr>
          <tr><td>Revenues</td><td>21796</td><td>16594</td><td>10605</td></tr>
          <tr><td>Cost of revenues</td><td>8622</td><td>6649</td><td>4225</td></tr>
          <tr><td>Research and development</td><td>2793</td><td>2120</td><td>1229</td></tr>
          <tr><td>Net income</td><td>4227</td><td>4185</td><td>3074</td></tr>
        </table>

        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>December 31, 2008</td><td>December 31, 2007</td></tr>
          <tr><td>Cash and cash equivalents</td><td>8750</td><td>9351</td></tr>
          <tr><td>Accounts receivable, net</td><td>2641</td><td>2033</td></tr>
          <tr><td>Total current assets</td><td>14223</td><td>14829</td></tr>
          <tr><td>Total assets</td><td>31768</td><td>24805</td></tr>
        </table>

        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2008</td><td>Year Ended December 31, 2007</td><td>Year Ended December 31, 2006</td></tr>
          <tr><td>Net income</td><td>4227</td><td>4185</td><td>3074</td></tr>
          <tr><td>Depreciation and amortization on property and equipment</td><td>1200</td><td>1000</td><td>800</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>7853</td><td>5775</td><td>3581</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-5319</td><td>-3682</td><td>-6899</td></tr>
          <tr><td>Net cash provided by financing activities</td><td>88</td><td>403</td><td>2966</td></tr>
        </table>
      </body></html>
    `;

    const isParsed = parseFixtureStatementHtml(html, {
      kind: "is",
      form: "10-K",
      primaryDocument: "goog-2008-sample.htm",
    });
    expect(isParsed?.periods.length).toBe(3);
    expect(Number(isParsed?.rows.find((row) => /revenues/i.test(row.label))?.values.p1 ?? 0)).toBeGreaterThan(20000);

    const bsParsed = parseFixtureStatementHtml(html, {
      kind: "bs",
      form: "10-K",
      primaryDocument: "goog-2008-sample.htm",
    });
    expect(bsParsed?.periods.length).toBe(2);
    expect(bsParsed?.rows[0]?.label).toBe("Cash and cash equivalents");

    const cfParsed = parseFixtureStatementHtml(html, {
      kind: "cf",
      form: "10-K",
      primaryDocument: "goog-2008-sample.htm",
    });
    expect(cfParsed?.rows.some((row) => /depreciation\b/i.test(row.label))).toBe(true);
    expect(cfParsed?.rows.some((row) => row.label.toLowerCase() === "net income")).toBe(true);
  });

  it("rejects MD&A percentage-of-revenue tables and uses Part IV exhibits when Item 8 incorporates by reference (GEN-style 10-K)", () => {
    const html = `
      <html><body>
        <p>ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
        <p>Consolidated Statements of Operations data as a percentage of net revenues for the periods indicated:</p>
        <table>
          <tr><td></td><td>Fiscal Year 2026</td><td>Fiscal Year 2025</td></tr>
          <tr><td>Net revenues</td><td>100 %</td><td>100 %</td></tr>
          <tr><td>Cost of revenues</td><td>22</td><td>20</td></tr>
          <tr><td>Gross profit</td><td>78</td><td>80</td></tr>
          <tr><td>Sales and marketing</td><td>25</td><td>19</td></tr>
          <tr><td>Research and development</td><td>10</td><td>9</td></tr>
          <tr><td>Operating income</td><td>30</td><td>28</td></tr>
          <tr><td>Net income (loss)</td><td>20</td><td>18</td></tr>
        </table>

        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        <p>The Consolidated Financial Statements included in Part IV, Item 15 of this Annual Report are incorporated by reference into this Item 8.</p>
        <p>ITEM 9. CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS</p>

        <p>PART IV</p>
        <p>ITEM 15. EXHIBITS AND FINANCIAL STATEMENT SCHEDULES</p>
        <p>Consolidated Financial Statements:</p>
        <table>
          <tr><td>Page</td><td></td></tr>
          <tr><td>Consolidated Balance Sheets</td><td>48</td></tr>
          <tr><td>Consolidated Statements of Operations</td><td>50</td></tr>
          <tr><td>Consolidated Statements of Cash Flows</td><td>52</td></tr>
        </table>

        <p>CONSOLIDATED STATEMENTS OF OPERATIONS</p>
        <p>(In millions, except per share amounts)</p>
        <table>
          <tr><td></td><td>Year Ended Apr 3, 2026</td><td>Year Ended Mar 28, 2025</td><td>Year Ended Mar 29, 2024</td></tr>
          <tr><td>Net revenues</td><td>5000</td><td>3935</td><td>3800</td></tr>
          <tr><td>Cost of revenues</td><td>1077</td><td>776</td><td>731</td></tr>
          <tr><td>Gross profit</td><td>3923</td><td>3159</td><td>3069</td></tr>
          <tr><td>Sales and marketing</td><td>1200</td><td>900</td><td>850</td></tr>
          <tr><td>Research and development</td><td>400</td><td>350</td><td>320</td></tr>
          <tr><td>Operating income</td><td>1500</td><td>1200</td><td>1100</td></tr>
          <tr><td>Net income</td><td>1100</td><td>900</td><td>850</td></tr>
        </table>

        <p>CONSOLIDATED BALANCE SHEETS</p>
        <table>
          <tr><td></td><td>Apr 3, 2026</td><td>Mar 28, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Total current assets</td><td>1200</td><td>1100</td></tr>
          <tr><td>Total assets</td><td>8000</td><td>7500</td></tr>
          <tr><td>Total liabilities</td><td>4000</td><td>3800</td></tr>
          <tr><td>Total stockholders' equity</td><td>4000</td><td>3700</td></tr>
        </table>

        <p>CONSOLIDATED STATEMENTS OF CASH FLOWS</p>
        <table>
          <tr><td></td><td>Year Ended Apr 3, 2026</td><td>Year Ended Mar 28, 2025</td><td>Year Ended Mar 29, 2024</td></tr>
          <tr><td>Net income</td><td>1100</td><td>900</td><td>850</td></tr>
          <tr><td>Depreciation</td><td>200</td><td>180</td><td>160</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>1300</td><td>1000</td><td>950</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-400</td><td>-350</td><td>-300</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-200</td><td>-150</td><td>-100</td></tr>
        </table>
      </body></html>
    `;

    const acc = __test_flatAccFromHtml(html);
    const section = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-K");
    const partIv = acc.indexOf("PART IV");
    expect(section).not.toBeNull();
    expect(section!.start).toBeGreaterThanOrEqual(partIv);

    const isParsed = parseFixtureStatementHtml(html, { kind: "is", form: "10-K", primaryDocument: "gen-sample.htm" });
    expect(isParsed?.periods.length).toBeGreaterThanOrEqual(2);
    expect(Number(isParsed?.rows.find((row) => /net revenues/i.test(row.label))?.values.p1 ?? 0)).toBeGreaterThan(1000);
    expect(isParsed?.rows.some((row) => /%\s*$/i.test(row.displayValues?.p1 ?? ""))).toBe(false);

    const all = parseFixtureStatementsFromHtml(html, {
      form: "10-K",
      primaryDocument: "gen-sample.htm",
    });
    expect(all.some((s) => s.id === "income-statement")).toBe(true);
    expect(all.some((s) => s.id === "balance-sheet")).toBe(true);
    expect(all.find((s) => s.id === "income-statement")?.rows.some((r) => /net revenues/i.test(r.label))).toBe(
      true
    );
  });

  it("findPresentedFilingByAccession matches with or without dashes", async () => {
    const { findPresentedFilingByAccession } = await import("@/lib/sec-xbrl-as-presented-save-client");
    const filings = [
      { form: "10-K", filingDate: "2026-05-21", accessionNumber: "0000849399-26-000017", primaryDocument: "a.htm" },
    ];
    expect(findPresentedFilingByAccession(filings, "000084939926000017")?.accessionNumber).toBe(
      "0000849399-26-000017"
    );
  });

  it("sortPresentedFilingsNewestFirst puts latest 10-K before older filings and 10-K before same-day 10-Q", async () => {
    const { sortPresentedFilingsNewestFirst, prepareBulkPresentedFilings } = await import(
      "@/lib/sec-xbrl-as-presented-save-client"
    );
    const raw = [
      { form: "10-Q", filingDate: "2026-02-06", accessionNumber: "a", primaryDocument: "q.htm" },
      { form: "10-K", filingDate: "2026-05-21", accessionNumber: "b", primaryDocument: "k.htm" },
      { form: "10-K", filingDate: "2025-05-15", accessionNumber: "c", primaryDocument: "k2.htm" },
    ];
    const sorted = sortPresentedFilingsNewestFirst(raw);
    expect(sorted[0]?.accessionNumber).toBe("b");
    expect(sorted[1]?.accessionNumber).toBe("a");
    expect(prepareBulkPresentedFilings(raw)[0]?.accessionNumber).toBe("b");
  });

  it("prepareBulkPresentedFilings respects minFilingYear for HTML-face bulk", async () => {
    const { prepareBulkPresentedFilings, FACE_BULK_MIN_FILING_YEAR } = await import(
      "@/lib/sec-xbrl-as-presented-save-client"
    );
    const raw = [
      { form: "10-K", filingDate: "2018-05-15", accessionNumber: "old", primaryDocument: "k.htm" },
      { form: "10-K", filingDate: "2019-05-15", accessionNumber: "y19", primaryDocument: "k.htm" },
      { form: "10-Q", filingDate: "2020-08-01", accessionNumber: "q20", primaryDocument: "q.htm" },
    ];
    const out = prepareBulkPresentedFilings(raw, { minFilingYear: FACE_BULK_MIN_FILING_YEAR });
    expect(out.map((f) => f.accessionNumber)).toEqual(["q20", "y19"]);
  });

  it("anchors primary 10-Q section bounds at Part I Item 1 before Item 2", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Condensed Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2026</td><td>Three Months Ended March 31, 2025</td></tr>
          <tr><td>Total revenues</td><td>100</td><td>90</td></tr>
          <tr><td>Cost of sales</td><td>40</td><td>35</td></tr>
          <tr><td>Operating income</td><td>25</td><td>22</td></tr>
          <tr><td>Net income</td><td>20</td><td>18</td></tr>
        </table>
        <p>Condensed Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>March 31, 2026</td><td>December 31, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>50</td><td>48</td></tr>
          <tr><td>Total assets</td><td>200</td><td>195</td></tr>
        </table>
        <p>Condensed Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2026</td><td>Three Months Ended March 31, 2025</td></tr>
          <tr><td>Net income</td><td>20</td><td>18</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>25</td><td>22</td></tr>
        </table>
        <p>ITEM 2. MANAGEMENT'S DISCUSSION</p>
        <p>Selected quarterly metrics (not primary statements)</p>
        <table>
          <tr><td></td><td>Q1 2026</td><td>Q1 2025</td></tr>
          <tr><td>Total revenues</td><td>999</td><td>888</td></tr>
          <tr><td>Net income</td><td>777</td><td>666</td></tr>
          <tr><td>Cash and cash equivalents</td><td>555</td><td>444</td></tr>
          <tr><td>Total assets</td><td>333</td><td>222</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>111</td><td>100</td></tr>
        </table>
      </body></html>
    `;

    const acc = __test_flatAccFromHtml(html);
    const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-Q");
    expect(bounds).not.toBeNull();
    expect(acc.slice(bounds!.start, bounds!.start + 80)).toMatch(/ITEM\s+1/i);
    expect(bounds!.start).toBeLessThan(acc.indexOf("ITEM 2"));

    const statements = parseFixtureStatementsFromHtml(html, {
      form: "10-Q",
      primaryDocument: "item1-scope.htm",
    });
    expect(statements).toHaveLength(3);
    const is = statements.find((s) => s.id === "income-statement");
    expect(is?.rows.some((row) => row.values.p1 === 999)).toBe(false);
    expect(is?.rows.some((row) => /revenues/i.test(row.label))).toBe(true);
  });

  it("finds 10-K face statements buried after Item 8 preamble beyond the old 28k scan cap", () => {
    const preamble = "<p>Auditor report and index filler</p>\n".repeat(900);
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        ${preamble}
        <p>Consolidated Statements of Income</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td><td>Year Ended December 31, 2023</td></tr>
          <tr><td>Revenues</td><td>5000</td><td>4500</td><td>4000</td></tr>
          <tr><td>Cost of revenues</td><td>2000</td><td>1800</td><td>1700</td></tr>
          <tr><td>Gross profit</td><td>3000</td><td>2700</td><td>2600</td></tr>
          <tr><td>Operating income</td><td>1500</td><td>1300</td><td>1200</td></tr>
          <tr><td>Net income</td><td>1000</td><td>900</td><td>800</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>December 31, 2025</td><td>December 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Total current assets</td><td>1200</td><td>1100</td></tr>
          <tr><td>Total assets</td><td>8000</td><td>7500</td></tr>
          <tr><td>Total liabilities</td><td>4000</td><td>3800</td></tr>
          <tr><td>Total stockholders' equity</td><td>4000</td><td>3700</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td><td>Year Ended December 31, 2023</td></tr>
          <tr><td>Net income</td><td>1000</td><td>900</td><td>800</td></tr>
          <tr><td>Depreciation</td><td>200</td><td>180</td><td>160</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>1300</td><td>1000</td><td>900</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-400</td><td>-350</td><td>-300</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-200</td><td>-150</td><td>-100</td></tr>
        </table>
        <p>ITEM 9. CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS</p>
      </body></html>
    `;

    const statements = parseFixtureStatementsFromHtml(html, {
      form: "10-K",
      primaryDocument: "buried-item8.htm",
    });
    expect(statements).toHaveLength(3);
    const is = statements.find((s) => s.id === "income-statement");
    expect(is?.rows.some((r) => /revenues/i.test(r.label) && r.values.p1 === 5000)).toBe(true);
  });

  it("picks the first size-qualified IS/BS/CF tables in Item 8 order", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        <p>Segment results</p>
        <table>
          <tr><td></td><td>Year Ended September 30, 2022</td><td>Year Ended September 30, 2021</td></tr>
          <tr><td>Segment revenues</td><td>706,640</td><td>654,150</td></tr>
          <tr><td>Segment operating expenses</td><td>83,837</td><td>93,460</td></tr>
          <tr><td>Segment operating income</td><td>622,803</td><td>560,690</td></tr>
        </table>
        <p>Consolidated Statements of Income</p>
        <table>
          <tr><td></td><td>Year Ended September 30, 2022</td><td>Year Ended September 30, 2021</td><td>Year Ended September 30, 2020</td></tr>
          <tr><td>Revenues</td><td>1,377,270</td><td>1,295,366</td><td>1,294,538</td></tr>
          <tr><td>Cost of revenues</td><td>298,500</td><td>280,100</td><td>275,000</td></tr>
          <tr><td>Gross profit</td><td>1,078,770</td><td>1,015,266</td><td>1,019,538</td></tr>
          <tr><td>Research and development</td><td>150,000</td><td>140,000</td><td>130,000</td></tr>
          <tr><td>Selling, general and administrative</td><td>400,000</td><td>380,000</td><td>360,000</td></tr>
          <tr><td>Operating income</td><td>528,770</td><td>495,266</td><td>529,538</td></tr>
          <tr><td>Net income</td><td>373,541</td><td>392,423</td><td>441,200</td></tr>
        </table>
        <p>Lease footnote</p>
        <table>
          <tr><td></td><td>September 30, 2022</td><td>September 30, 2021</td></tr>
          <tr><td>Operating lease right-of-use assets</td><td>36,690</td><td>47,280</td></tr>
          <tr><td>Current operating lease liabilities</td><td>19,370</td><td>22,070</td></tr>
          <tr><td>Non-current operating lease liabilities</td><td>39,190</td><td>53,670</td></tr>
          <tr><td>Total lease liabilities</td><td>58,560</td><td>75,740</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>September 30, 2022</td><td>September 30, 2021</td></tr>
          <tr><td>Cash and cash equivalents</td><td>200,000</td><td>180,000</td></tr>
          <tr><td>Accounts receivable, net</td><td>350,000</td><td>320,000</td></tr>
          <tr><td>Total current assets</td><td>600,000</td><td>550,000</td></tr>
          <tr><td>Goodwill</td><td>800,000</td><td>790,000</td></tr>
          <tr><td>Total assets</td><td>2,500,000</td><td>2,400,000</td></tr>
          <tr><td>Accounts payable</td><td>50,000</td><td>48,000</td></tr>
          <tr><td>Total current liabilities</td><td>120,000</td><td>115,000</td></tr>
          <tr><td>Long-term debt</td><td>900,000</td><td>950,000</td></tr>
          <tr><td>Total liabilities</td><td>1,200,000</td><td>1,150,000</td></tr>
          <tr><td>Total stockholders' equity</td><td>1,300,000</td><td>1,250,000</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended September 30, 2022</td><td>Year Ended September 30, 2021</td><td>Year Ended September 30, 2020</td></tr>
          <tr><td>Net income</td><td>373,541</td><td>392,423</td><td>441,200</td></tr>
          <tr><td>Depreciation and amortization</td><td>45,000</td><td>42,000</td><td>40,000</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>500,000</td><td>480,000</td><td>460,000</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-80,000</td><td>-75,000</td><td>-70,000</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-120,000</td><td>-100,000</td><td>-90,000</td></tr>
        </table>
        <p>ITEM 9. CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS</p>
      </body></html>
    `;

    const statements = parseFixtureStatementsFromHtml(html, {
      form: "10-K",
      primaryDocument: "segment-lease-decoy.htm",
    });
    expect(statements).toHaveLength(3);
    const is = statements.find((s) => s.id === "income-statement");
    const bs = statements.find((s) => s.id === "balance-sheet");
    const cf = statements.find((s) => s.id === "cash-flow");
    expect(is).not.toBeNull();
    expect(bs?.rows.some((r) => /total assets/i.test(r.label))).toBe(true);
    expect(cf?.rows.some((r) => /operating activities/i.test(r.label))).toBe(true);
  });

  it("recognizes common Item 8 heading variants for 10-K section bounds", () => {
    const variants = [
      "ITEM 8. Financial Statements and Supplementary Data",
      "ITEM 8. Consolidated Financial Statements and Supplementary Data",
      "ITEM 8 — Financial Statements and Supplementary Information",
      "ITEM 8. Financial Statements and Supplemental Data",
      "ITEM 8 FINANCIAL STATEMENTS",
      "ITEM 8 . Financial Statements and Supplementary Data",
      "ITEM 8. Index to Consolidated Financial Statements",
      "ITEM 8. Audited Consolidated Financial Statements and Other Financial Information",
    ];

    for (const heading of variants) {
      const html = `
        <html><body>
          <p>PART II</p>
          <p>${heading}</p>
          <p>Consolidated Balance Sheets</p>
          <table>
            <tr><td></td><td>December 31, 2025</td><td>December 31, 2024</td></tr>
            <tr><td>Cash and cash equivalents</td><td>60</td><td>55</td></tr>
            <tr><td>Total current assets</td><td>120</td><td>110</td></tr>
            <tr><td>Total assets</td><td>500</td><td>480</td></tr>
            <tr><td>Total liabilities</td><td>200</td><td>190</td></tr>
            <tr><td>Total stockholders' equity</td><td>300</td><td>290</td></tr>
          </table>
          <p>ITEM 9. CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS</p>
        </body></html>
      `;
      const acc = __test_flatAccFromHtml(html);
      expect(__test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-K"), heading).not.toBeNull();
    }
  });

  it("anchors primary 10-K section bounds at Part II Item 8 with Consolidated Financial Statements wording", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 8. Consolidated Financial Statements and Supplementary Data</p>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td><td>Year Ended December 31, 2023</td></tr>
          <tr><td>Total revenues</td><td>200</td><td>180</td><td>170</td></tr>
          <tr><td>Cost of revenues</td><td>80</td><td>75</td><td>70</td></tr>
          <tr><td>Net income</td><td>40</td><td>35</td><td>30</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>December 31, 2025</td><td>December 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>60</td><td>55</td></tr>
          <tr><td>Total current assets</td><td>120</td><td>110</td></tr>
          <tr><td>Total assets</td><td>500</td><td>480</td></tr>
          <tr><td>Total liabilities</td><td>200</td><td>190</td></tr>
          <tr><td>Total stockholders' equity</td><td>300</td><td>290</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td><td>Year Ended December 31, 2023</td></tr>
          <tr><td>Net income</td><td>40</td><td>35</td><td>30</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>50</td><td>45</td><td>40</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-10</td><td>-8</td><td>-7</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-5</td><td>-4</td><td>-3</td></tr>
        </table>
        <p>ITEM 9. CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS</p>
      </body></html>
    `;

    const acc = __test_flatAccFromHtml(html);
    const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-K");
    expect(bounds).not.toBeNull();
    const statements = parseFixtureStatementsFromHtml(html, { form: "10-K", primaryDocument: "item8-consolidated.htm" });
    expect(statements.map((s) => s.id).sort()).toEqual(["balance-sheet", "cash-flow", "income-statement"]);
  });

  it("anchors primary 10-K section bounds at Part II Item 8", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
        <table>
          <tr><td></td><td>2025</td><td>2024</td></tr>
          <tr><td>Total revenues</td><td>900</td><td>800</td></tr>
          <tr><td>Net income</td><td>100</td><td>90</td></tr>
        </table>
        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td><td>Year Ended December 31, 2023</td></tr>
          <tr><td>Total revenues</td><td>200</td><td>180</td><td>170</td></tr>
          <tr><td>Cost of revenues</td><td>80</td><td>75</td><td>70</td></tr>
          <tr><td>Net income</td><td>40</td><td>35</td><td>30</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>December 31, 2025</td><td>December 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>60</td><td>55</td></tr>
          <tr><td>Total assets</td><td>500</td><td>480</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td></tr>
          <tr><td>Net income</td><td>40</td><td>35</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>50</td><td>45</td></tr>
        </table>
        <p>ITEM 9. CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS</p>
      </body></html>
    `;

    const acc = __test_flatAccFromHtml(html);
    const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-K");
    expect(bounds).not.toBeNull();
    expect(acc.slice(bounds!.start, bounds!.start + 80)).toMatch(/ITEM\s+8/i);
    expect(bounds!.start).toBeLessThan(acc.indexOf("ITEM 9"));

    const is = parseFixtureStatementHtml(html, { kind: "is", form: "10-K", primaryDocument: "item8-scope.htm" });
    expect(is?.rows[0]?.label).toBe("Total revenues");
    expect(is?.rows.some((row) => Object.values(row.values).includes(900))).toBe(false);
  });

  it("uses the first local 10-Q statement cluster instead of an earlier notes-style mention", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Notes to Condensed Consolidated Financial Statements</p>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td>Note summary data</td><td>1</td><td>2</td></tr>
        </table>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Condensed Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2024</td><td>Three Months Ended March 30, 2023</td></tr>
          <tr><td>Revenues</td><td>120,000</td><td>100,000</td></tr>
          <tr><td>Cost of sales</td><td>70,000</td><td>60,000</td></tr>
          <tr><td>Operating income</td><td>50,000</td><td>40,000</td></tr>
          <tr><td>Net income</td><td>30,000</td><td>25,000</td></tr>
        </table>
        <p>Condensed Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>March 31, 2024</td><td>December 30, 2023</td></tr>
          <tr><td>Cash and cash equivalents</td><td>45,000</td><td>41,000</td></tr>
          <tr><td>Total assets</td><td>320,000</td><td>310,000</td></tr>
        </table>
        <p>Condensed Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2024</td><td>Three Months Ended March 30, 2023</td></tr>
          <tr><td>Operating activities:</td><td></td><td></td></tr>
          <tr><td>Net income</td><td>30,000</td><td>25,000</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>35,000</td><td>29,000</td></tr>
        </table>
        <p>Notes to Condensed Consolidated Financial Statements</p>
        <p>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
      </body></html>
    `;

    const parsed = parseFixtureStatementHtml(html, {
      kind: "cf",
      form: "10-Q",
      primaryDocument: "cluster-10q.htm",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rows[0]?.label).toBe("Net income");
    expect(parsed?.rows[1]?.label).toBe("Net cash provided by operating activities");
    expect(parsed?.periods.map((p) => p.label)).toEqual([
      "Three Months Ended March 31, 2024",
      "Three Months Ended March 30, 2023",
    ]);
  });

  it("skips cash roll-forward tables that tie out to Consolidated Statements of Cash Flows (EVC)", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Supplemental cash presentation</p>
        <table>
          <tr><td></td><td>As of March 31, 2025</td><td>December 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>100</td><td>92</td></tr>
          <tr><td>Restricted cash</td><td>20</td><td>18</td></tr>
          <tr><td>Total as presented in the Condensed Consolidated Statements of Cash Flows</td><td>120</td><td>110</td></tr>
        </table>
        <p>Condensed Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>March 31, 2025</td><td>December 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>120</td><td>118</td></tr>
          <tr><td>Accounts receivable, net</td><td>30</td><td>31</td></tr>
          <tr><td>Total current assets</td><td>400</td><td>392</td></tr>
          <tr><td>Total assets</td><td>900</td><td>893</td></tr>
          <tr><td>Accounts payable</td><td>50</td><td>48</td></tr>
          <tr><td>Total liabilities</td><td>300</td><td>297</td></tr>
          <tr><td>Total stockholders' equity</td><td>600</td><td>596</td></tr>
        </table>
        <p>Condensed Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2025</td><td>Three Months Ended March 31, 2024</td></tr>
          <tr><td>Total revenues</td><td>205</td><td>182</td></tr>
          <tr><td>Cost of revenues</td><td>88</td><td>76</td></tr>
          <tr><td>Net income</td><td>25</td><td>21</td></tr>
        </table>
        <p>Condensed Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2025</td><td>Three Months Ended March 31, 2024</td></tr>
          <tr><td>Net income</td><td>25</td><td>21</td></tr>
          <tr><td>Depreciation</td><td>9</td><td>10</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>40</td><td>39</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-10</td><td>-14</td></tr>
          <tr><td>Net cash provided by financing activities</td><td>-2</td><td>-1</td></tr>
        </table>
      </body></html>
    `;

    expect(isLikelyCashRollupCrossReferenceToCashFlowStatement("Total as presented in the Condensed Consolidated Statements of Cash Flows")).toBe(true);

    const cfParsed = parseFixtureStatementHtml(html, {
      kind: "cf",
      form: "10-Q",
      primaryDocument: "evc-rollforward.htm",
    });
    expect(cfParsed?.rows.some((row) => /depreciation\b/i.test(row.label))).toBe(true);
    expect(cfParsed?.rows.some((row) => row.label.toLowerCase().includes("net income"))).toBe(true);

    const bsParsed = parseFixtureStatementHtml(html, {
      kind: "bs",
      form: "10-Q",
      primaryDocument: "evc-rollforward.htm",
    });
    expect(bsParsed?.rows.some((row) => /total liabilities\b/i.test(row.label))).toBe(true);
    expect(bsParsed?.rows.some((row) => /total stockholders'? equity\b/i.test(row.label))).toBe(true);
  });

  it("rejects eps and revenue-note tables in favor of the real 10-Q statements", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>September 30, 2024</td><td>December 31, 2023</td></tr>
          <tr><td>Cash and cash equivalents</td><td>500</td><td>450</td></tr>
          <tr><td>Accounts receivable</td><td>200</td><td>180</td></tr>
          <tr><td>Total current assets</td><td>900</td><td>860</td></tr>
          <tr><td>Total assets</td><td>2,500</td><td>2,420</td></tr>
        </table>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three Months Ended September 30, 2024</td><td>Three Months Ended September 30, 2023</td><td>Nine Months Ended September 30, 2024</td><td>Nine Months Ended September 30, 2023</td></tr>
          <tr><td>Media revenues</td><td>908</td><td>758</td><td>2,519</td><td>2,285</td></tr>
          <tr><td>Non-media revenues</td><td>9</td><td>9</td><td>25</td><td>23</td></tr>
          <tr><td>Total revenues</td><td>917</td><td>767</td><td>2,544</td><td>2,308</td></tr>
          <tr><td>Operating expenses</td><td>738</td><td>730</td><td>2,259</td><td>2,253</td></tr>
          <tr><td>Operating income</td><td>179</td><td>37</td><td>285</td><td>55</td></tr>
          <tr><td>Net income</td><td>96</td><td>(45)</td><td>140</td><td>61</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Nine Months Ended September 30, 2024</td><td>Nine Months Ended September 30, 2023</td></tr>
          <tr><td>Net income</td><td>140</td><td>61</td></tr>
          <tr><td>Depreciation and amortization</td><td>189</td><td>204</td></tr>
          <tr><td>Accounts receivable</td><td>(5)</td><td>11</td></tr>
          <tr><td>Accounts payable and accrued liabilities</td><td>(7)</td><td>10</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>350</td><td>290</td></tr>
        </table>
        <p>Notes to Unaudited Consolidated Financial Statements</p>
        <table>
          <tr><td></td><td>Three Months Ended September 30, 2024</td><td>Three Months Ended September 30, 2023</td><td>Nine Months Ended September 30, 2024</td><td>Nine Months Ended September 30, 2023</td></tr>
          <tr><td>Net income (loss)</td><td>96</td><td>(45)</td><td>140</td><td>61</td></tr>
          <tr><td>Numerator for basic and diluted earnings per common share available to common shareholders</td><td>94</td><td>(46)</td><td>134</td><td>50</td></tr>
          <tr><td>Shares (Denominator)</td><td></td><td></td><td></td><td></td></tr>
          <tr><td>Basic weighted-average common shares outstanding</td><td>66,355</td><td>63,325</td><td>65,570</td><td>65,670</td></tr>
          <tr><td>Diluted weighted-average common and common equivalent shares outstanding</td><td>66,526</td><td>63,325</td><td>65,709</td><td>65,727</td></tr>
        </table>
        <table>
          <tr><td></td><td>Local Media</td><td>Tennis</td><td>Other</td><td>Eliminations</td><td>Total</td></tr>
          <tr><td>Distribution revenue</td><td>1,151</td><td>154</td><td>0</td><td>0</td><td>1,305</td></tr>
          <tr><td>Core advertising revenue</td><td>852</td><td>32</td><td>24</td><td>(13)</td><td>895</td></tr>
          <tr><td>Political advertising revenue</td><td>202</td><td>0</td><td>0</td><td>0</td><td>202</td></tr>
          <tr><td>Other media, non-media, and intercompany revenues</td><td>117</td><td>4</td><td>30</td><td>(9)</td><td>142</td></tr>
          <tr><td>Total revenues</td><td>2,322</td><td>190</td><td>54</td><td>(22)</td><td>2,544</td></tr>
        </table>
        <p>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
      </body></html>
    `;

    const income = parseFixtureStatementHtml(html, {
      kind: "is",
      form: "10-Q",
      primaryDocument: "sbgi-note-filter.htm",
    });
    const cashFlow = parseFixtureStatementHtml(html, {
      kind: "cf",
      form: "10-Q",
      primaryDocument: "sbgi-note-filter.htm",
    });

    expect(income).not.toBeNull();
    expect(income?.rows[0]?.label).toBe("Media revenues");
    expect(cashFlow).not.toBeNull();
    expect(cashFlow?.rows[0]?.label).toBe("Net income");
    expect(cashFlow?.periods.map((p) => p.label)).toEqual([
      "Nine Months Ended September 30, 2024",
      "Nine Months Ended September 30, 2023",
    ]);
  });

  it("recognizes income statements when the heading uses the 'Income Statements' wording", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Condensed Consolidated Income Statements</p>
        <p>(Dollars in millions, except per share amounts)</p>
        <table>
          <tr><td></td><td>2026</td><td>2025</td></tr>
          <tr><td>Revenues</td><td>19,109</td><td>18,321</td></tr>
          <tr><td>Operating costs and expenses</td><td>16,822</td><td>15,994</td></tr>
          <tr><td>Income before income taxes</td><td>2,287</td><td>2,327</td></tr>
          <tr><td>Net income</td><td>1,857</td><td>1,825</td></tr>
        </table>
        <p>Condensed Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>March 31, 2026</td><td>December 31, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>940</td><td>1,040</td></tr>
          <tr><td>Total assets</td><td>16,052</td><td>15,783</td></tr>
        </table>
        <p>Condensed Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>2026</td><td>2025</td></tr>
          <tr><td>Net income</td><td>1,857</td><td>1,825</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>1,347</td><td>1,210</td></tr>
        </table>
        <p>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
      </body></html>
    `;

    const parsed = parseFixtureStatementHtml(html, {
      kind: "is",
      form: "10-Q",
      primaryDocument: "income-statements-heading.htm",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rows[0]?.label).toBe("Revenues");
    expect(parsed?.rows.some((row) => row.label === "Net income")).toBe(true);
  });

  it("does not parse statements outside Part I Item 1 / Part II Item 8", () => {
    const html = `
      <html><body>
        <p>AT&T Inc.</p>
        <p>Consolidated Statements of Income</p>
        <table>
          <tr><td></td><td>2018</td><td>2017</td><td>2016</td></tr>
          <tr><td>Service</td><td>152,345</td><td>145,597</td><td>148,884</td></tr>
          <tr><td>Net Income</td><td>19,953</td><td>29,847</td><td>13,333</td></tr>
        </table>
      </body></html>
    `;

    const parsed = parseFixtureStatementHtml(html, {
      kind: "is",
      form: "10-K",
      primaryDocument: "annual-report-exhibit.htm",
    });

    expect(parsed).toBeNull();
  });

  it("does not parse FilingSummary report pages without Item 8 markers", () => {
    const html = `
      <html><body>
        <table>
          <tr><td>CONSOLIDATED BALANCE SHEET - USD ($) $ in Millions</td><td>Dec. 31, 2025</td><td>Dec. 31, 2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>$ 13,587</td><td>$ 13,947</td></tr>
          <tr><td>Total assets</td><td>137,122</td><td>125,356</td></tr>
        </table>
      </body></html>
    `;

    const parsed = parsePrimaryFilingStatementHtml(html, {
      kind: "bs",
      form: "10-K",
      primaryDocument: "R5.htm",
    });

    expect(parsed).toBeNull();
  });

  it("skips stray tables after a heading and parses the later cash-flow table", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>March 31, 2026</td><td>December 31, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>242,479</td><td>231,845</td></tr>
          <tr><td>Total assets</td><td>3,283,000</td><td>3,205,000</td></tr>
        </table>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2026</td><td>Three Months Ended March 31, 2025</td></tr>
          <tr><td>Interest income</td><td>25,000</td><td>23,000</td></tr>
          <tr><td>Net income</td><td>8,584</td><td>7,360</td></tr>
        </table>
        <p>Consolidated Statement of Cash Flows</p>
        <p>Loans held-for-sale</p>
        <table>
          <tr><td>Carried over label fragment</td><td>1</td><td>2</td></tr>
        </table>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2026</td><td>Three Months Ended March 31, 2025</td></tr>
          <tr><td>Net income</td><td>8,584</td><td>7,360</td></tr>
          <tr><td>Depreciation and amortization</td><td>605</td><td>565</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>41,770</td><td>(2,184)</td></tr>
          <tr><td>Net cash used in investing activities</td><td>(66,451)</td><td>(89,010)</td></tr>
          <tr><td>Net cash provided by financing activities</td><td>35,915</td><td>72,832</td></tr>
        </table>
        <p>Notes to Consolidated Financial Statements</p>
      </body></html>
    `;

    const parsed = parseFixtureStatementHtml(html, {
      kind: "cf",
      form: "10-Q",
      primaryDocument: "stray-cf-table.htm",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rows[0]?.label).toBe("Net income");
    expect(parsed?.rows[2]?.label).toBe("Net cash provided by operating activities");
  });

  it("finds the annual report exhibit link when a 10-K incorporates statements by reference", () => {
    const primaryHtml = `
      <html><body>
        <p>Portions of Annual Report to Stockholders are incorporated herein by reference.</p>
        <table>
          <tr>
            <td>13</td>
            <td><a href="d705958dex13.htm">Portions of AT&amp;T's Annual Report to Stockholders for the fiscal year ended December 31, 2018.</a></td>
          </tr>
        </table>
      </body></html>
    `;

    expect(
      __test_extractAnnualReportExhibitUrl(
        primaryHtml,
        "https://www.sec.gov/Archives/edgar/data/732717/000119312519045608/d705958d10k.htm"
      )
    ).toBe("https://www.sec.gov/Archives/edgar/data/732717/000119312519045608/d705958dex13.htm");
  });

  it("accepts industrial income statements that lead with products and services", () => {
    const stmt = makeIncomeStatement([
      "Products",
      "Services",
      "Operating costs and expenses:",
      "Products",
      "Services",
      "General and administrative (G&A)",
      "Operating earnings",
      "Earnings before income tax",
      "Net earnings",
    ]);

    expect(__test_validateStatementShape(stmt, "10-Q")).not.toContain("income-statement: missing core income-statement cues");
  });

  it("accepts income statements where many XBRL axis/member rows precede face line items", () => {
    const stmt = makeIncomeStatement([
      "Income Statement [Abstract]",
      "Statement [Table]",
      "Income Statement Location [Axis]",
      "Income Statement Location [Domain]",
      "Advertising [Member]",
      "Other [Member]",
      "Google [Member]",
      "Legal Entity [Axis]",
      "Entity [Domain]",
      "Consolidated [Member]",
      "Class of Stock [Axis]",
      "Class A [Member]",
      "Revenues",
      "Costs and expenses:",
      "Income from operations",
      "Net income",
    ]);

    expect(__test_validateStatementShape(stmt, "10-Q")).not.toContain("income-statement: missing core income-statement cues");
  });

  it("accepts bank income statements that lead with interest income and expense", () => {
    const stmt = makeIncomeStatement([
      "Loans, including loans held for sale",
      "Investment securities",
      "Other",
      "Total interest income",
      "Interest expense:",
      "Deposits",
      "Net interest income",
      "Provision for credit losses",
      "Income before income taxes",
      "Net income",
    ]);

    expect(__test_validateStatementShape(stmt, "10-K")).not.toContain("income-statement: missing core income-statement cues");
  });

  it("accepts asset-manager style income statements led by fees and alternative revenue lines", () => {
    const stmt = makeIncomeStatement([
      "Management fees",
      "Advisory and transaction fees, net",
      "Investment income (loss)",
      "Incentive fees",
      "Property management, development and other fees",
      "Retirement Services",
      "Premium revenue",
      "Total revenues, net",
    ]);

    expect(__test_validateStatementShape(stmt, "10-Q")).not.toContain("income-statement: missing core income-statement cues");
  });

  it("accepts condensed consolidated cash-flow tables with summarized activity buckets", () => {
    const stmt = makeStatement(
      "cash-flow",
      [
        "Operating Activities",
        "Investing Activities",
        "Financing Activities",
        "Effect of exchange rate changes on cash and cash equivalents",
        "Net increase (decrease) in cash and cash equivalents, restricted cash and cash held at consolidated variable interest entities",
      ],
      ["Years ended December 31, 2025", "Years ended December 31, 2024", "Years ended December 31, 2023"]
    );

    expect(__test_validateStatementShape(stmt, "10-K")).not.toContain("cash-flow: too few rows");
  });

  it("accepts four-row condensed cash flows with net cash activity totals and no FX line", () => {
    const stmt = makeStatement(
      "cash-flow",
      [
        "Net cash provided by operating activities",
        "Net cash used in investing activities",
        "Net cash provided by (used in) financing activities",
        "Net increase in cash and restricted cash",
      ],
      ["Year ended August 5, 2018", "Year ended July 31, 2017"]
    );

    expect(__test_validateStatementShape(stmt, "10-K")).not.toContain("cash-flow: too few rows");
  });

  it("accepts cash-flow statements where many XBRL axis/member rows precede face line items", () => {
    const stmt = makeStatement(
      "cash-flow",
      [
        "Statement of Cash Flows [Abstract]",
        "Statement [Table]",
        "Unique Name [Axis]",
        "Noncash or Part Noncash Divestiture, Name [Domain]",
        "Notes Receivable [Member]",
        "Common Stock [Member]",
        "Legal Entity [Axis]",
        "Entity [Domain]",
        "Consolidated [Member]",
        "Net income",
        "Depreciation and amortization of property and equipment",
        "Net cash provided by operating activities",
      ],
      ["FY12", "FY13", "FY14"]
    );

    expect(__test_validateStatementShape(stmt, "10-K")).not.toContain("cash-flow: missing core cash-flow cues");
  });

  it("accepts balance-sheet fragments that start in liabilities and equity (older multi-column HTML)", () => {
    const stmt = makeStatement(
      "balance-sheet",
      [
        "Non-current liabilities",
        "Total liabilities",
        "Commitments and contingencies",
        "Shareholders' equity:",
        "Common stock",
        "Retained earnings",
      ],
      ["September 29, 2007", "September 30, 2006"]
    );

    expect(__test_validateStatementShape(stmt, "10-K")).not.toContain("balance-sheet: missing core balance-sheet cues");
  });

  it("does not flag balance-sheet lines that contain hyphenated Strategic Revenue-Share labels as income rows", () => {
    const stmt = makeStatement("balance-sheet", [
      "Cash and cash equivalents",
      "Due from related parties",
      "Investments (includes fair value holdings)",
      "Operating lease assets",
      "Strategic Revenue-Share Purchase consideration, net",
      "Deferred tax assets",
      "Other assets",
    ]);

    expect(__test_validateStatementShape(stmt, "10-K")).not.toContain("balance-sheet: top rows look like income-statement data");
  });

  it("accepts REIT-style balance sheets that lead with real-estate asset lines", () => {
    const stmt = makeStatement("balance-sheet", [
      "Land",
      "Buildings and improvements",
      "Tenant improvements",
      "Furniture, fixtures and equipment",
      "Construction in progress",
      "Total real estate held for investment",
      "Cash and cash equivalents",
      "Total assets",
    ]);

    expect(__test_validateStatementShape(stmt, "10-Q")).not.toContain("balance-sheet: missing core balance-sheet cues");
  });

  it("accepts cash-flow statements that reconcile net earnings to operating cash flow", () => {
    const stmt = makeStatement("cash-flow", [
      "Net earnings",
      "Adjustments to reconcile net earnings to operating cash flow",
      "Impairment charges",
      "Restructuring charges",
      "Stock-based compensation",
      "Noncurrent income taxes",
      "Net cash provided by operating activities",
    ]);

    expect(__test_validateStatementShape(stmt, "10-Q")).not.toContain("cash-flow: missing core cash-flow cues");
  });

  it("flags balance sheets mistaken for condensed cash-rollforward tie-outs to Consolidated Statements of Cash Flows", () => {
    const stmt = makeStatement(
      "balance-sheet",
      [
        "Cash and cash equivalents",
        "Restricted cash",
        "Total as presented in the Condensed Consolidated Statements of Cash Flows",
      ],
      ["March 31, 2025", "December 31, 2024"]
    );

    expect(__test_validateStatementShape(stmt, "10-Q")).toContain(
      "balance-sheet: cash reconciliation footnote to consolidated statement of cash flows (wrong table)"
    );
  });

  it("flags cash-flow statements mistaken for condensed cash-rollforward tie-outs", () => {
    const stmt = makeStatement(
      "cash-flow",
      ["Cash and cash equivalents", "Restricted cash", "Total as presented on the Consolidated Statements of Cash Flows"],
      ["March 31, 2025", "December 31, 2024"]
    );
    expect(__test_validateStatementShape(stmt, "10-Q")).toContain(
      "cash-flow: cash reconciliation footnote to consolidated statement of cash flows (wrong table)"
    );
  });

  it("skips units-only rows when detecting annual cash flow data start", () => {
    const matrix = [
      ["", "", "Year Ended", "Year Ended", "", "Year Ended", "Year Ended"],
      ["", "", "December 31,", "December 31,", "", "December 31,", "December 31,"],
      ["(In millions)", "", "2025", "2025", "", "2024", "2024"],
      ["Cash flows from operating activities:", "", "", "", "", "", ""],
      ["Net loss", "", "$", "(10)", "", "$", "(12)"],
      ["Depreciation and amortization", "", "", "20", "", "", "18"],
      ["Net cash used in operating activities", "", "", "(30)", "", "", "(25)"],
    ];

    expect(__test_detectDataStart(matrix)).toBe(4);
  });

  it("does not latch mirrored cash-flow data start on trailing supplemental rows only", () => {
    const filler = Array.from({ length: 36 }, () => ["", "OPERATING ACTIVITIES", "", "", "", "", "", "", "", "", "", ""]);
    const matrix = [
      ["", "Nine months ended September 30,", "", "", "", "", "", "2011", "", "", "2010", ""],
      ["", "OPERATING ACTIVITIES", "", "", "", "", "", "", "", "", "", ""],
      ["", "Net income", "", "", "", "", "", "600", "", "", "500", ""],
      ["", "Depreciation and amortization", "", "", "", "", "", "1200", "", "", "1100", ""],
      ...filler,
      ["Net increase in cash and cash equivalents", "", "", "", "", "", "10", "", "", "", "", "20"],
      ["Cash and cash equivalents at beginning of period", "", "", "", "", "", "50", "", "", "", "", "40"],
    ];

    expect(__test_detectDataStart(matrix)).toBe(2);
  });

  it("skips annual date header rows before split-year balance sheet and cash flow data", () => {
    const balanceSheetMatrix = [
      ["STATEMENT OF FINANCIAL POSITION", "STATEMENT OF FINANCIAL POSITION", "STATEMENT OF FINANCIAL POSITION", "", "", "", "", "", ""],
      ["December 31 (In millions)", "December 31 (In millions)", "December 31 (In millions)", "2025", "2025", "2025", "2024", "2024", "2024"],
      ["", "", "", "", "", "", "", "", ""],
      ["Cash, cash equivalents and restricted cash", "Cash, cash equivalents and restricted cash", "Cash, cash equivalents and restricted cash", "$", "12,392", "", "$", "13,619", ""],
    ];
    const cashFlowMatrix = [
      ["STATEMENT OF CASH FLOWS", "STATEMENT OF CASH FLOWS", "STATEMENT OF CASH FLOWS", "", "", "", "", "", "", "", "", ""],
      ["For the years ended December 31 (In millions)", "For the years ended December 31 (In millions)", "For the years ended December 31 (In millions)", "2025", "2025", "2025", "2024", "2024", "2024", "2023", "2023", "2023"],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["Net income (loss)", "Net income (loss)", "Net income (loss)", "$", "8,698", "", "$", "6,566", "", "$", "9,445", ""],
    ];

    expect(__test_detectDataStart(balanceSheetMatrix)).toBe(3);
    expect(__test_detectDataStart(cashFlowMatrix)).toBe(3);
  });
});

describe("primary face numeric density gates", () => {
  it("rejects balance-sheet tables with fewer than 11 numeric cells per period column", () => {
    const html = `
      <html><body>
        <p>ITEM 8. FINANCIAL STATEMENTS</p>
        <p>Lease footnote</p>
        <table>
          <tr><td></td><td>September 30, 2022</td><td>September 30, 2021</td></tr>
          <tr><td>Operating lease right-of-use assets</td><td>36,690</td><td>47,280</td></tr>
          <tr><td>Current operating lease liabilities</td><td>19,370</td><td>22,070</td></tr>
          <tr><td>Non-current operating lease liabilities</td><td>39,190</td><td>53,670</td></tr>
          <tr><td>Total lease liabilities</td><td>58,560</td><td>75,740</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>September 30, 2022</td><td>September 30, 2021</td></tr>
          <tr><td>Cash and cash equivalents</td><td>200,000</td><td>180,000</td></tr>
          <tr><td>Accounts receivable, net</td><td>350,000</td><td>320,000</td></tr>
          <tr><td>Inventory</td><td>90,000</td><td>85,000</td></tr>
          <tr><td>Prepaid expenses</td><td>20,000</td><td>18,000</td></tr>
          <tr><td>Total current assets</td><td>600,000</td><td>550,000</td></tr>
          <tr><td>Goodwill</td><td>800,000</td><td>790,000</td></tr>
          <tr><td>Property and equipment, net</td><td>700,000</td><td>680,000</td></tr>
          <tr><td>Total assets</td><td>2,500,000</td><td>2,400,000</td></tr>
          <tr><td>Accounts payable</td><td>50,000</td><td>48,000</td></tr>
          <tr><td>Total current liabilities</td><td>120,000</td><td>115,000</td></tr>
          <tr><td>Long-term debt</td><td>900,000</td><td>950,000</td></tr>
          <tr><td>Total liabilities</td><td>1,200,000</td><td>1,150,000</td></tr>
          <tr><td>Total stockholders' equity</td><td>1,300,000</td><td>1,250,000</td></tr>
        </table>
      </body></html>
    `;

    const $ = cheerio.load(html);
    const tables = $("table")
      .toArray()
      .map((el) => ({ el: el as cheerio.Element }));
    const leaseCount = __test_countStatementTableNumericCellsOrTags($, tables[0]!);
    const faceCount = __test_countStatementTableNumericCellsOrTags($, tables[1]!);
    expect(leaseCount).toBeLessThan(faceCount);
    expect(__test_statementTableMeetsMinNumbersPerPeriodColumn($, tables[0]!)).toBe(false);
    expect(__test_statementTableMeetsMinNumbersPerPeriodColumn($, tables[1]!)).toBe(true);

    const bs = parseFixtureStatementHtml(html, {
      kind: "bs",
      form: "10-K",
      primaryDocument: "numeric-gate.htm",
    });
    expect(bs?.rows.some((r) => /lease liabilities/i.test(r.label))).toBe(false);
    expect(bs?.rows.some((r) => /total assets/i.test(r.label))).toBe(true);
  });

  it("accepts balance sheets with on-face held-for-sale asset lines (LUMN-style)", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>March 31, 2026</td><td>December 31, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>200</td><td>180</td></tr>
          <tr><td>Accounts receivable</td><td>350</td><td>320</td></tr>
          <tr><td>Assets held for sale</td><td>25</td><td>30</td></tr>
          <tr><td>Inventory</td><td>90</td><td>85</td></tr>
          <tr><td>Prepaid expenses</td><td>20</td><td>18</td></tr>
          <tr><td>Total current assets</td><td>600</td><td>550</td></tr>
          <tr><td>Goodwill</td><td>800</td><td>790</td></tr>
          <tr><td>Property, plant and equipment, net</td><td>700</td><td>680</td></tr>
          <tr><td>Total assets</td><td>2,500</td><td>2,400</td></tr>
          <tr><td>Accounts payable</td><td>50</td><td>48</td></tr>
          <tr><td>Total current liabilities</td><td>120</td><td>115</td></tr>
          <tr><td>Long-term debt</td><td>900</td><td>950</td></tr>
          <tr><td>Total liabilities</td><td>1,200</td><td>1,150</td></tr>
        </table>
      </body></html>
    `;

    const bs = parseFixtureStatementHtml(html, { kind: "bs", form: "10-Q", primaryDocument: "lumn-style-bs.htm" });
    expect(bs).not.toBeNull();
    expect(bs?.rows.some((r) => /assets held for sale/i.test(r.label))).toBe(true);
    expect(bs?.rows.some((r) => /total assets/i.test(r.label) && !/held for sale/i.test(r.label))).toBe(true);
  });

  it("accepts balance sheets with on-face operating lease lines (FICO-style split iXBRL)", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Condensed Consolidated Balance Sheets</p>
        <p>(In thousands, except par value data)</p>
        <table>
          <tr><td></td><td>March 31, 2026</td><td>September 30, 2025</td></tr>
          <tr><td>Cash and cash equivalents</td><td>200,000</td><td>180,000</td></tr>
          <tr><td>Accounts receivable, net</td><td>350,000</td><td>320,000</td></tr>
          <tr><td>Operating lease right-of-use assets</td><td>36,690</td><td>47,280</td></tr>
          <tr><td>Inventory</td><td>90,000</td><td>85,000</td></tr>
          <tr><td>Prepaid expenses</td><td>20,000</td><td>18,000</td></tr>
          <tr><td>Total current assets</td><td>600,000</td><td>550,000</td></tr>
          <tr><td>Goodwill</td><td>800,000</td><td>790,000</td></tr>
          <tr><td>Property and equipment, net</td><td>700,000</td><td>680,000</td></tr>
          <tr><td>Total assets</td><td>2,500,000</td><td>2,400,000</td></tr>
          <tr><td>Current operating lease liabilities</td><td>19,370</td><td>22,070</td></tr>
          <tr><td>Accounts payable</td><td>50,000</td><td>48,000</td></tr>
          <tr><td>Total current liabilities</td><td>120,000</td><td>115,000</td></tr>
          <tr><td>Long-term debt</td><td>900,000</td><td>950,000</td></tr>
          <tr><td>Total liabilities</td><td>1,200,000</td><td>1,150,000</td></tr>
        </table>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three Months Ended March 31, 2026</td><td>Three Months Ended March 31, 2025</td></tr>
          <tr><td>Revenues</td><td>500,000</td><td>480,000</td></tr>
          <tr><td>Cost of revenues</td><td>200,000</td><td>190,000</td></tr>
          <tr><td>Net income</td><td>40,000</td><td>35,000</td></tr>
        </table>
      </body></html>
    `;

    const bs = parseFixtureStatementHtml(html, { kind: "bs", form: "10-Q", primaryDocument: "fico-style-bs.htm" });
    expect(bs).not.toBeNull();
    expect(bs?.rows.some((r) => /total assets/i.test(r.label))).toBe(true);
    expect(bs?.rows.some((r) => /total liabilities/i.test(r.label))).toBe(true);
  });

  it("picks the first size-qualified income statement table in Item 8", () => {
    const html = `
      <html><body>
        <p>ITEM 8. FINANCIAL STATEMENTS</p>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>2025</td><td>2024</td><td>2023</td></tr>
          <tr><td>Operating revenue</td><td>12,402</td><td>13,102</td><td>14,000</td></tr>
          <tr><td>Cost of revenue</td><td>8,100</td><td>8,500</td><td>9,000</td></tr>
          <tr><td>Gross profit</td><td>4,302</td><td>4,602</td><td>5,000</td></tr>
          <tr><td>Operating income</td><td>1,200</td><td>1,400</td><td>1,600</td></tr>
          <tr><td>Interest expense</td><td>900</td><td>950</td><td>1,000</td></tr>
          <tr><td>Net loss</td><td>(500)</td><td>(400)</td><td>(300)</td></tr>
          <tr><td>Depreciation</td><td>200</td><td>180</td><td>160</td></tr>
          <tr><td>SG&amp;A</td><td>1,500</td><td>1,450</td><td>1,400</td></tr>
          <tr><td>Other expense</td><td>100</td><td>90</td><td>80</td></tr>
          <tr><td>Tax benefit</td><td>50</td><td>40</td><td>30</td></tr>
          <tr><td>Net loss per share</td><td>(0.50)</td><td>(0.40)</td><td>(0.30)</td></tr>
          <tr><td>Weighted average shares</td><td>1,000</td><td>1,000</td><td>1,000</td></tr>
        </table>
        <p>Consolidated Statements of Comprehensive Income</p>
        <table>
          <tr><td></td><td>2025</td><td>2024</td><td>2023</td></tr>
          <tr><td>Net loss</td><td>(500)</td><td>(400)</td><td>(300)</td></tr>
          <tr><td>Other comprehensive income (loss), net of tax</td><td></td><td></td><td></td></tr>
          <tr><td>Foreign currency translation</td><td>10</td><td>(5)</td><td>8</td></tr>
          <tr><td>Pension adjustments</td><td>5</td><td>3</td><td>2</td></tr>
          <tr><td>Derivative adjustments</td><td>2</td><td>1</td><td>0</td></tr>
          <tr><td>Unrealized gains on securities</td><td>4</td><td>3</td><td>2</td></tr>
          <tr><td>Total other comprehensive income</td><td>21</td><td>2</td><td>12</td></tr>
          <tr><td>Comprehensive loss</td><td>(479)</td><td>(398)</td><td>(288)</td></tr>
          <tr><td>Extra row A</td><td>1</td><td>1</td><td>1</td></tr>
          <tr><td>Extra row B</td><td>1</td><td>1</td><td>1</td></tr>
          <tr><td>Extra row C</td><td>1</td><td>1</td><td>1</td></tr>
          <tr><td>Extra row D</td><td>1</td><td>1</td><td>1</td></tr>
          <tr><td>Extra row E</td><td>1</td><td>1</td><td>1</td></tr>
        </table>
      </body></html>
    `;

    const $ = cheerio.load(html);
    const tables = $("table")
      .toArray()
      .map((el) => ({ el: el as cheerio.Element }));
    const ociCount = __test_countStatementTableNumericCellsOrTags($, tables[1]!);
    const faceCount = __test_countStatementTableNumericCellsOrTags($, tables[0]!);
    expect(ociCount).toBeGreaterThanOrEqual(12);
    expect(faceCount).toBeGreaterThanOrEqual(12);
    expect(__test_statementTableTextLooksLikePrimaryFace($, tables[0]!, "is")).toBe(true);

    const is = parseFixtureStatementHtml(html, { kind: "is", form: "10-K", primaryDocument: "oci-gate.htm" });
    expect(is?.rows.some((r) => /operating revenue/i.test(r.label))).toBe(true);
    expect(is?.rows.some((r) => /other comprehensive income/i.test(r.label))).toBe(false);
  });

  it("picks the consolidated balance sheet before a later parenthetical held-for-sale table", () => {
    const html = `
      <html><body>
        <p>ITEM 8. FINANCIAL STATEMENTS</p>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>2025</td><td>2024</td></tr>
          <tr><td>Cash and cash equivalents</td><td>200</td><td>180</td></tr>
          <tr><td>Accounts receivable</td><td>350</td><td>320</td></tr>
          <tr><td>Inventory</td><td>100</td><td>90</td></tr>
          <tr><td>Total current assets</td><td>650</td><td>590</td></tr>
          <tr><td>Property and equipment</td><td>800</td><td>790</td></tr>
          <tr><td>Goodwill</td><td>500</td><td>490</td></tr>
          <tr><td>Total assets</td><td>2,500</td><td>2,400</td></tr>
          <tr><td>Accounts payable</td><td>50</td><td>48</td></tr>
          <tr><td>Total current liabilities</td><td>120</td><td>115</td></tr>
          <tr><td>Long-term debt</td><td>900</td><td>950</td></tr>
          <tr><td>Total liabilities</td><td>1,200</td><td>1,150</td></tr>
          <tr><td>Total stockholders' equity</td><td>1,300</td><td>1,250</td></tr>
        </table>
        <p>Assets and liabilities held for sale (parenthetical)</p>
        <table>
          <tr><td></td><td>2025</td></tr>
          <tr><td>Total assets held for sale</td><td>100</td></tr>
          <tr><td>Total liabilities held for sale</td><td>40</td></tr>
        </table>
      </body></html>
    `;

    const $ = cheerio.load(html);
    const tables = $("table")
      .toArray()
      .map((el) => ({ el: el as cheerio.Element }));
    expect(__test_statementTableTextLooksLikePrimaryFace($, tables[1]!, "bs")).toBe(false);

    const bs = parseFixtureStatementHtml(html, { kind: "bs", form: "10-K", primaryDocument: "parenthetical-gate.htm" });
    expect(bs?.rows.some((r) => /held for sale/i.test(r.label))).toBe(false);
    expect(bs?.rows.some((r) => /total assets/i.test(r.label) && !/held for sale/i.test(r.label))).toBe(true);
  });
});

describe("FilingSummary merge guards", () => {
  function taggedPrimaryIs(periodCount: number): FilingHtmlStatement {
    const periods = Array.from({ length: periodCount }, (_, idx) => ({
      key: `p${idx + 1}`,
      label: `20${25 - idx}`,
    }));
    return {
      id: "income-statement",
      title: "Income Statement",
      role: "Income Statement",
      units: "(Dollars in millions)",
      sourceHtmlFile: "lumn-20251231.htm",
      periods,
      rows: [
        {
          concept: "us-gaap:Revenues",
          label: "Operating revenue",
          depth: 0,
          rowKind: "data",
          valueFormat: "usd_millions",
          values: Object.fromEntries(periods.map((p, idx) => [p.key, 12_402 - idx * 500])),
          displayValues: Object.fromEntries(periods.map((p, idx) => [p.key, String(12_402 - idx * 500)])),
          ixByPeriod: Object.fromEntries(
            periods.map((p) => [
              p.key,
              {
                visibleText: "12,402",
                xbrlConcept: "us-gaap:Revenues",
                contextRef: "c1",
                unitRef: "usd",
                decimals: "-6",
                scale: 6,
                format: null,
                sign: null,
                rawValue: 12_402_000_000,
              },
            ])
          ),
        },
      ],
    };
  }

  function filingSummaryIs(): FilingHtmlStatement {
    return {
      id: "income-statement",
      title: "Income Statement",
      role: "Income Statement",
      units: "shares in Thousands",
      sourceHtmlFile: "R3.htm",
      periods: [
        { key: "p1", label: "2025" },
        { key: "p2", label: "2024" },
        { key: "p3", label: "2023" },
      ],
      rows: [
        {
          concept: "html:operating-revenue",
          label: "Operating revenue",
          depth: 0,
          rowKind: "data",
          valueFormat: "usd_millions",
          values: { p1: 12_402_000, p2: 13_108_000, p3: 14_557_000 },
          displayValues: { p1: "12,402,000,000", p2: "13,108,000,000", p3: "14,557,000,000" },
        },
        {
          concept: "html:cost",
          label: "Cost of services and products",
          depth: 0,
          rowKind: "data",
          valueFormat: "usd_millions",
          values: { p1: 5_000_000, p2: 5_100_000, p3: 5_200_000 },
          displayValues: { p1: "5,000,000", p2: "5,100,000", p3: "5,200,000" },
        },
        {
          concept: "html:sga",
          label: "Selling, general and administrative",
          depth: 0,
          rowKind: "data",
          valueFormat: "usd_millions",
          values: { p1: 4_000_000, p2: 4_100_000, p3: 4_200_000 },
          displayValues: { p1: "4,000,000", p2: "4,100,000", p3: "4,200,000" },
        },
      ],
    };
  }

  it("keeps tagged primary HTML over untagged FilingSummary slices with extra periods", () => {
    const merged = __test_mergeStatementsById([taggedPrimaryIs(2)], [filingSummaryIs()], "10-K");
    const is = merged.find((s) => s.id === "income-statement");
    expect(is?.sourceHtmlFile).toBe("lumn-20251231.htm");
    expect(is?.periods).toHaveLength(2);
    expect(is?.units).toContain("Dollars in millions");
    expect(is?.rows[0]?.values.p1).toBe(12_402);
  });

  it("still fills a missing statement from FilingSummary", () => {
    const fsBs: FilingHtmlStatement = {
      id: "balance-sheet",
      title: "Balance Sheet",
      role: "Balance Sheet",
      units: "in Millions",
      sourceHtmlFile: "R6.htm",
      periods: [
        { key: "p1", label: "2025" },
        { key: "p2", label: "2024" },
      ],
      rows: [
        {
          concept: "html:cash",
          label: "Cash and cash equivalents",
          depth: 0,
          rowKind: "data",
          valueFormat: "usd_millions",
          values: { p1: 1003, p2: 1889 },
          displayValues: { p1: "1,003", p2: "1,889" },
        },
      ],
    };
    const merged = __test_mergeStatementsById([taggedPrimaryIs(2)], [filingSummaryIs(), fsBs], "10-K");
    expect(merged.find((s) => s.id === "balance-sheet")?.sourceHtmlFile).toBe("R6.htm");
  });

  it("prefers dollars in millions over shares in thousands in compound unit notes", () => {
    const units = __test_extractMonetaryUnitsFromText(
      "(Dollars in millions, except per share amounts, and shares in thousands)"
    );
    expect(units).toContain("Dollars in millions");
    expect(units?.toLowerCase()).not.toMatch(/^shares/);
  });

  it("rejects TOC Item 8 lines with page numbers and the next item on the same row", () => {
    const html = `
      <html><body>
        <p>PART II</p>
        <p>Item 8. Financial Statements and Supplementary Data 67 Item 9. Changes in and Disagreements</p>
        <p>Item 1. Business</p>
        <table><tr><td>State</td><td>Lines</td></tr></table>
        <p>PART II</p>
        <p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
        <p>Index to Consolidated Financial Statements</p>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2006</td><td>Year Ended December 31, 2005</td><td>Year Ended December 31, 2004</td></tr>
          <tr><td>Total revenues</td><td>1000</td><td>900</td><td>850</td></tr>
          <tr><td>Cost of revenues</td><td>400</td><td>380</td><td>360</td></tr>
          <tr><td>Operating income</td><td>200</td><td>180</td><td>170</td></tr>
          <tr><td>Net income</td><td>120</td><td>100</td><td>90</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>December 31, 2006</td><td>December 31, 2005</td></tr>
          <tr><td>Cash and cash equivalents</td><td>50</td><td>48</td></tr>
          <tr><td>Total current assets</td><td>120</td><td>110</td></tr>
          <tr><td>Total assets</td><td>500</td><td>480</td></tr>
          <tr><td>Total liabilities</td><td>200</td><td>190</td></tr>
          <tr><td>Total stockholders' equity</td><td>300</td><td>290</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Year Ended December 31, 2006</td><td>Year Ended December 31, 2005</td><td>Year Ended December 31, 2004</td></tr>
          <tr><td>Net income</td><td>120</td><td>100</td><td>90</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>150</td><td>130</td><td>120</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-40</td><td>-35</td><td>-30</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-20</td><td>-15</td><td>-10</td></tr>
        </table>
      </body></html>
    `;
    const statements = parseFixtureStatementsFromHtml(html, { form: "10-K", primaryDocument: "legacy10k.htm" });
    expect(statements.map((s) => s.id).sort()).toEqual(["balance-sheet", "cash-flow", "income-statement"]);
  });

  it("anchors 10-Q Item 1 when Part II appears soon after Part I in the TOC block", () => {
    const html = `
      <html><body>
        <p>PART I</p>
        <p>Item 1. Financial Statements 4</p>
        <p>PART II 10</p>
        <p>PART I</p>
        <p>ITEM 1. FINANCIAL STATEMENTS</p>
        <p>Consolidated Statements of Operations</p>
        <table>
          <tr><td></td><td>Three months ended September 30, 2006</td><td>Three months ended September 30, 2005</td></tr>
          <tr><td>Total revenues</td><td>1000</td><td>900</td></tr>
          <tr><td>Cost of revenues</td><td>400</td><td>380</td></tr>
          <tr><td>Gross profit</td><td>600</td><td>520</td></tr>
          <tr><td>Operating income</td><td>200</td><td>180</td></tr>
          <tr><td>Net income</td><td>120</td><td>100</td></tr>
        </table>
        <p>Consolidated Balance Sheets</p>
        <table>
          <tr><td></td><td>September 30, 2006</td><td>December 31, 2005</td></tr>
          <tr><td>Cash and cash equivalents</td><td>50</td><td>48</td></tr>
          <tr><td>Total current assets</td><td>120</td><td>110</td></tr>
          <tr><td>Total assets</td><td>500</td><td>480</td></tr>
          <tr><td>Total liabilities</td><td>200</td><td>190</td></tr>
          <tr><td>Total stockholders' equity</td><td>300</td><td>290</td></tr>
        </table>
        <p>Consolidated Statements of Cash Flows</p>
        <table>
          <tr><td></td><td>Nine months ended September 30, 2006</td><td>Nine months ended September 30, 2005</td></tr>
          <tr><td>Net income</td><td>120</td><td>100</td></tr>
          <tr><td>Net cash provided by operating activities</td><td>150</td><td>130</td></tr>
          <tr><td>Net cash used in investing activities</td><td>-40</td><td>-35</td></tr>
          <tr><td>Net cash used in financing activities</td><td>-20</td><td>-15</td></tr>
        </table>
      </body></html>
    `;
    const statements = parseFixtureStatementsFromHtml(html, { form: "10-Q", primaryDocument: "legacy10q.htm" });
    expect(statements.map((s) => s.id).sort()).toEqual(["balance-sheet", "cash-flow", "income-statement"]);
  });

  it("does not flag working-capital change lines on cash-flow statements", () => {
    const stmt = makeStatement(
      "cash-flow",
      [
        "Net income",
        "Adjustments to reconcile net income to net cash provided by operating activities:",
        "Depreciation and amortization",
        "Deferred income taxes",
        "Changes in current assets and current liabilities:",
        "Accounts receivable",
      ],
      ["March 31, 2007", "March 31, 2006"]
    );
    expect(__test_validateStatementShape(stmt, "10-Q")).not.toContain("cash-flow: top rows look like another statement");
  });

  it("shape templates score consolidated income statements above segment decoys", () => {
    const template = buildPrimaryFaceShapeTemplateFromStatement({
      id: "income-statement",
      rows: [
        { label: "Total revenues", rowKind: "data" },
        { label: "Cost of revenues", rowKind: "data" },
        { label: "Gross profit", rowKind: "data" },
        { label: "Operating income", rowKind: "data" },
        { label: "Net income", rowKind: "data" },
        { label: "Supplemental line", rowKind: "data" },
      ],
    });
    expect(template).not.toBeNull();
    const faceScore = scoreShapeTemplateSimilarity(
      ["Total revenues", "Cost of revenues", "Gross profit", "Operating income", "Net income"],
      template!
    );
    const segmentScore = scoreShapeTemplateSimilarity(["Power", "Aviation", "Renewable Energy"], template!);
    expect(faceScore).toBeGreaterThan(segmentScore + 40);
  });
});
