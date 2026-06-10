import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { buildParsedFilingHtmlContext, fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";

async function main() {
  const period = process.argv[2] ?? "2024-03-31";
  const res = await getAllFilingsByTickerCached("ETN");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "")!;
  console.log(ctx.acc.slice(35050, 35250).replace(/\s+/g, " "));
}

main().catch(console.error);
