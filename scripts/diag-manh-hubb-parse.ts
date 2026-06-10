import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_resolveFinancialStatementsSectionBounds,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

const cases = [
  { ticker: "MANH", period: "2024-03-31" },
  { ticker: "HUBB", period: "2024-03-31" },
] as const;

async function main() {
  for (const c of cases) {
    const res = await getAllFilingsByTickerCached(c.ticker);
    const f = res?.filings.find(
      (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === c.period
    );
    if (!f) {
      console.log(c.ticker, "missing filing");
      continue;
    }
    const bundle = await fetchHtmlFilingStatementsBundle({
      cik: res!.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    const html = bundle.primaryHtml ?? "";
    const ctx = buildParsedFilingHtmlContext(html)!;
    const resolved = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q");
    const locator = locateFinancialStatementsSection(ctx, "10-Q");
    const statements = parsePrimaryFilingStatementsFromHtml(html, {
      form: "10-Q",
      primaryDocument: f.primaryDocument,
      sourceUrl: f.docUrl,
    });
    console.log(`\n=== ${c.ticker} ${c.period} ===`);
    console.log("resolved", resolved);
    console.log("locator", locator?.section, "scanCeiling", locator?.scanCeiling);
    console.log(
      "parsed",
      statements.length,
      statements.map((s) => `${s.id}:${s.rows.length}rows`)
    );
  }
}

main().catch(console.error);
