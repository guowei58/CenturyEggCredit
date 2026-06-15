/**
 * Latest truth: live-fetch HTZ workbooks (Step 1 path) → compile → write report.
 * Usage: npx tsx scripts/run-htz-compile-latest.ts
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import {
  FACE_BULK_MIN_FILING_YEAR,
  prepareBulkPresentedFilings,
} from "@/lib/sec-xbrl-as-presented-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");
const WORK = path.resolve(process.cwd(), "scripts/.htz-live-compile");
const INPUT = path.join(WORK, "in");
const OUTPUT = path.join(WORK, "out");
const PACE_MS = 350;
const COMPILER_TIMEOUT_MS = 600_000;

function wbFilename(ticker: string, f: { form: string; filingDate: string; accessionNumber: string }) {
  return `${ticker}_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${f.accessionNumber}.xlsx`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCompiler(inputDir: string, outputDir: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.env.PYTHON_PATH?.trim() || "python",
      [path.join(COMPILER_DIR, "main.py"), "--input", inputDir, "--output", outputDir],
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: COMPILER_TIMEOUT_MS }
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
      if (code !== 0) reject(new Error(stderr.slice(-6000) || `compiler exit ${code}`));
      else {
        try {
          resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
        } catch {
          reject(new Error(`invalid compiler JSON: ${stdout.slice(0, 800)}`));
        }
      }
    });
    proc.on("error", reject);
  });
}

async function main() {
  const ticker = "HTZ";
  await fs.mkdir(INPUT, { recursive: true });
  await fs.mkdir(OUTPUT, { recursive: true });

  const res = await getAllFilingsByTickerCached(ticker);
  if (!res) throw new Error("HTZ not in SEC cache");

  const filings = prepareBulkPresentedFilings(res.filings, { minFilingYear: FACE_BULK_MIN_FILING_YEAR });
  console.log(`Fetching ${filings.length} HTZ filings (>= ${FACE_BULK_MIN_FILING_YEAR})...\n`);

  let saved = 0;
  let failed = 0;
  for (const filing of filings) {
    try {
      const payload = await fetchFacePresentedStatements({
        cik: res.cik,
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        filingDate: filing.filingDate,
        primaryDocument: filing.primaryDocument,
        docUrl: filing.docUrl,
      });
      if (!payload.statements.length) {
        console.log(`  skip (no statements): ${filing.filingDate} ${filing.form}`);
        continue;
      }
      const wb = buildFacePresentedStatementsWorkbook({
        ticker,
        cik: res.cik,
        companyName: res.companyName,
        filing,
        statements: payload.statements,
        validation: payload.validation,
        calculationLinkbaseLoaded: payload.calculationLinkbaseLoaded,
      });
      const fn = wbFilename(ticker, filing);
      await fs.writeFile(path.join(INPUT, fn), Buffer.from(workbookToXlsxUint8Array(wb)));
      saved += 1;
      process.stdout.write(`  saved ${fn}\n`);
    } catch (e) {
      failed += 1;
      console.error(`  FAIL ${filing.filingDate} ${filing.form}:`, (e as Error).message?.slice(0, 150));
    }
    await sleep(PACE_MS);
  }

  console.log(`\nSaved ${saved} workbooks, failed ${failed}. Running compiler...\n`);
  const compiled = await runCompiler(INPUT, OUTPUT);
  await fs.writeFile(path.join(WORK, "compile-result.json"), JSON.stringify(compiled, null, 2));

  console.log("\n=== COMPILE SUMMARY ===");
  console.log(JSON.stringify({
    ok: compiled.ok,
    master_workbook: compiled.master_workbook,
    master_row_count: compiled.master_row_count,
    concept_map_count: compiled.concept_map_count,
    mapped_count: compiled.mapped_count,
    unresolved_count: compiled.unresolved_count,
    conflict_count: compiled.conflict_count,
    validation_passed: compiled.validation_passed,
    validation_failed: compiled.validation_failed,
    within_file_sums: compiled.within_file_sum_count,
    workbook_truth_issues: (compiled.workbook_truth as { issues_count?: number })?.issues_count,
  }, null, 2));
  console.log(`\nOutput: ${OUTPUT}`);
  console.log(`Report script: python xbrl-compiler/scripts/analyze_htz_compile.py`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
