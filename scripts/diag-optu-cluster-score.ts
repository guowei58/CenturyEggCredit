import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_findStatementClusterInPrimaryItemSection,
} from "@/lib/sec-filing-financials";

async function probe(acc: string, label: string) {
  const res = await getAllFilingsByTickerCached("OPTU");
  const f = res!.filings.find((x) => x.accessionNumber === acc)!;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml!)!;
  const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, "10-Q");
  const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
  const early = bounds ? ctx.acc.slice(bounds.start, bounds.start + 1200) : "";
  const itemCount = (early.match(/\bitem\s+\d+[a-z]?\b/gi) ?? []).length;
  console.log(label, {
    bounds,
    sectionLen: bounds ? bounds.end - bounds.start : 0,
    itemCountInFirst1200: itemCount,
    cluster: cluster?.cluster.score ?? null,
  });
}

async function main() {
  await probe("0001628280-19-005707", "OK 2019-Q1");
  await probe("0001628280-19-013363", "FAIL 2019-Q3");
  await probe("0001628280-23-015294", "FAIL 2023-Q1");
}

main().catch(console.error);
