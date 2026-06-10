import {
  __test_flatAccFromHtml,
  __test_resolvePrimaryFinancialStatementsItemStart,
} from "@/lib/sec-filing-financials";

function countIndexLines(head: string): number {
  const t = head.toLowerCase();
  return [
    /\b(?:consolidated\s+)?balance\s+sheets?\b[^.]{0,160}\(\s*unaudited\s*\)\s*\d{1,3}\b/,
    /\bstatements?\s+of\s+operations\b[^.]{0,160}\(\s*unaudited\s*\)\s*\d{1,3}\b/,
    /\bstatements?\s+of\s+cash\s+flows?\b[^.]{0,160}\(\s*unaudited\s*\)\s*\d{1,3}\b/,
  ].filter((re) => re.test(t)).length;
}

for (const label of ["simple", "optu"] as const) {
  const html =
    label === "simple"
      ? `
  <html><body>
    <p>PART I</p>
    <p>ITEM 1. FINANCIAL STATEMENTS</p>
    <p>Condensed Consolidated Statements of Operations</p>
    <table><tr><td>Total revenues</td><td>100</td><td>90</td></tr><tr><td>Net income</td><td>20</td><td>18</td></tr></table>
    <p>Condensed Consolidated Balance Sheets</p>
    <table><tr><td>Total assets</td><td>200</td><td>195</td></tr></table>
    <p>Condensed Consolidated Statements of Cash Flows</p>
    <table><tr><td>Net cash provided by operating activities</td><td>25</td><td>22</td></tr></table>
    <p>ITEM 2. MANAGEMENT'S DISCUSSION</p>
  </body></html>`
      : (() => {
          const filler = "<p>Supplemental disclosure paragraph.</p>\n".repeat(200);
          return `
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
    <table><tr><td>Cash and cash equivalents</td><td>100</td><td>90</td></tr><tr><td>Total assets</td><td>2000</td><td>1900</td></tr></table>
    <p>CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)</p>
    <table><tr><td>Revenue</td><td>800</td><td>750</td></tr><tr><td>Net income</td><td>120</td><td>110</td></tr></table>
    <p>CONSOLIDATED STATEMENTS OF CASH FLOWS (Unaudited)</p>
    <table><tr><td>Net income</td><td>120</td><td>110</td></tr><tr><td>Net cash provided by operating activities</td><td>150</td><td>140</td></tr></table>
    <p>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION</p>
  </body></html>`;
        })();

  const acc = __test_flatAccFromHtml(html);
  const itemRe =
    /\bITEM\s+1[\.\u2014\u2013\-]?\s*(?:(?:condensed|consolidated|combined|unaudited)\s+){0,4}FINANCIAL\s+STATEMENTS\b/gi;
  const itemStarts = [...acc.matchAll(itemRe)].map((m) => m.index);
  const start = __test_resolvePrimaryFinancialStatementsItemStart(acc, "10-Q");
  console.log(`\n=== ${label} ===`);
  console.log("len", acc.length, "itemStarts", itemStarts, "resolved", start);
  for (const idx of itemStarts) {
    if (idx == null) continue;
    const preview = acc.slice(idx, idx + 15_000);
    console.log(" at", idx, "indexLines", countIndexLines(preview.slice(0, 12_000)));
    console.log("  snippet", acc.slice(idx, idx + 90));
  }
}
