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
    const after = acc.slice(abs, abs + 28).toLowerCase();
    if (/^item\s+8\s+of\b/i.test(after)) continue;
    return abs;
  }
  return acc.length;
}

function findMdnaCharRangeInFlatText(acc: string, form: string): { start: number; end: number } | null {
  const is10K = form.includes("10-K");
  const itemN = is10K ? "7" : "2";
  const itemStartRe = new RegExp(`\\bITEM\\s+${itemN}\\b`, "gi");
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemStartRe.exec(acc)) !== null) {
    starts.push(m.index);
    if (starts.length > 64) break;
  }
  if (starts.length === 0) return null;
  const proseLead = new RegExp(`item\\s+${itemN}\\s+of\\b`, "i");
  let best: { start: number; end: number; span: number } | null = null;
  for (const start of starts) {
    const lead = acc.slice(start, start + 36).toLowerCase();
    if (proseLead.test(lead)) continue;
    if (is10K) {
      const head = acc.slice(start, start + 480);
      if (/RESULTS\s+OF\s+OPERATIONS\s+\d{1,3}\b/i.test(head)) continue;
    }
    const end = findMdnaEndCharIndex(acc, form, start);
    const span = end - start;
    if (span < MIN_MDNA_SPAN_CHARS) continue;
    if (!best || span > best.span) best = { start, end, span };
  }
  return best ? { start: best.start, end: best.end } : null;
}

function isNonFractionTag(name: string): boolean {
  const n = name.toLowerCase();
  return n === "ix:nonfraction" || n.endsWith(":nonfraction");
}

function countNonFractionsInTable(table: DomElement): number {
  let n = 0;
  const walk = (node: ChildNode) => {
    if (node.type === "tag") {
      const t = node as DomElement;
      if (isNonFractionTag(t.name ?? "")) n++;
      for (const c of t.children ?? []) walk(c);
    }
  };
  walk(table);
  return n;
}

async function main() {
  const r = await getAllFilingsByTicker("HTZ");
  const filings = r!.filings.filter((f) => f.form === "10-K" || f.form === "10-Q").slice(0, 600);
  const chosen = filings.find((f) => f.form === "10-K")!;
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

  const range = findMdnaCharRangeInFlatText(acc, chosen.form);
  console.log("range", range, "span", range ? range.end - range.start : 0);
  if (!range) return;

  let mdna3 = 0;
  let mdnaAny = 0;
  let mdna1 = 0;
  let out3 = 0;
  for (const [tbl, off] of Array.from(tableOffsets.entries())) {
    if (off < range.start || off >= range.end) continue;
    const nf = countNonFractionsInTable(tbl);
    if (nf > 0) mdnaAny++;
    if (nf >= 1) mdna1++;
    if (nf >= 3) mdna3++;
  }
  for (const [tbl] of Array.from(tableOffsets.entries())) {
    const nf = countNonFractionsInTable(tbl);
    if (nf >= 3) out3++;
  }
  console.log("in-range tables any nf", mdnaAny, "3+ nf", mdna3, "total tables in range");
  let inRangeTotal = 0;
  for (const [, off] of Array.from(tableOffsets.entries())) {
    if (off >= range.start && off < range.end) inRangeTotal++;
  }
  console.log("inRangeTotal", inRangeTotal, "total3+nf whole doc", out3);
  const sample: number[] = [];
  for (const [tbl, off] of Array.from(tableOffsets.entries())) {
    const nf = countNonFractionsInTable(tbl);
    if (nf < 3) continue;
    sample.push(off);
    if (sample.length >= 8) break;
  }
  console.log("first 8 table offsets with 3+nf", sample);
}

void main();
