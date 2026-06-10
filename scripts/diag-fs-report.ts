import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  parsePrimaryFilingStatementHtml,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

const ticker = (process.argv[2] ?? "WFC").toUpperCase();
const period = process.argv[3] ?? "2025-03-31";
const report = process.argv[4] ?? "R4.htm";
const kind = (process.argv[5] ?? "bs") as "is" | "bs" | "cf";

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return;
  const cikNum = String(parseInt(res.cik, 10));
  const acc = f.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${report}`;
  const resp = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  const html = await resp.text();
  const parsed = parsePrimaryFilingStatementHtml(html, {
    kind,
    form: "10-Q",
    primaryDocument: report,
    sourceUrl: url,
  });
  const shape = parsed ? __test_validateSinglePrimaryStatementShape(parsed, "10-Q") : false;
  console.log(`${report} as ${kind}: rows=${parsed?.rows.length ?? 0} periods=${parsed?.periods.length ?? 0} shape=${shape}`);
  if (parsed) console.log("labels:", parsed.rows.slice(0, 8).map((r) => r.label).join(" | "));
}

main().catch(console.error);
