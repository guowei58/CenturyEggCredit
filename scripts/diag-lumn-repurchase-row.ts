/**
 * Trace LUMN CF stock repurchase / buyback line through compile.
 * Usage: npx tsx scripts/diag-lumn-repurchase-row.ts
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const TICKER = "LUMN";
const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");

function wbFilename(filing: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = filing.accessionNumber.replace(/[^\w-]+/g, "_");
  return `${TICKER}_SEC-XBRL-financials_as-presented_${filing.form}_${filing.filingDate}_${acc}.xlsx`;
}

function isRepurchaseRow(label: string, concept: string): boolean {
  return (
    /repurch|buyback|treasury share/i.test(label) ||
    /RepurchaseOfCommonStock|StockRepurchased/i.test(concept)
  );
}

async function runCompiler(inputDir: string, outputDir: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.env.PYTHON_PATH?.trim() || process.env.PYTHON_CMD?.trim() || "python",
      [path.join(COMPILER_DIR, "main.py"), "--input", inputDir, "--output", outputDir],
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: 600_000 },
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

  const filings = res.filings.filter(
    (f) => (f.form === "10-K" || f.form === "10-Q") && f.filingDate >= "2019-01-01",
  );

  const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-rep-"));
  const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-rep-out-"));

  const wbHits: { fn: string; label: string; concept: string }[] = [];

  for (const filing of filings) {
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      filingDate: filing.filingDate,
      primaryDocument: filing.primaryDocument,
      docUrl: filing.docUrl,
    });
    const cf = payload.statements.find((s) => s.id === "cash-flow");
    for (const r of cf?.rows ?? []) {
      const concept = r.concept ?? "";
      if (isRepurchaseRow(r.label, concept)) {
        wbHits.push({ fn: wbFilename(filing), label: r.label, concept });
      }
    }
    const wb = buildFacePresentedStatementsWorkbook({
      ticker: TICKER,
      cik: res.cik,
      filing,
      statements: payload.statements,
    });
    await fs.writeFile(path.join(tmpIn, wbFilename(filing)), Buffer.from(workbookToXlsxUint8Array(wb)));
  }

  console.log("=== WORKBOOK CF REPURCHASE LINES ===");
  console.log("count:", wbHits.length);
  for (const h of wbHits) {
    console.log(`  ${h.fn}`);
    console.log(`    ${h.label} | ${h.concept}`);
  }

  const result = await runCompiler(tmpIn, tmpOut);
  const models = result.models as Record<
    string,
    { quarterly: { rows: Record<string, unknown>[] }; annual: { rows: Record<string, unknown>[] } }
  >;
  const cfRows = [
    ...(models?.cash_flow?.quarterly?.rows ?? []),
    ...(models?.cash_flow?.annual?.rows ?? []),
  ];
  const seen = new Set<string>();
  const compiled = cfRows.filter((r) => {
    const line = String(r.line ?? "");
    const concept = String(r.concept ?? "");
    if (!isRepurchaseRow(line, concept)) return false;
    const key = `${concept}::${line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log("\n=== COMPILED MODELS (UI) ===");
  console.log("repurchase rows:", compiled.length);
  for (const r of compiled) {
    console.log(`  ${r.line} | ${r.concept}`);
    console.log(`    FY19=${r.FY19} FY22=${r.FY22} FY24=${r.FY24} FY25=${r.FY25}`);
  }

  const masterCsv = await fs.readFile(path.join(tmpOut, "master_presentation_rows.csv"), "utf8");
  const masterHits = masterCsv.split("\n").filter((l) => /repurch|buyback|RepurchaseOfCommonStock/i.test(l));
  console.log("\n=== MASTER PRESENTATION ===");
  console.log("repurchase rows:", masterHits.length);
  for (const l of masterHits) console.log(`  ${l}`);

  const cmap = (result.concept_map_summary ?? []) as Array<{
    stmt: string;
    raw: string;
    canon: string;
    status: string;
    notes: string;
  }>;
  const cmapHits = cmap.filter(
    (c) => c.stmt === "cash_flow" && /repurch|RepurchaseOfCommonStock/i.test(`${c.raw}${c.canon}${c.notes}`),
  );
  console.log("\n=== CONCEPT MAP (repurchase-related) ===");
  for (const c of cmapHits) {
    console.log(`  ${c.raw} -> ${c.canon} (${c.status})`);
  }

  const dedup = result.row_deduplication as { enabled?: boolean; changed: boolean; rows_removed: number; detail: unknown[] };
  console.log("\n=== DEDUP ===", dedup);

  if (wbHits.length && !compiled.length) {
    console.log("\n>>> Repurchase appears in workbooks but NOT in compiled UI models.");
  }
  if (wbHits.length && !masterHits.length) {
    console.log("\n>>> Repurchase appears in workbooks but NOT in master presentation.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
