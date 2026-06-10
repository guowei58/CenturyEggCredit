import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  fetchHtmlFilingStatementsBundle,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";

const cases = [
  { ticker: "AVT", period: "2024-03-30", ti: 8 },
  { ticker: "NVST", period: "2024-03-29", ti: 7 },
  { ticker: "FOXF", period: "2023-03-31", ti: 14 },
] as const;

async function main() {
  for (const c of cases) {
    const res = await getAllFilingsByTickerCached(c.ticker);
    const f = res?.filings.find(
      (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === c.period
    );
    if (!f) {
      console.log("missing", c);
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
    const { parsed } = __test_parsePrimaryStatementAtTableOffset(html, "is", c.ti, "10-Q");
    console.log(`\n=== ${c.ticker} IS #${c.ti} ===`);
    console.log("periods", parsed?.periods.map((p) => p.label));
    console.log("labels", parsed?.rows.slice(0, 18).map((r) => r.label).join(" | "));
    console.log("shape", parsed ? __test_validateSinglePrimaryStatementShape(parsed, "10-Q") : false);
  }
}

main().catch(console.error);
