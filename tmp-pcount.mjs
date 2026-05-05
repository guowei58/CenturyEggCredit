const html = `<html><body>
<p>ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA</p>
<p>Notes to Consolidated Financial Statements</p>
<p><b>Note 1 - Summary</b></p>
<p>Organization and basis of presentation.</p>
<p><b>Note 13 "Goodwill and Intangible Assets."</b></p>
<p>67 Accumulated Other Comprehensive Loss . Our accumulated other comprehensive loss balances as of December 31, 2025 consisted of adjustments to our pension asset and the related income tax effects including interest rate caps.</p>
<p><b>Note 2 - Accounting Policies</b></p>
<p>Estimates are required.</p>
<p><b>Note 4 - Debt</b></p>
<p>Our credit agreement provides a revolving credit facility.</p>
<table><tr><td>Total debt</td><td>500</td></tr></table>
<p><b>Note 14 - Income Taxes</b></p>
<p>Tax disclosure.</p>
</body></html>`;
const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
let m;
let i = 0;
while ((m = re.exec(html)) !== null) {
  console.log(i++, strip(m[2]).slice(0, 70));
}
function strip(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
