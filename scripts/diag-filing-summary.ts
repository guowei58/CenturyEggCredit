import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { parseFilingSummaryReports } from "@/lib/secDebtFootnote/filingSummary";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

const ticker = (process.argv[2] ?? "WFC").toUpperCase();
const period = process.argv[3] ?? "2025-03-31";

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return;
  const cikNum = String(parseInt(res.cik, 10));
  const acc = f.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/FilingSummary.xml`;
  const resp = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  const xml = await resp.text();
  const reports = parseFilingSummaryReports(xml);
  for (const r of reports) {
    const blob = [r.shortName, r.longName, r.menuCategory].filter(Boolean).join(" | ");
    if (/statement|balance|income|cash|comprehensive|financial position/i.test(blob)) {
      console.log(`${r.htmlFile}: ${blob}`);
    }
  }
}

main().catch(console.error);
