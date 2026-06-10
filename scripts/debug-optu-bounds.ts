import {
  __test_flatAccFromHtml,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_resolvePrimaryFinancialStatementsItemStart,
} from "@/lib/sec-filing-financials";

const filler = "<p>Supplemental disclosure paragraph.</p>\n".repeat(200);
const html = `
  <html><body>
    <p>TABLE OF CONTENTS</p>
    <p>PART I. FINANCIAL INFORMATION Page</p>
    <p>Item 1. Financial Statements ALTICE USA, INC. AND SUBSIDIARIES</p>
    <p>Consolidated Balance Sheets - March 31, 2025 (Unaudited) 4</p>
    <p>Consolidated Statements of Operations - Three months ended March 31, 2025 (Unaudited) 5</p>
    <p>Consolidated Statements of Cash Flows - Three months ended March 31, 2025 (Unaudited) 8</p>
    <p>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations 12</p>
    ${filler}
    <p>Item 1. Financial Statements ALTICE USA, INC. AND SUBSIDIARIES</p>
    <p>CONSOLIDATED BALANCE SHEETS (Unaudited)</p>
    <table>
      <tr><td>Cash and cash equivalents</td><td>100</td><td>90</td></tr>
      <tr><td>Total current assets</td><td>500</td><td>450</td></tr>
      <tr><td>Total assets</td><td>2000</td><td>1900</td></tr>
      <tr><td>Total liabilities and stockholders equity</td><td>2000</td><td>1900</td></tr>
    </table>
    <p>CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)</p>
    <table>
      <tr><td>Revenue</td><td>800</td><td>750</td></tr>
      <tr><td>Operating expenses</td><td>600</td><td>550</td></tr>
      <tr><td>Operating income</td><td>200</td><td>200</td></tr>
      <tr><td>Net income</td><td>120</td><td>110</td></tr>
    </table>
    <p>CONSOLIDATED STATEMENTS OF CASH FLOWS (Unaudited)</p>
    <table>
      <tr><td>Net income</td><td>120</td><td>110</td></tr>
      <tr><td>Depreciation and amortization</td><td>40</td><td>35</td></tr>
      <tr><td>Net cash provided by operating activities</td><td>150</td><td>140</td></tr>
      <tr><td>Net cash used in investing activities</td><td>-20</td><td>-15</td></tr>
      <tr><td>Net cash used in financing activities</td><td>-10</td><td>-8</td></tr>
    </table>
    <p>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION</p>
  </body></html>
`;

const acc = __test_flatAccFromHtml(html);
console.log(
  "PART I hits",
  [...acc.matchAll(/\bPART\s+I\b/gi)].map((m) => [m.index, acc.slice(m.index!, m.index! + 60)])
);
console.log("acc len", acc.length);
const itemRe =
  /\bITEM\s+1[\.\u2014\u2013\-]?\s*(?:(?:condensed|consolidated|combined|unaudited)\s+){0,4}FINANCIAL\s+STATEMENTS\b/gi;
const partI = [...acc.matchAll(/\bPART\s+I\b/gi)].map((m) => m.index ?? 0);
const searchStart = partI[0] ?? 0;
const itemStarts: number[] = [];
for (let m = itemRe.exec(acc); m; m = itemRe.exec(acc)) {
  if ((m.index ?? 0) >= searchStart) itemStarts.push(m.index ?? 0);
}
console.log("searchStart", searchStart, "itemStarts", itemStarts);
const bodyStart = 7448;
const preview = acc.slice(bodyStart, bodyStart + 15_000);
const hasBodyFaceHeading =
  /\b(?:statements?\s+of\s+(?:operations|income)|balance\s+sheets?|statements?\s+of\s+cash\s+flows?)\b[^.]{0,160}\(unaudited\)/i.test(
    preview
  );
console.log("hasBodyFaceHeading", hasBodyFaceHeading, preview.slice(0, 120));
const start = __test_resolvePrimaryFinancialStatementsItemStart(acc, "10-Q");
console.log("start", start, start != null ? acc.slice(start, start + 100) : null);
const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-Q");
console.log("bounds", bounds);
const re = /\bITEM\s+1[\.\u2014\u2013\-]?\s*(?:(?:condensed|consolidated|combined|unaudited)\s+){0,4}FINANCIAL\s+STATEMENTS\b/gi;
console.log("item1 pattern hits", [...acc.matchAll(re)].map((m) => [m.index, acc.slice(m.index!, m.index! + 80)]));
