import {
  parsePrimaryFilingStatementHtml,
  parsePrimaryFilingStatementsFromHtml,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_flatAccFromHtml,
  __test_primaryClusterTableSnippets,
  __test_headingBsPick,
  __test_maxCfScore,
} from "../src/lib/sec-filing-financials";

const googBsHtml = `
<html><body>
<p>PART II</p>
<p>ITEM 6. FINANCIAL DATA</p>
<table>
<tr><td></td><td>Dec 31, 2016</td><td>Dec 31, 2015</td></tr>
<tr><td>Cash, cash equivalents, and marketable securities</td><td>86333</td><td>73066</td></tr>
<tr><td>Total assets</td><td>167497</td><td>147461</td></tr>
<tr><td>Total stockholders' equity</td><td>139036</td><td>120331</td></tr>
</table>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Consolidated Balance Sheets</p>
<table>
<tr><td></td><td>December 31, 2016</td><td>December 31, 2015</td></tr>
<tr><td>Cash and cash equivalents</td><td>12918</td><td>16949</td></tr>
<tr><td>Total assets</td><td>167497</td><td>147461</td></tr>
</table>
</body></html>`;

const item8Html = `
<html><body>
<p>PART II</p>
<p>ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS</p>
<table>
<tr><td></td><td>2025</td><td>2024</td></tr>
<tr><td>Total revenues</td><td>900</td><td>800</td></tr>
</table>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Consolidated Statements of Operations</p>
<table>
<tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td></tr>
<tr><td>Total revenues</td><td>200</td><td>180</td></tr>
</table>
<p>ITEM 9. CHANGES</p>
</body></html>`;

const acc = __test_flatAccFromHtml(googBsHtml);
console.log("goog bounds", __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-K"));
console.log("goog bs", parsePrimaryFilingStatementHtml(googBsHtml, { kind: "bs", form: "10-K", primaryDocument: "t.htm" })?.rows[0]?.label);

const is = parsePrimaryFilingStatementHtml(item8Html, { kind: "is", form: "10-K", primaryDocument: "t.htm" });
console.log("item8 is p1", is?.rows[0]?.values.p1, "label", is?.rows[0]?.label);

const googFull = `
<html><body>
<p>PART II</p>
<p>ITEM 6. FINANCIAL DATA</p>
<p>Selected consolidated financial data (unaudited)</p>
<table>
<tr><td></td><td>Dec 31, 2016</td><td>Dec 31, 2015</td><td>Dec 31, 2014</td><td>Dec 31, 2013</td><td>Dec 31, 2012</td></tr>
<tr><td>Revenues</td><td>90272</td><td>74989</td></tr>
</table>
<table>
<tr><td></td><td>Dec 31, 2016</td><td>Dec 31, 2015</td></tr>
<tr><td>Cash, cash equivalents, and marketable securities</td><td>86333</td><td>73066</td></tr>
<tr><td>Total assets</td><td>167497</td><td>147461</td></tr>
<tr><td>Total stockholders' equity</td><td>139036</td><td>120331</td></tr>
</table>
<table>
<tr><td></td><td>2016</td><td>2015</td></tr>
<tr><td>Net cash provided by operating activities</td><td>36036</td><td>26572</td></tr>
</table>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>INDEX TO CONSOLIDATED FINANCIAL STATEMENTS</p>
<p>Consolidated Statements of Income</p>
<table>
<tr><td></td><td>Year Ended December 31, 2016</td><td>Year Ended December 31, 2015</td></tr>
<tr><td>Revenues</td><td>90272</td><td>74989</td></tr>
<tr><td>Cost of revenues</td><td>35058</td><td>28164</td></tr>
</table>
<p>Consolidated Balance Sheets</p>
<table>
<tr><td></td><td>December 31, 2016</td><td>December 31, 2015</td></tr>
<tr><td>Cash and cash equivalents</td><td>12918</td><td>16949</td></tr>
<tr><td>Total assets</td><td>167497</td><td>147461</td></tr>
</table>
<p>Consolidated Statements of Cash Flows</p>
<table>
<tr><td></td><td>Year Ended December 31, 2016</td><td>Year Ended December 31, 2015</td></tr>
<tr><td>Net income</td><td>19478</td><td>16348</td></tr>
<tr><td>Net cash provided by operating activities</td><td>36036</td><td>26572</td></tr>
</table>
<p>Notes to Consolidated Financial Statements</p>
</body></html>`;

console.log("googFull is", parsePrimaryFilingStatementHtml(googFull, { kind: "is", form: "10-K", primaryDocument: "g.htm" })?.rows[0]?.label);
console.log("googFull bs", parsePrimaryFilingStatementHtml(googFull, { kind: "bs", form: "10-K", primaryDocument: "g.htm" })?.rows[0]?.label);
console.log("googFull batch", parsePrimaryFilingStatementsFromHtml(googFull, { form: "10-K" }).map((s) => s.id));
const cluster = __test_primaryClusterTableSnippets(googFull, "10-K");
console.log("googFull cluster", cluster ? JSON.stringify(cluster) : "null");
console.log("googFull headingBs", __test_headingBsPick(googFull, "10-K"));

const item8Full = `
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
<tr><td></td><td>Year Ended December 31, 2025</td><td>Year Ended December 31, 2024</td></tr>
<tr><td>Total revenues</td><td>200</td><td>180</td></tr>
<tr><td>Net income</td><td>40</td><td>35</td></tr>
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
<p>ITEM 9. CHANGES</p>
</body></html>`;
const isFull = parsePrimaryFilingStatementHtml(item8Full, { kind: "is", form: "10-K", primaryDocument: "t.htm" });
console.log("item8Full is p1", isFull?.rows[0]?.values.p1);

const item1Q = `
<html><body>
<p>PART I</p>
<p>ITEM 1. FINANCIAL STATEMENTS</p>
<p>Condensed Consolidated Statements of Operations</p>
<table>
<tr><td></td><td>Three Months Ended March 31, 2026</td><td>Three Months Ended March 31, 2025</td></tr>
<tr><td>Total revenues</td><td>100</td><td>90</td></tr>
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
<p>ITEM 2. MANAGEMENT</p>
<table><tr><td>Total revenues</td><td>999</td></tr></table>
</body></html>`;
console.log("item1Q batch", parsePrimaryFilingStatementsFromHtml(item1Q, { form: "10-Q" }).map((s) => s.id));
console.log("item1Q headingBs", __test_headingBsPick(item1Q, "10-Q"));

const clusterQ = `
<html><body>
<p>PART I</p>
<p>ITEM 1. FINANCIAL STATEMENTS</p>
<p>Notes to Condensed Consolidated Financial Statements</p>
<p>Consolidated Statements of Operations</p>
<table><tr><td>Note summary data</td><td>1</td><td>2</td></tr></table>
<p>ITEM 1. FINANCIAL STATEMENTS</p>
<p>Condensed Consolidated Statements of Operations</p>
<table><tr><td></td><td>Three Months Ended March 31, 2024</td><td>Three Months Ended March 30, 2023</td></tr><tr><td>Total net sales</td><td>120000</td><td>100000</td></tr></table>
<p>Condensed Consolidated Balance Sheets</p>
<table><tr><td></td><td>March 31, 2024</td><td>December 30, 2023</td></tr><tr><td>Cash and cash equivalents</td><td>45000</td><td>41000</td></tr><tr><td>Total assets</td><td>320000</td><td>310000</td></tr></table>
<p>Condensed Consolidated Statements of Cash Flows</p>
<table><tr><td></td><td>Three Months Ended March 31, 2024</td><td>Three Months Ended March 30, 2023</td></tr><tr><td>Operating activities:</td><td></td><td></td></tr><tr><td>Net income</td><td>30000</td><td>25000</td></tr><tr><td>Net cash provided by operating activities</td><td>35000</td><td>29000</td></tr></table>
<p>Notes to Condensed Consolidated Financial Statements</p>
<p>ITEM 2. MANAGEMENT</p>
</body></html>`;
const clusterAcc = __test_flatAccFromHtml(clusterQ);
console.log("clusterQ bounds", __test_findPrimaryFinancialStatementsItemSectionBounds(clusterAcc, "10-Q"));
console.log("clusterQ cf", parsePrimaryFilingStatementHtml(clusterQ, { kind: "cf", form: "10-Q" })?.rows.map((r) => r.label));
console.log("clusterQ snippets", __test_primaryClusterTableSnippets(clusterQ, "10-Q"));
console.log("clusterQ cfScore", __test_maxCfScore(clusterQ, "10-Q"));
