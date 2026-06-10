import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
} from "@/lib/sec-filing-financials";

const main = async () => {
  const res = await getAllFilingsByTickerCached("INTC");
  const filing = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 7) === "2019-03"
  );
  if (!filing) throw new Error("no filing");

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) throw new Error("no ctx");
  const acc = ctx.acc;

  console.log("acc len", acc.length, "tables", ctx.tables.length);
  console.log("bounds", __test_findPrimaryFinancialStatementsItemSectionBounds(acc, "10-Q"));

  for (const term of [
    "balance sheet",
    "statements of income",
    "statements of operations",
    "cash flows",
    "unaudited",
    "financial statements pages",
    "total assets",
    "net revenue",
  ]) {
    const re = new RegExp(term, "gi");
    const hits = [...acc.matchAll(re)].slice(0, 4).map((m) => [m.index, acc.slice(Math.max(0, m.index! - 20), m.index! + 80)]);
    console.log(`\n"${term}" (${[...acc.matchAll(re)].length}):`, hits);
  }

  console.log("\nacc head 500:", acc.slice(0, 500));
  console.log("\nacc around PART I:", acc.slice(121200, 121450));
};

main().catch(console.error);
