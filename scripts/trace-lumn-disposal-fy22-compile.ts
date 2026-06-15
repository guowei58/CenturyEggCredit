/**
 * Trace LUMN FY22 disposal CF line through compile pipeline.
 * Usage: npx tsx scripts/trace-lumn-disposal-fy22-compile.ts
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const CANON = "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal";
const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");

async function runCompiler(inputDir: string, outputDir: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const proc = spawn(
      process.env.PYTHON_PATH?.trim() || "python",
      [path.join(COMPILER_DIR, "main.py"), "--input", inputDir, "--output", outputDir],
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: 600_000 }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.slice(-4000) || `exit ${code}`));
      else resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
    });
    proc.on("error", reject);
  });
}

function wbFilename(f: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = f.accessionNumber.replace(/[^\w-]+/g, "_");
  return `LUMN_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${acc}.xlsx`;
}

async function saveWorkbook(cik: string, filing: NonNullable<Awaited<ReturnType<typeof getAllFilingsByTickerCached>>["filings"][0]>, dir: string) {
  const payload = await fetchFacePresentedStatements({
    cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const wb = buildFacePresentedStatementsWorkbook({ ticker: "LUMN", cik, filing, statements: payload.statements });
  const fn = wbFilename(filing);
  await fs.writeFile(path.join(dir, fn), Buffer.from(workbookToXlsxUint8Array(wb)));
  return fn;
}

function findCfRow(result: Record<string, unknown>) {
  const models = result.models as Record<string, { quarterly: { periods: string[]; rows: Record<string, unknown>[] }; annual: { periods: string[]; rows: Record<string, unknown>[] } }>;
  const cf = models?.cash_flow;
  if (!cf) return null;
  const qRow = cf.quarterly.rows.find((r) => String(r.concept) === CANON || String(r.line).includes("disposal groups"));
  const aRow = cf.annual.rows.find((r) => String(r.concept) === CANON || String(r.line).includes("disposal groups"));
  return { qRow, aRow, qPeriods: cf.quarterly.periods, aPeriods: cf.annual.periods };
}

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const fy22K = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2023-02"));
  const fy23K = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2024-02"));
  const fy24K = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2025-02"));
  if (!fy22K) throw new Error("no FY22 10-K");

  // Scenario A: FY22 10-K only
  const tmpA = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-a-"));
  const outA = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-a-out-"));
  await saveWorkbook(res.cik, fy22K, tmpA);
  const resultA = await runCompiler(tmpA, outA);
  console.log("\n=== SCENARIO A: FY22 10-K only ===");
  console.log(JSON.stringify(findCfRow(resultA), null, 2));

  // Scenario B: FY22 + newer 10-Ks (no other quarters)
  const tmpB = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-b-"));
  const outB = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-b-out-"));
  for (const f of [fy22K, fy23K, fy24K].filter(Boolean)) {
    await saveWorkbook(res.cik, f!, tmpB);
  }
  const resultB = await runCompiler(tmpB, outB);
  console.log("\n=== SCENARIO B: FY22 + FY23 + FY24 10-Ks ===");
  const b = findCfRow(resultB);
  console.log("FY22 quarterly:", b?.qRow?.FY22, "annual:", b?.aRow?.FY22);
  console.log("FY22 in q periods:", b?.qPeriods?.includes("FY22"));
  console.log("headline periods:", (resultB.xbrl_backed_periods_by_statement as Record<string, string[]>)?.cash_flow?.filter((p) => p.includes("22")));

  // Scenario C: full set like production
  const pick = res.filings.filter(
    (f) => (f.form === "10-K" || f.form === "10-Q") && f.filingDate >= "2019-01-01" && f.filingDate <= "2026-06-01"
  );
  const tmpC = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-c-"));
  const outC = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-c-out-"));
  for (const f of pick) await saveWorkbook(res.cik, f, tmpC);
  const resultC = await runCompiler(tmpC, outC);
  console.log("\n=== SCENARIO C: full LUMN set (" + pick.length + " files) ===");
  const c = findCfRow(resultC);
  console.log("FY22 quarterly:", c?.qRow?.FY22, "annual:", c?.aRow?.FY22);
  console.log("row line:", c?.qRow?.line);
  console.log("_workbookLine:", c?.qRow?._workbookLine);

  // Scenario D: newer 10-Ks only — FY22 10-K omitted (simulates missing source owner)
  const tmpD = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-d-"));
  const outD = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-d-out-"));
  for (const f of [fy23K, fy24K].filter(Boolean)) {
    await saveWorkbook(res.cik, f!, tmpD);
  }
  const resultD = await runCompiler(tmpD, outD);
  console.log("\n=== SCENARIO D: FY23 + FY24 10-Ks ONLY (no FY22 10-K) ===");
  const d = findCfRow(resultD);
  console.log("row present:", Boolean(d?.qRow));
  console.log("FY22 quarterly:", d?.qRow?.FY22, "annual:", d?.aRow?.FY22);
  console.log("FY23/FY24 values:", d?.qRow?.FY23, d?.qRow?.FY24);
  console.log("_workbookLine:", d?.qRow?._workbookLine);

  const dedup = resultC.row_deduplication as { detail?: unknown[] } | undefined;
  const hits = (dedup?.detail ?? []).filter((d) => JSON.stringify(d).includes("Disposal"));
  if (hits.length) console.log("dedup hits:", hits);

  const wt = resultC.workbook_truth as { issues?: Array<{ canonical_row_id?: string; period?: string; message?: string }> };
  const wtHits = (wt?.issues ?? []).filter((i) => (i.canonical_row_id ?? "").includes("Disposal") || i.period === "FY22");
  if (wtHits.length) console.log("workbook_truth FY22/disposal:", wtHits.slice(0, 10));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
