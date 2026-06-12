/**
 * Generate LUMN HTML-face workbooks for key filings, run compiler, compare
 * compiled 1Q24 CF rows vs the 1Q24 source workbook.
 *
 * Usage: npx tsx scripts/compare-compiled-1q24-cf-lumn.ts
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import {
  buildFacePresentedStatementsWorkbook,
  faceStatementToWorkbookShape,
} from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const TICKER = "LUMN";
const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");

function wbFilename(filing: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = filing.accessionNumber.replace(/[^\w-]+/g, "_");
  return `${TICKER}_SEC-XBRL-financials_as-presented_${filing.form}_${filing.filingDate}_${acc}.xlsx`;
}

async function runCompiler(inputDir: string, outputDir: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.env.PYTHON_PATH?.trim() || process.env.PYTHON_CMD?.trim() || "python",
      [path.join(COMPILER_DIR, "main.py"), "--input", inputDir, "--output", outputDir],
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: 280_000 }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `exit ${code}`));
      else resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
    });
    proc.on("error", reject);
  });
}

async function main() {
  const res = await getAllFilingsByTickerCached(TICKER);
  if (!res) throw new Error("no LUMN");

  const q1_24 =
    res.filings.find((f) => f.form === "10-Q" && f.accessionNumber === "0000018926-24-000054") ??
    res.filings.find((f) => f.form === "10-Q" && f.reportDate === "2024-03-31");

  if (!q1_24) throw new Error("no 1Q24 filing");

  // Pick filings: 1Q24 + latest 10-K + a few 10-Qs around 2024 for compiler context
  const pick = res.filings.filter(
    (f) =>
      (f.form === "10-K" || f.form === "10-Q") &&
      f.filingDate >= "2023-01-01" &&
      f.filingDate <= "2025-12-31"
  ).slice(0, 12);

  const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-wb-"));
  const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-out-"));
  console.log("input:", tmpIn);
  console.log("output:", tmpOut);

  let q1CfLabels: string[] = [];

  for (const filing of pick) {
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      filingDate: filing.filingDate,
      primaryDocument: filing.primaryDocument,
      docUrl: filing.docUrl,
    });
    const wb = buildFacePresentedStatementsWorkbook({
      ticker: TICKER,
      cik: res.cik,
      filing,
      statements: payload.statements,
    });
    const bytes = workbookToXlsxUint8Array(wb);
    const fn = wbFilename(filing);
    await fs.writeFile(path.join(tmpIn, fn), Buffer.from(bytes));

    if (filing.accessionNumber === q1_24.accessionNumber) {
      const cf = payload.statements.find((s) => s.id === "cash-flow");
      q1CfLabels = cf?.rows.map((r) => r.label) ?? [];
      console.log(`\n1Q24 workbook saved: ${fn} CF rows=${q1CfLabels.length}`);
    }
  }

  console.log(`\nSaved ${pick.length} workbooks, running compiler...`);
  const result = await runCompiler(tmpIn, tmpOut);

  const models = result.models as Record<
    string,
    { quarterly: { periods: string[]; rows: Record<string, unknown>[] } }
  >;
  const cf = models?.cash_flow?.quarterly;
  if (!cf) throw new Error("no compiled cash_flow model");

  const p1q24 = cf.periods.find((p) => /^1Q24$/i.test(p)) ?? cf.periods.find((p) => /1Q24/i.test(p));
  console.log("\n=== COMPILED CF PERIODS (sample) ===");
  console.log(cf.periods.filter((p) => /24/.test(p)).join(", "));
  console.log("1Q24 key:", p1q24);

  const compiledLabels = cf.rows.map((r) => String(r.line ?? r.concept ?? ""));

  console.log("\n=== ROW COUNTS ===");
  console.log(`1Q24 source workbook: ${q1CfLabels.length}`);
  console.log(`Compiled quarterly CF: ${cf.rows.length}`);

  console.log("\n=== IN COMPILED BUT NOT IN 1Q24 WORKBOOK ===");
  for (const lab of compiledLabels) {
    if (!q1CfLabels.includes(lab)) {
      const row = cf.rows.find((r) => String(r.line) === lab)!;
      const v = p1q24 ? row[p1q24] : null;
      console.log(`  "${lab}"`);
      console.log(`    concept=${row.concept} 1Q24=${v ?? "(empty)"}`);
    }
  }

  console.log("\n=== IN 1Q24 WORKBOOK BUT NOT IN COMPILED ===");
  for (const lab of q1CfLabels) {
    if (!compiledLabels.includes(lab)) console.log(`  "${lab}"`);
  }

  console.log("\n=== COMPILED ROWS WITH 1Q24 VALUE (extra check) ===");
  for (const row of cf.rows) {
    const lab = String(row.line ?? "");
    const v = p1q24 ? row[p1q24] : null;
    if (v != null && v !== "" && !q1CfLabels.includes(lab)) {
      console.log(`  VALUE ROW not in wb: ${lab} = ${v} (${row.concept})`);
    }
  }

  const cov = result.coverage_pass as Record<string, number> | undefined;
  const fin = result.final_raw_reconcile as Record<string, number> | undefined;
  console.log("\n=== PIPELINE STATS ===");
  console.log("coverage_pass:", cov);
  console.log("final_raw_reconcile:", fin);
  console.log("unresolved_count:", result.unresolved_count);

  // Concept map entries for extra rows
  const cmap = (result.concept_map_summary ?? []) as Array<{
    stmt: string;
    raw: string;
    canon: string;
    status: string;
    notes: string;
  }>;
  const extraLabs = compiledLabels.filter((l) => !q1CfLabels.includes(l));
  if (extraLabs.length) {
    console.log("\n=== CONCEPT MAP FOR EXTRA ROWS ===");
    for (const lab of extraLabs.slice(0, 15)) {
      const row = cf.rows.find((r) => String(r.line) === lab);
      const canon = String(row?.concept ?? "");
      const hits = cmap.filter((c) => c.stmt === "cash_flow" && (c.canon === canon || c.raw === canon));
      for (const h of hits.slice(0, 3)) console.log(`  ${lab}: ${h.raw} -> ${h.canon} (${h.status}) ${h.notes}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
