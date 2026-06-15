/**
 * Diagnose LUMN missing CF rows: FY22 "Loss on disposal groups held for sale"
 * and 1Q19 financing "Other, net".
 *
 * Usage: npx tsx scripts/diag-lumn-missing-cf-rows.ts
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

const TICKER = "LUMN";
const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");

const TARGETS = [
  { label: "Loss on disposal groups held for sale", period: "FY22", form: "10-K", datePrefix: "2023-02" },
  { label: "Other, net", period: "1Q19", form: "10-Q", datePrefix: "2019-05" },
];

function wbFilename(filing: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = filing.accessionNumber.replace(/[^\w-]+/g, "_");
  return `${TICKER}_SEC-XBRL-financials_as-presented_${filing.form}_${filing.filingDate}_${acc}.xlsx`;
}

async function runCompiler(inputDir: string, outputDir: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.env.PYTHON_PATH?.trim() || process.env.PYTHON_CMD?.trim() || "python",
      [path.join(COMPILER_DIR, "main.py"), "--input", inputDir, "--output", outputDir],
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: 600_000 }
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

async function main() {
  const res = await getAllFilingsByTickerCached(TICKER);
  if (!res) throw new Error("no LUMN");

  const pick = res.filings.filter(
    (f) =>
      (f.form === "10-K" || f.form === "10-Q") &&
      f.filingDate >= "2018-01-01" &&
      f.filingDate <= "2025-12-31"
  );

  const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-diag-"));
  const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-diag-out-"));
  console.log("input:", tmpIn);
  console.log("output:", tmpOut);

  const wbCfByFile: Record<string, { label: string; concept: string; values: Record<string, number | null> }[]> = {};

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
    const fn = wbFilename(filing);
    await fs.writeFile(path.join(tmpIn, fn), Buffer.from(workbookToXlsxUint8Array(wb)));

    const cf = payload.statements.find((s) => s.id === "cash-flow");
    if (cf) {
      wbCfByFile[fn] = cf.rows.map((r) => ({
        label: r.label,
        concept: r.concept ?? "",
        values: r.values,
      }));
    }
  }

  console.log(`\nSaved ${pick.length} workbooks, running compiler...`);
  const result = await runCompiler(tmpIn, tmpOut);

  const models = result.models as Record<
    string,
    {
      quarterly: { periods: string[]; rows: Record<string, unknown>[] };
      annual: { periods: string[]; rows: Record<string, unknown>[] };
    }
  >;
  const cfQ = models?.cash_flow?.quarterly;
  const cfA = models?.cash_flow?.annual;
  const cmap = (result.concept_map_summary ?? []) as Array<{
    stmt: string; raw: string; canon: string; status: string; notes: string;
  }>;
  const dedup = result.row_deduplication as { changed: boolean; rows_removed: number; detail: unknown[] } | undefined;
  const wbTruth = result.workbook_truth as { issues?: unknown[]; iterations: number } | undefined;

  console.log("\n=== PIPELINE ===");
  console.log("dedup:", dedup);
  console.log("workbook_truth issues:", wbTruth?.issues?.length ?? 0, wbTruth?.issues?.slice(0, 5));
  console.log("ok:", result.ok);

  for (const t of TARGETS) {
    console.log(`\n======== TARGET: "${t.label}" @ ${t.period} ========`);

    const srcFiling = pick.find((f) => f.form === t.form && f.filingDate.startsWith(t.datePrefix));
    if (!srcFiling) {
      console.log("source filing not found");
      continue;
    }
    const srcFn = wbFilename(srcFiling);
    const wbRows = wbCfByFile[srcFn] ?? [];
    const wbRow = wbRows.find((r) => r.label === t.label);
    console.log("source filing:", srcFn);
    if (wbRow) {
      console.log("  workbook concept:", wbRow.concept);
      console.log("  workbook values:", JSON.stringify(wbRow.values));
    } else {
      console.log("  NOT IN SOURCE WORKBOOK EXTRACTION");
      const partial = wbRows.filter((r) => r.label.toLowerCase().includes(t.label.toLowerCase().slice(0, 8)));
      console.log("  partial matches:", partial.map((r) => r.label));
    }

    const qRow = cfQ?.rows.find((r) => String(r.line) === t.label);
    const aRow = cfA?.rows.find((r) => String(r.line) === t.label);
    console.log("compiled quarterly row:", qRow ? "YES" : "NO");
    console.log("compiled annual row:", aRow ? "YES" : "NO");
    if (qRow) {
      console.log("  concept:", qRow.concept, "1Q19=", qRow["1Q19"], "FY22=", qRow["FY22"], "_workbookLine=", qRow._workbookLine);
    }
    if (aRow) {
      console.log("  concept:", aRow.concept, "FY22=", aRow["FY22"], "_workbookLine=", aRow._workbookLine);
    }

    // Search by partial label / value
    const canon = wbRow?.concept ?? "";
    const cmapHits = cmap.filter((c) => c.stmt === "cash_flow" && (c.raw === canon || c.canon === canon || c.raw.includes("Disposal") || c.raw.includes("OtherFinanc")));
    console.log("concept map hits:", cmapHits.slice(0, 5));

    // Check if merged into another row with same value
    const targetVal = wbRow?.values[t.period === "FY22" ? "p1" : "p1"] ?? wbRow?.values[t.period];
    if (targetVal != null) {
      const valMatches = (cfQ?.rows ?? []).filter((r) => {
        const v = r[t.period];
        return v != null && Math.abs(Number(v) - Number(targetVal)) < 0.01;
      });
      if (valMatches.length) {
        console.log(`rows with ${t.period}=${targetVal}:`, valMatches.map((r) => `${r.line} (${r.concept})`));
      }
    }

    // Dedup detail for this concept
    if (dedup?.detail) {
      const hits = (dedup.detail as Array<{ kept?: string; removed?: string[]; statement_type?: string }>).filter(
        (d) =>
          d.statement_type === "cash_flow" &&
          (d.kept === canon ||
            d.removed?.includes(canon) ||
            (d.removed ?? []).some((x) => x.includes("Disposal") || x.includes("OtherFinanc")))
      );
      if (hits.length) console.log("dedup merges:", JSON.stringify(hits, null, 2));
    }
  }

  // Read master_presentation_rows.csv for disposal/other
  const masterCsv = await fs.readFile(path.join(tmpOut, "master_presentation_rows.csv"), "utf8").catch(() => "");
  if (masterCsv) {
    console.log("\n=== MASTER ROWS (disposal/other) ===");
    for (const line of masterCsv.split("\n")) {
      if (/disposal|OtherFinanc|OtherNoncash|Other, net/i.test(line)) console.log(line);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
