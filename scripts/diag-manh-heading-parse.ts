import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_parseBestStatementTableFromHtml,
} from "@/lib/sec-filing-financials";

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
  const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q")!;
  console.log("section", section);
  for (const kind of ["bs", "is", "cf"] as const) {
    const best = __test_parseBestStatementTableFromHtml(html, { kind, form: "10-Q" });
    console.log(kind, best?.rows.length ?? 0, best?.rows.slice(0, 3).map((r) => r.label));
  }
};

main().catch(console.error);
