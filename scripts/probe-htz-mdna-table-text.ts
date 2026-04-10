import * as cheerio from "cheerio";
import type { ChildNode, Element as DomElement } from "domhandler";

import { getAllFilingsByTicker, SEC_EDGAR_USER_AGENT } from "@/lib/sec-edgar";

const MIN_MDNA_SPAN_CHARS = 4000;

function findMdnaEndCharIndex(acc: string, form: string, start: number): number {
  const is10K = form.includes("10-K");
  const tail = acc.slice(start + 1);
  if (is10K) {
    const strong = new RegExp("\\bITEM\\s+8[\\.\\u2014\\-]\\s*FINANCIAL\\s+STATEMENTS\\b", "gi");
    const sm = strong.exec(tail);
    if (sm && sm.index >= 0) return start + 1 + sm.index;
  }
  const weak = /\bITEM\s+8\b/gi;
  let wm: RegExpExecArray | null;
  while ((wm = weak.exec(tail)) !== null) {
    const abs = start + 1 + wm.index;
    if (/^item\s+8\s+of\b/i.test(acc.slice(abs, abs + 28).toLowerCase())) continue;
    return abs;
  }
  return acc.length;
}

function findMdnaCharRangeInFlatText(acc: string, form: string): { start: number; end: number } | null {
  const itemStartRe = /\bITEM\s+7\b/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemStartRe.exec(acc)) !== null) {
    starts.push(m.index);
    if (starts.length > 64) break;
  }
  let best: { start: number; end: number; span: number } | null = null;
  for (const start of starts) {
    if (/item\s+7\s+of\b/i.test(acc.slice(start, start + 36).toLowerCase())) continue;
    const head = acc.slice(start, start + 480);
    if (/RESULTS\s+OF\s+OPERATIONS\s+\d{1,3}\b/i.test(head)) continue;
    const end = findMdnaEndCharIndex(acc, form, start);
    const span = end - start;
    if (span < MIN_MDNA_SPAN_CHARS) continue;
    if (!best || span > best.span) best = { start, end, span };
  }
  return best ? { start: best.start, end: best.end } : null;
}

async function main() {
  const r = await getAllFilingsByTicker("HTZ");
  const filings = r!.filings.filter((f) => f.form === "10-K").slice(0, 600);
  const chosen = filings[0]!;
  const cikNum = parseInt(r!.cik.replace(/\D/g, ""), 10);
  const accClean = chosen.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/${encodeURIComponent(chosen.primaryDocument)}`;
  const html = await (await fetch(url, { headers: { "User-Agent": SEC_EDGAR_USER_AGENT } })).text();
  const $ = cheerio.load(html);
  const body = $("body").get(0) as DomElement;

  let acc = "";
  const tableOffsets = new Map<DomElement, number>();
  const walk = (node: ChildNode) => {
    if (node.type === "text" && node.data) {
      const t = node.data.replace(/\u00a0|\u2009|\u2007/g, " ").replace(/\s+/g, " ").trim();
      if (t) acc += (acc.length ? " " : "") + t;
      return;
    }
    if (node.type !== "tag") return;
    const el = node as DomElement;
    if ((el.name ?? "").toLowerCase() === "table") tableOffsets.set(el, acc.length);
    for (const c of el.children ?? []) walk(c);
  };
  for (const c of body.children ?? []) walk(c);

  const range = findMdnaCharRangeInFlatText(acc, chosen.form)!;
  let n = 0;
  for (const [tbl, off] of Array.from(tableOffsets.entries())) {
    if (off < range.start || off >= range.end) continue;
    const text = $(tbl).text().replace(/\s+/g, " ").trim().slice(0, 400);
    console.log("--- table", n++, "off", off, "---");
    console.log(text);
    if (n >= 4) break;
  }
}

void main();
