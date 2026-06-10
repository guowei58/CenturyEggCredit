import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

const main = async () => {
  const res = await getAllFilingsByTickerCached("JNJ");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === "2024-06-30"
  );
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f!.accessionNumber,
    form: f!.form,
    primaryDocument: f!.primaryDocument,
    docUrl: f!.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "")!;
  console.log("primaryDocument", f!.primaryDocument);
  console.log("accBounds", __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, "10-Q"));
  console.log("resolved", __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q"));
  console.log("locator", locateFinancialStatementsSection(ctx, "10-Q"));
  const item1 = ctx.acc.indexOf("ITEM 1");
  const bs = ctx.acc.indexOf("Balance Sheet");
  console.log("ITEM 1@", item1, "Balance Sheet@", bs);
  console.log("preview@", item1 > 0 ? ctx.acc.slice(item1, item1 + 400).replace(/\s+/g, " ") : "n/a");
};

main().catch(console.error);
