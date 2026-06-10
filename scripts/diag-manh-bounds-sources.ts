import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_resolveFinancialStatementsSectionBounds,
  __test_resolvePrimaryFinancialStatementsItemStart,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

const main = async () => {
  const res = await getAllFilingsByTickerCached("MANH");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === "2024-03-31"
  );
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f!.accessionNumber,
    form: f!.form,
    primaryDocument: f!.primaryDocument,
    docUrl: f!.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;

  console.log("itemStart", __test_resolvePrimaryFinancialStatementsItemStart(ctx.acc, "10-Q"));
  console.log("accBounds", __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, "10-Q"));
  console.log("locator", locateFinancialStatementsSection(ctx, "10-Q"));
  console.log("resolved", __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q"));
};

main().catch(console.error);
