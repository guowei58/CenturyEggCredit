/**
 * One-off: GE FY2024 10-K (filed 2025-02-03) MD&A boundary debug.
 * npx tsx --tsconfig tsconfig.json scripts/debug-ge-mdna-once.ts
 */

import * as cheerio from "cheerio";

import { findMdnaBounds } from "@/lib/sec-ixbrl-mdna-boundaries";
import { getAllFilingsByTicker, getSecEdgarUserAgent } from "@/lib/sec-edgar";
import { indexIxbrlBodyFlatText } from "@/lib/sec-ixbrl-mdna-tables";

const TARGET_ACC = "0000040545-25-000015";

async function main() {
  const r = await getAllFilingsByTicker("GE", { mergePredecessorIssuers: true });
  if (!r) throw new Error("GE not found");

  const f = r.filings.find(
    (x) =>
      x.accessionNumber === TARGET_ACC ||
      (x.accessionNumber ?? "").replace(/-/g, "") === TARGET_ACC.replace(/-/g, ""),
  );
  if (!f) throw new Error(`Accession ${TARGET_ACC} not in bundle`);

  const meta = {
    accessionNumber: f.accessionNumber,
    form: f.form,
    filingDate: f.filingDate,
    primaryDocument: f.primaryDocument,
    cik: r.cik,
  };
  console.log("filing", JSON.stringify(meta, null, 2));

  const cikNum = parseInt(String(r.cik).replace(/\D/g, ""), 10);
  const accClean = f.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/${encodeURIComponent(f.primaryDocument)}`;
  console.log("GET", url);

  const res = await fetch(url, {
    headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "text/html,*/*" },
  });
  console.log("status", res.status, res.headers.get("content-type"));
  const html = await res.text();
  console.log("html chars", html.length);

  if (html.length < 2000) {
    console.log("head", html.slice(0, 800));
    return;
  }

  const $ = cheerio.load(html);
  const bodyEl = ($("body").get(0) ?? $("html").get(0))!;
  const { flatText } = indexIxbrlBodyFlatText(bodyEl);

  console.log("flatText chars", flatText.length);
  const bounds = findMdnaBounds(flatText, "10-K");
  console.log("findMdnaBounds", bounds === null ? "NULL" : JSON.stringify(bounds, null, 2));

  const show = (label: string, idx: number) => {
    const slice = flatText.slice(Math.max(0, idx - 40), idx + 200).replace(/\s+/g, " ");
    console.log(label, "idx", idx, slice);
  };

  const reItem7 = /\bITEM\s*7\b/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = reItem7.exec(flatText)) !== null && n < 8) {
    show(`ITEM 7 hit #${n + 1}`, m.index);
    n++;
  }
  if (n === 0) console.log("No /ITEM 7/ word-boundary hits in flatText");

  const reDiscuss = /DISCUSSION\s+AND\s+ANALYSIS\s+OF\s+FINANCIAL\s+CONDITION/gi;
  reDiscuss.lastIndex = 0;
  n = 0;
  while ((m = reDiscuss.exec(flatText)) !== null && n < 3) {
    show("Statutory title fragment", m.index);
    n++;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
