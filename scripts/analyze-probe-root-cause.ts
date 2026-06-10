/**
 * Classify probe failures into: wrong_place | too_tight | table_selection | ok
 * Usage: npx tsx scripts/analyze-probe-root-cause.ts <results.json>
 */
import { readFileSync } from "fs";

type Row = {
  ticker: string;
  ok: boolean;
  section: string | null;
  packet: boolean;
  missing: string[];
  error?: string;
};

function rootCause(r: Row): string {
  if (r.ok) return "ok";
  if (r.error) return "error";
  if (!r.section) return "wrong_place";
  if (r.packet) return "too_tight_or_shape";
  return "table_selection";
}

const file = process.argv[2];
if (!file) {
  console.error("usage: analyze-probe-root-cause.ts <json>");
  process.exit(1);
}

const { rows } = JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] };
const buckets = new Map<string, number>();
const byTicker = new Map<string, { ok: number; total: number; causes: Map<string, number> }>();

for (const r of rows) {
  const cause = rootCause(r);
  buckets.set(cause, (buckets.get(cause) ?? 0) + 1);
  const t = byTicker.get(r.ticker) ?? { ok: 0, total: 0, causes: new Map() };
  t.total += 1;
  if (r.ok) t.ok += 1;
  t.causes.set(cause, (t.causes.get(cause) ?? 0) + 1);
  byTicker.set(r.ticker, t);
}

console.log("=== Root cause buckets ===");
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} (${((v / rows.length) * 100).toFixed(1)}%)`);
}

console.log("\n=== Tickers with any failure ===");
for (const [ticker, stat] of [...byTicker.entries()].sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total)) {
  if (stat.ok === stat.total) continue;
  const causes = [...stat.causes.entries()]
    .filter(([k]) => k !== "ok")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`${ticker.padEnd(6)} ${stat.ok}/${stat.total}  ${causes}`);
}

console.log(`\nTOTAL: ${rows.filter((r) => r.ok).length}/${rows.length}`);
