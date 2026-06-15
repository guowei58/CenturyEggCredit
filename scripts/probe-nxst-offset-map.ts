import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { buildParsedFilingHtmlContext } from "@/lib/sec-filing-financials";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

async function main() {
  const res = await getAllFilingsByTickerCached("NXST");
  const k = res!.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2026-02"))!;
  const cik = parseInt(res!.cik.replace(/\D/g, ""), 10);
  const acc = k.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${k.primaryDocument}`;
  const html = await (await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } })).text();
  const ctx = buildParsedFilingHtmlContext(html)!;
  const target = 201619;
  for (let i = 0; i < ctx.tables.length; i++) {
    const t = ctx.tables[i]!;
    if (Math.abs(t.offset - target) < 50) {
      const snippet = ctx.$(t.el).text().replace(/\s+/g, " ").slice(0, 100);
      console.log(`table index ${i} offset=${t.offset} ix=${ctx.$(t.el).find("ix\\:nonFraction, nonFraction").length}`);
      console.log(`  ${snippet}`);
    }
  }
}

main().catch(console.error);
