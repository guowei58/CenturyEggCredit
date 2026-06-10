import {
  __test_flatAccFromHtml,
  __test_resolvePrimaryFinancialStatementsItemStart,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
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
      <tr><td>Total assets</td><td>2000</td><td>1900</td></tr>
    </table>
    <p>CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)</p>
    <table>
      <tr><td>Revenue</td><td>800</td><td>750</td></tr>
      <tr><td>Net income</td><td>120</td><td>110</td></tr>
    </table>
    <p>CONSOLIDATED STATEMENTS OF CASH FLOWS (Unaudited)</p>
    <table>
      <tr><td>Net income</td><td>120</td><td>110</td></tr>
      <tr><td>Net cash provided by operating activities</td><td>150</td><td>140</td></tr>
    </table>
    <p>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION</p>
  </body></html>
`;

const acc = __test_flatAccFromHtml(html);
const start = __test_resolvePrimaryFinancialStatementsItemStart(acc, "10-Q");
const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-Q");
console.log("acc len", acc.length);
console.log("start", start, start != null ? acc.slice(start, start + 100) : null);
console.log("bounds", bounds, bounds ? bounds.end - bounds.start : null);
