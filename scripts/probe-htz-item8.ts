import * as cheerio from "cheerio";
import type { ChildNode } from "domhandler";

import { getAllFilingsByTicker, SEC_EDGAR_USER_AGENT } from "@/lib/sec-edgar";

async function main() {
  const r = await getAllFilingsByTicker("HTZ");
  const filings = r!.filings.filter((f) => f.form === "10-K" || f.form === "10-Q").slice(0, 600);
  const chosen = filings.find((f) => f.form === "10-K")!;
  const cikNum = parseInt(r!.cik.replace(/\D/g, ""), 10);
  const accClean = chosen.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/${encodeURIComponent(chosen.primaryDocument)}`;
  const res = await fetch(url, { headers: { "User-Agent": SEC_EDGAR_USER_AGENT } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const body = $("body").get(0)!;
  let acc = "";
  const walk = (node: ChildNode) => {
    if (node.type === "text" && node.data) {
      const t = node.data.replace(/\u00a0|\u2009|\u2007/g, " ").replace(/\s+/g, " ").trim();
      if (t) acc += (acc.length ? " " : "") + t;
      return;
    }
    if (node.type !== "tag") return;
    for (const c of node.children ?? []) walk(c);
  };
  for (const c of body.children ?? []) walk(c);

  const re = /\bITEM\s+8\b/gi;
  let m: RegExpExecArray | null;
  const hits: { i: number; ctx: string }[] = [];
  while ((m = re.exec(acc)) !== null) {
    hits.push({ i: m.index, ctx: acc.slice(m.index, m.index + 140) });
    if (hits.length > 30) break;
  }
  console.log("ITEM 8 hits (index, context):");
  hits.forEach((h, j) => console.log(j, h.i, JSON.stringify(h.ctx)));

  const rx = /ITEM\s+8\.\s*FINANCIAL/gi;
  const strong: number[] = [];
  let m2: RegExpExecArray | null;
  while ((m2 = rx.exec(acc)) !== null) strong.push(m2.index);
  console.log("ITEM 8. FINANCIAL positions", strong.length, strong.slice(0, 12));
}

void main();
