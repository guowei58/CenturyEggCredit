/**
 * Aggregate probe JSON results into failure-mode buckets.
 * Usage: npx tsx scripts/analyze-probe-failures.ts [json1] [json2] ...
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

type Row = {
  ticker: string;
  ok: boolean;
  section: string | null;
  packet: boolean;
  missing: string[];
  error?: string;
  reportDate: string | null;
  filingDate: string;
};

function bucket(r: Row): string {
  if (r.ok) return "ok";
  if (r.error) return "error";
  if (!r.section) return "no_section";
  if (r.packet) return "section_packet_no_parse";
  return "section_no_packet_no_parse";
}

const args = process.argv.slice(2);
const files =
  args.length > 0
    ? args
    : readdirSync("scripts")
        .filter((f) => f.startsWith("probe-10q-since2019-results-") && f.endsWith(".json"))
        .sort()
        .slice(-2)
        .map((f) => join("scripts", f));

const rows: Row[] = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(f, "utf8")) as { rows: Row[] };
  rows.push(...data.rows);
}

const byTicker = new Map<string, Row[]>();
for (const r of rows) {
  const list = byTicker.get(r.ticker) ?? [];
  list.push(r);
  byTicker.set(r.ticker, list);
}

console.log("Files:", files.join(", "));
console.log("Total rows:", rows.length, "tickers:", byTicker.size);

const buckets = new Map<string, number>();
for (const r of rows) buckets.set(bucket(r), (buckets.get(bucket(r)) ?? 0) + 1);

console.log("\n=== Failure buckets ===");
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} (${((v / rows.length) * 100).toFixed(1)}%)`);
}

console.log("\n=== Per-ticker ===");
for (const [ticker, list] of [...byTicker.entries()].sort((a, b) => {
  const ra = a[1].filter((x) => x.ok).length / a[1].length;
  const rb = b[1].filter((x) => x.ok).length / b[1].length;
  return ra - rb;
})) {
  const ok = list.filter((x) => x.ok).length;
  const b = {
    no_section: 0,
    section_packet_no_parse: 0,
    section_no_packet_no_parse: 0,
    error: 0,
  };
  for (const r of list.filter((x) => !x.ok)) {
    const k = bucket(r);
    if (k in b) (b as Record<string, number>)[k]! += 1;
  }
  console.log(
    `${ticker.padEnd(6)} ${ok}/${list.length}  noSec=${b.no_section} pktFail=${b.section_packet_no_parse} noPkt=${b.section_no_packet_no_parse}`
  );
}
