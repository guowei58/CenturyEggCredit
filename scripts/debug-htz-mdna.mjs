import * as cheerio from "cheerio";
import fs from "fs";

const MIN_MDNA_SPAN_CHARS = 4000;

function findMdnaCharRangeInFlatText(acc, form) {
  const is10K = form.includes("10-K");
  const itemN = is10K ? "7" : "2";
  const stopN = is10K ? "8" : "3";
  const itemStartRe = new RegExp(`\\bITEM\\s+${itemN}\\b`, "gi");
  const itemStopRe = new RegExp(`\\bITEM\\s+${stopN}\\b`, "i");
  const starts = [];
  let m;
  while ((m = itemStartRe.exec(acc)) !== null) {
    starts.push(m.index);
    if (starts.length > 64) break;
  }
  if (starts.length === 0) return null;
  const proseLead = new RegExp(`item\\s+${itemN}\\s+of\\b`, "i");
  let best = null;
  for (const start of starts) {
    const lead = acc.slice(start, start + 36).toLowerCase();
    if (proseLead.test(lead)) continue;
    if (is10K) {
      const head = acc.slice(start, start + 480);
      if (/RESULTS\s+OF\s+OPERATIONS\s+\d{1,3}\b/i.test(head)) continue;
    }
    const sliceFrom = acc.slice(start + 1);
    const stopM = itemStopRe.exec(sliceFrom);
    const end = stopM && stopM.index > 0 ? start + 1 + stopM.index : acc.length;
    const span = end - start;
    if (span < MIN_MDNA_SPAN_CHARS) continue;
    if (!best || span > best.span) best = { start, end, span };
  }
  return best ? { start: best.start, end: best.end } : null;
}

const h = fs.readFileSync(process.env.TEMP + "/htz.htm", "utf8");
const $ = cheerio.load(h);
const body = $("body").get(0);
let acc = "";
function walk(n) {
  if (n.type === "text" && n.data) {
    const t = n.data.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (t) acc += (acc.length ? " " : "") + t;
    return;
  }
  if (n.type !== "tag") return;
  for (const c of n.children ?? []) walk(c);
}
for (const c of body?.children ?? []) walk(c);

const range = findMdnaCharRangeInFlatText(acc, "10-K");
console.log("range", range);
if (range) console.log(acc.slice(range.start, range.start + 100));
