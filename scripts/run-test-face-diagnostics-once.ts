/**
 * CLI: `npx tsx scripts/run-test-face-diagnostics-once.ts FICO TSLA --max=80 --years=20`
 * Same logic as GET /api/sec/xbrl/test-as-presented/[ticker]/diagnostics
 */
import { writeFile } from "node:fs/promises";
import { runTestFaceDiagnostics } from "../src/lib/sec-ixbrl-face-diagnostics";

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

  let max = minFilingYear != null ? 80 : 30;
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  if (maxArg) {
    const n = Number.parseInt(maxArg.replace("--max=", ""), 10);
    if (Number.isFinite(n) && n > 0) max = Math.min(500, n);
  }

  const outArg = (process.argv.find((a) => a.startsWith("--out=")) ?? "").replace(/^--out=/, "").trim();

  const tickers = args.length > 0 ? args : ["FICO"];
  const multi = tickers.filter((x) => x.trim()).length > 1;

  for (const sym of tickers) {
    const t = sym.trim().toUpperCase();
    if (!t) continue;
    console.error(`\n======== ${t} (max=${max}${minFilingYear != null ? `, minYear=${minFilingYear}` : ""}) ========\n`);
    const r = await runTestFaceDiagnostics(t, { maxFilings: max, minFilingYear });
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
      console.error(`Wrote ${path} (${r.checked} checked, ${r.suspicious} suspicious)`);
    }
    if (!outArg) console.log(json.trimEnd());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
