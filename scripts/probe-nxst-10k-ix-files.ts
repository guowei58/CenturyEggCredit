/** Count ix:nonFraction across NXST 10-K HTML files. */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFilingIndexItems } from "@/lib/sec/filingIndex";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";
import * as cheerio from "cheerio";

async function fetchHtml(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() }, cache: "no-store" });
  return res.ok ? res.text() : "";
}

function countIx(html: string) {
  const $ = cheerio.load(html);
  const nf = $("ix\\:nonFraction, nonFraction").length;
  const nn = $("ix\\:nonNumeric, nonNumeric").length;
  const named = $("[name]").filter((_, el) => String($(el).attr("name") ?? "").includes(":")).length;
  return { nf, nn, named };
}

async function main() {
  const res = await getAllFilingsByTickerCached("NXST");
  const k = res!.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2026-02"))!;
  const cik = res!.cik.replace(/\D/g, "").padStart(10, "0");
  const acc = k.accessionNumber.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}`;

  const items = await fetchFilingIndexItems(cik, k.accessionNumber);
  const htmlFiles = items.filter((i) => /\.htm/i.test(i.name)).map((i) => i.name);
  console.log(`HTML files (${htmlFiles.length}):`);

  const hits: { name: string; nf: number }[] = [];
  for (const name of htmlFiles) {
    const html = await fetchHtml(`${base}/${name}`);
    if (!html) continue;
    const c = countIx(html);
    if (c.nf > 0 || c.nn > 10) hits.push({ name, nf: c.nf });
    if (c.nf > 0 || /R[0-9]+\.htm/i.test(name) || name === k.primaryDocument) {
      console.log(`  ${name}: nonFraction=${c.nf} nonNumeric=${c.nn} named=${c.named}`);
    }
  }
  hits.sort((a, b) => b.nf - a.nf);
  console.log("\nTop files by ix:nonFraction:");
  for (const h of hits.slice(0, 10)) console.log(`  ${h.name}: ${h.nf}`);
}

main().catch(console.error);
