import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";

const ticker = (process.argv[2] ?? "WFC").toUpperCase();
const period = process.argv[3] ?? "2025-03-31";

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return console.log("not found");
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  console.log(
    `${ticker} ${period}: ${bundle.statements.length}/3`,
    bundle.statements.map((s) => `${s.id}@${s.sourceHtmlFile}`).join(", ")
  );
}

main().catch(console.error);
