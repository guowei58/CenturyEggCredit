/** Find tables in NXST 10-K primary doc with ix tags and revenue/net income labels. */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";
import * as cheerio from "cheerio";

async function main() {
  const res = await getAllFilingsByTickerCached("NXST");
  const k = res!.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2026-02"))!;
  const cik = parseInt(res!.cik.replace(/\D/g, ""), 10);
  const acc = k.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${k.primaryDocument}`;
  const html = await (await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } })).text();
  const $ = cheerio.load(html);
  const tables = $("table").toArray();
  console.log(`tables=${tables.length}`);
  for (let i = 0; i < tables.length; i++) {
    const $t = $(tables[i]!);
    const ix = $t.find("ix\\:nonFraction, nonFraction").length;
    if (ix < 5) continue;
    const text = $t.text().replace(/\s+/g, " ").slice(0, 120);
    const hasNetIncome = /net income/i.test(text);
    const hasDistribution = /distribution/i.test(text);
    const hasCashFlow = /cash flows from operating/i.test(text);
    const hasTotalAssets = /total assets/i.test(text);
    console.log(`\ntable[${i}] ix=${ix} netIncome=${hasNetIncome} distribution=${hasDistribution} cf=${hasCashFlow} assets=${hasTotalAssets}`);
    console.log(`  snippet: ${text}`);
  }
}

main().catch(console.error);
