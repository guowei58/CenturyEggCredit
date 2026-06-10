import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  fetchHtmlFilingStatementsBundle,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";

const cases: Array<[string, string, number, "is" | "bs" | "cf"]> = [
  ["ETN", "2024-03-31", 35, "is"],
  ["ETN", "2024-03-31", 7, "is"],
  ["ETN", "2025-03-31", 36, "is"],
  ["ETN", "2025-03-31", 7, "is"],
  ["ETN", "2025-03-31", 37, "is"],
  ["MGPI", "2019-06-30", 4, "is"],
  ["ITT", "2019-09-30", 36, "cf"],
  ["ITT", "2019-09-30", 37, "cf"],
];

async function main() {
  for (const [ticker, period, ti, kind] of cases) {
    const res = await getAllFilingsByTickerCached(ticker);
    const f = res?.filings.find(
      (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
    );
    if (!f || !res) continue;
    const bundle = await fetchHtmlFilingStatementsBundle({
      cik: res.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(
      bundle.primaryHtml ?? "",
      kind,
      ti,
      "10-Q"
    );
    const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false;
    console.log(`\n${ticker} ${period} #${ti} ${kind}: rows=${parsed?.rows.length ?? 0} shape=${shape}`);
    const rows = (validated ?? parsed)?.rows ?? [];
    if (rows.length > 0) {
      console.log("labels:", rows.map((r) => r.label).filter(Boolean).join(" | "));
      if (validated) console.log("periods:", validated.periods.length);
    }
  }
}

main().catch(console.error);
