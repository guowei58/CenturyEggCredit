import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { buildParsedFilingHtmlContext, fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
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
  const hit = locateFinancialStatementsSection(ctx, "10-Q")!;
  console.log(hit);
  console.log("context at scanCeiling-80:", ctx.acc.slice(hit.scanCeiling - 80, hit.scanCeiling + 120).replace(/\s+/g, " "));
  console.log("table offsets", ctx.tables.slice(6, 10).map((t, i) => `#${i + 6}@${t.offset}`));
};

main().catch(console.error);
