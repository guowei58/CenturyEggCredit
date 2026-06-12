/**
 * Trace deferred revenue on LUMN 3Q24 CF: workbooks vs compiled.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import {
  buildFacePresentedStatementsWorkbook,
} from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const CONCEPT = "us-gaap:IncreaseDecreaseInDeferredRevenue";
const WATCH = /deferred revenue/i;
const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");

async function runCompiler(inputDir: string, outputDir: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const proc = spawn(
      process.env.PYTHON_PATH?.trim() || "python",
      [path.join(COMPILER_DIR, "main.py"), "--input", inputDir, "--output", outputDir],
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: 280_000 }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `exit ${code}`));
      else resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
    });
    proc.on("error", reject);
  });
}

function wbFilename(f: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = f.accessionNumber.replace(/[^\w-]+/g, "_");
  return `LUMN_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${acc}.xlsx`;
}

async function cfDeferredRows(filing: {
  accessionNumber: string;
  form: string;
  filingDate: string;
  primaryDocument: string;
  docUrl?: string | null;
}, cik: string) {
  const payload = await fetchFacePresentedStatements({
    cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const cf = payload.statements.find((s) => s.id === "cash-flow");
  if (!cf) return [];
  const hits: string[] = [];
  for (const r of cf.rows) {
    const concepts = cf.periods.map((p) => r.cellIxByPeriod[p.key]?.xbrlConcept).filter(Boolean);
    if (WATCH.test(r.label) || concepts.some((c) => c === CONCEPT)) {
      for (const p of cf.periods) {
        hits.push(
          `  ${filing.filingDate} ${filing.form} | ${r.label} | ${p.label} = ${r.values[p.key] ?? "(null)"}`
        );
      }
    }
  }
  return hits;
}

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const q1 = res.filings.find((f) => f.accessionNumber === "0000018926-24-000054");
  const q2 = res.filings.find((f) => f.form === "10-Q" && f.filingDate.startsWith("2024-08"));
  const q3 = res.filings.find((f) => f.form === "10-Q" && f.filingDate.startsWith("2024-11"));
  const k24 = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2025-02"));

  console.log("=== DEFERRED REVENUE ON FACE (2024 CF filings) ===\n");
  for (const f of [q1, q2, q3, k24].filter(Boolean)) {
    const rows = await cfDeferredRows(f!, res.cik);
    if (!rows.length) console.log(`${f!.filingDate} ${f!.form}: (no deferred revenue line)`);
    else rows.forEach((l) => console.log(l));
    console.log("");
  }

  const pick = res.filings.filter(
    (f) => (f.form === "10-K" || f.form === "10-Q") && f.filingDate >= "2023-01-01" && f.filingDate <= "2025-06-01"
  );
  const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-3q24-"));
  const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-out-"));

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
      ticker: "LUMN",
      cik: res.cik,
      filing,
      statements: payload.statements,
    });
    await fs.writeFile(path.join(tmpIn, wbFilename(filing)), Buffer.from(workbookToXlsxUint8Array(wb)));
  }

  const result = await runCompiler(tmpIn, tmpOut);
  const models = result.models as Record<string, { quarterly: { periods: string[]; rows: Record<string, unknown>[] } }>;
  const cf = models?.cash_flow?.quarterly;
  const row = cf?.rows.find(
    (r) => String(r.concept) === CONCEPT || WATCH.test(String(r.line ?? ""))
  );

  console.log("=== COMPILED CF — deferred revenue row ===");
  if (!row) {
    console.log("ROW NOT IN COMPILED GRID AT ALL");
  } else {
    console.log(`line: ${row.line}`);
    console.log(`concept: ${row.concept}`);
    for (const p of ["1Q24", "2Q24", "3Q24", "4Q24", "FY24", "6M24", "9M24"]) {
      if (p in row) console.log(`  ${p}: ${row[p] ?? "(empty)"}`);
    }
  }

  const wt = result.workbook_truth as { issues_count?: number; issues?: unknown[] } | undefined;
  console.log("\n=== WORKBOOK TRUTH ===", wt?.issues_count ?? "?", "issues");
  const drIssues = (wt?.issues ?? []).filter(
    (i: unknown) =>
      typeof i === "object" &&
      i != null &&
      (String((i as { canonical_row_id?: string }).canonical_row_id) === CONCEPT ||
        /deferred revenue/i.test(String((i as { line_label?: string }).line_label)))
  );
  if (drIssues.length) console.log(JSON.stringify(drIssues, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
