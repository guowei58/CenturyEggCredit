/** Which table index has Distribution as first row (wrong IS pick)? */
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
  $("table").each((i, el) => {
    const text = $(el).text().replace(/\s+/g, " ");
    if (!/^ distribution /i.test(text.replace(/\s+/g, " ").slice(0, 40)) && !text.trim().startsWith("Distribution")) return;
    const ix = $(el).find("ix\\:nonFraction, nonFraction").length;
    const firstRows = $(el)
      .find("tr")
      .slice(0, 4)
      .map((_, tr) => $(tr).text().replace(/\s+/g, " ").trim().slice(0, 70))
      .get();
    console.log(`table[${i}] ix=${ix}`);
    for (const r of firstRows) console.log(`  ${r}`);
  });
}

main().catch(console.error);
