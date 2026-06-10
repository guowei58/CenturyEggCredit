import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_findStatementClusterInPrimaryItemSection,
} from "@/lib/sec-filing-financials";

const cases = [
  { ticker: "BURL", period: "2024-05-04" },
  { ticker: "HUBB", period: "2024-03-31" },
  { ticker: "TER", period: "2024-06-30" },
] as const;

async function main() {
  for (const c of cases) {
    const res = await getAllFilingsByTickerCached(c.ticker);
    const f = res?.filings.find(
      (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === c.period
    );
    if (!f) continue;
    const bundle = await fetchHtmlFilingStatementsBundle({
      cik: res!.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "")!;
    const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q");
    const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
    console.log(`\n${c.ticker}: full section`, section);
    console.log("cluster section", cluster?.section);
    console.log("cluster score", cluster?.cluster.score ?? null);
    if (section && cluster?.section) {
      console.log("ceiling shrunk by", section.end - cluster.section.end, "chars");
    }
  }
}

main().catch(console.error);
