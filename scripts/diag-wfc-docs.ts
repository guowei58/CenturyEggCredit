import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFilingIndexItems } from "@/lib/sec/filingIndex";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

function docUrl(cik: string, acc: string, name: string) {
  const cikNum = String(parseInt(cik, 10));
  const accNoDashes = acc.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${name}`;
}
import { buildParsedFilingHtmlContext } from "@/lib/sec-filing-financials";
import { findFilteredNotesToFinancialStatementsStart } from "@/lib/sec-statement-locator/signals";

const ticker = "WFC";
const period = "2025-03-31";

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return;
  const items = await fetchFilingIndexItems(res.cik, f.accessionNumber);
  const htmls = items.filter((i) => /\.html?$/i.test(i.name));
  const prioritized = htmls.filter((i) =>
    /financial|statement|ex99|ex-99|exhibit99|balance|wfc-.*q/i.test(i.name)
  );
  const scan = [...prioritized, ...htmls.filter((i) => !prioritized.includes(i))].slice(0, 40);
  console.log(`WFC ${period} ${htmls.length} html files, scanning ${scan.length}`);
  for (const item of scan) {
    const url = docUrl(res.cik, f.accessionNumber, item.name);
    const resp = await fetch(url, {
      headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "text/html,*/*" },
    });
    if (!resp.ok) continue;
    const html = await resp.text();
    const ctx = buildParsedFilingHtmlContext(html);
    if (!ctx) continue;
    const umbrella = findFilteredNotesToFinancialStatementsStart(ctx.acc, 1800);
    const hasBs = /\bbalance\s+sheets?\b/i.test(ctx.acc);
    const hasIs = /\bstatements?\s+of\s+(?:operations|income|comprehensive)\b/i.test(ctx.acc);
    const hasCf = /\bcash\s+flows?\b/i.test(ctx.acc);
    if (ctx.tables.length >= 5 || umbrella || (hasBs && hasIs)) {
      console.log(
        `  ${item.name} len=${ctx.acc.length} tables=${ctx.tables.length} umbrella=${umbrella ?? "—"} bs=${hasBs} is=${hasIs} cf=${hasCf}`
      );
    }
  }
}

main().catch(console.error);
