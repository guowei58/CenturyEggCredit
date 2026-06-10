import {
  __test_flatAccFromHtml,
  __test_resolvePrimaryFinancialStatementsItemStart,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
} from "@/lib/sec-filing-financials";

const html = `
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
      <tr><td>Total assets</td><td>200</td><td>195</td></tr>
    </table>
    <p>Condensed Consolidated Statements of Cash Flows</p>
    <table>
      <tr><td>Net cash provided by operating activities</td><td>25</td><td>22</td></tr>
    </table>
    <p>ITEM 2. MANAGEMENT'S DISCUSSION</p>
  </body></html>
`;

const acc = __test_flatAccFromHtml(html);
const start = __test_resolvePrimaryFinancialStatementsItemStart(acc, "10-Q");
const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-Q");
console.log("acc len", acc.length);
console.log("start", start, start != null ? acc.slice(start, start + 80) : null);
console.log("bounds", bounds, bounds ? bounds.end - bounds.start : null);
