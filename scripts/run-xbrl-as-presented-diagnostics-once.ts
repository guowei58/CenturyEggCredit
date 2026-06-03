/**
 * One-off CLI: `npx tsx scripts/run-xbrl-as-presented-diagnostics-once.ts GOOG LUMN --max=10 --years=20`
 * Uses the same logic as GET /api/sec/xbrl/as-presented/[ticker]/diagnostics (no Next.js auth).
 *
 * `--years=N` sets min filing year to (current calendar year − N) and defaults `--max` higher unless overridden.
 * `--out=rel/path.json` writes UTF-8 JSON (recommended on Windows instead of shell redirect).
 */
import { writeFile } from "node:fs/promises";
import { runSecXbrlAsPresentedDiagnostics } from "../src/lib/sec-xbrl-as-presented-diagnostics";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  const yearsArg = process.argv.find((a) => a.startsWith("--years="));
  let minFilingYear: number | undefined;
  if (yearsArg) {
    const n = Number.parseInt(yearsArg.replace("--years=", ""), 10);
    if (Number.isFinite(n) && n > 0) {
      minFilingYear = new Date().getFullYear() - n;
    }
  }

  let max = minFilingYear != null ? 320 : 10;
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  if (maxArg) {
    const n = Number.parseInt(maxArg.replace("--max=", ""), 10);
    if (Number.isFinite(n) && n > 0) max = Math.min(500, n);
  }

  const outArg = (process.argv.find((a) => a.startsWith("--out=")) ?? "").replace(/^--out=/, "").trim();

  const tickers = args.length > 0 ? args : ["GOOG", "LUMN"];
  const multi = tickers.filter((x) => x.trim()).length > 1;

  for (const sym of tickers) {
    const t = sym.trim().toUpperCase();
    if (!t) continue;
    const opts =
      minFilingYear != null
        ? { maxFilings: max, minFilingYear }
        : max;
    console.error(`\n======== ${t} (max=${max}${minFilingYear != null ? `, minYear=${minFilingYear}` : ""}) ========\n`);
    const r = await runSecXbrlAsPresentedDiagnostics(t, opts);
    const json = `${JSON.stringify(r, null, 2)}\n`;
    if (outArg) {
      const path =
        multi
          ? (() => {
              const i = outArg.lastIndexOf(".");
              if (i < 0) return `${outArg}-${t}.json`;
              return `${outArg.slice(0, i)}-${t}${outArg.slice(i)}`;
            })()
          : outArg;
      await writeFile(path, json, "utf8");
      console.error(`Wrote ${path}`);
    }
    if (!outArg) console.log(json.trimEnd());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
