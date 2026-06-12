/**
 * Diagnose LUMN CF FY21/FY22 missing rows below financing activities.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { buildFacePresentedStatementsWorkbook } from "@/lib/sec-ixbrl-face-save-client";
import { workbookToXlsxUint8Array } from "@/lib/sec-xbrl-presented-excel";

const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");
const FINANCING_ANCHOR = /net cash (?:used in|provided by|from) financing activities/i;

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

function rowsBelowAnchor(labels: string[]): { anchorIdx: number; below: string[] } {
  const anchorIdx = labels.findIndex((l) => FINANCING_ANCHOR.test(l));
  if (anchorIdx < 0) return { anchorIdx: -1, below: [] };
  return { anchorIdx, below: labels.slice(anchorIdx + 1) };
}

async function cfFromFiling(
  cik: string,
  filing: {
    accessionNumber: string;
    form: string;
    filingDate: string;
    primaryDocument: string;
    docUrl?: string | null;
  }
) {
  const payload = await fetchFacePresentedStatements({
    cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const cf = payload.statements.find((s) => s.id === "cash-flow");
  if (!cf) return null;
  const labels = cf.rows.map((r) => r.label);
  const periods = cf.periods.map((p) => ({ key: p.key, label: p.label }));
  const valuesByLabel: Record<string, Record<string, number | null>> = {};
  for (const r of cf.rows) {
    valuesByLabel[r.label] = { ...r.values };
  }
  return { labels, periods, valuesByLabel, rows: cf.rows };
}

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const k22 = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2023-02"));
  const k21 = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2022-02"));
  const k23 = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2024-02"));

  console.log("=== LUMN 10-K filings ===");
  for (const f of [k21, k22, k23].filter(Boolean)) {
    console.log(`  ${f!.filingDate} ${f!.accessionNumber}`);
  }

  for (const [tag, f] of [
    ["FY21 10-K", k21],
    ["FY22 10-K", k22],
    ["FY23 10-K", k23],
  ] as const) {
    if (!f) continue;
    const cf = await cfFromFiling(res.cik, f);
    if (!cf) {
      console.log(`\n${tag}: no CF`);
      continue;
    }
    console.log(`\n=== ${tag} (${f.filingDate}) CF periods ===`);
    for (const p of cf.periods) console.log(`  ${p.key} | ${p.label}`);

    const { anchorIdx, below } = rowsBelowAnchor(cf.labels);
    console.log(`\n${tag}: anchor idx=${anchorIdx}`);
    if (anchorIdx >= 0) {
      console.log(`  anchor: "${cf.labels[anchorIdx]}"`);
      console.log(`  rows below (${below.length}):`);
      for (const lab of below) {
        const vals = cf.valuesByLabel[lab] ?? {};
        const nums = Object.entries(vals)
          .filter(([, v]) => v != null && Number.isFinite(v))
          .map(([k, v]) => `${k}=${v}`);
        console.log(`    ${lab}${nums.length ? ` → ${nums.join(", ")}` : " → (no values)"}`);
      }
    }

    // Net change in cash / cash end — common tail lines
    const tailWatch = /net (?:increase|decrease|change) in cash|cash (?:at|and cash equivalents),? (?:beginning|end)/i;
    for (const lab of cf.labels) {
      if (!tailWatch.test(lab)) continue;
      const vals = cf.valuesByLabel[lab] ?? {};
      console.log(`  TAIL ${lab}:`, JSON.stringify(vals));
    }
  }

  // Compile subset: 10-K FY2019–FY2024 + recent 10-Q
  const pick = res.filings.filter(
    (f) =>
      (f.form === "10-K" && f.filingDate >= "2020-01-01" && f.filingDate <= "2025-06-01") ||
      (f.form === "10-Q" && f.filingDate >= "2023-01-01" && f.filingDate <= "2025-06-01")
  );
  const tmpIn = await fs.mkdtemp(path.join(os.tmpdir(), "lumn-fy21-"));
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

  console.log(`\n=== Compiling ${pick.length} workbooks ===`);
  const result = await runCompiler(tmpIn, tmpOut);
  const models = result.models as Record<string, { quarterly: { periods: string[]; rows: Record<string, unknown>[] } }>;
  const cf = models?.cash_flow?.quarterly;
  if (!cf) {
    console.log("No compiled CF");
    return;
  }

  const periods = ["4Q21", "FY21", "4Q22", "FY22", "4Q23", "FY23"];
  const labels = cf.rows.map((r) => String(r.line ?? r.concept ?? ""));
  const { anchorIdx, below } = rowsBelowAnchor(labels);

  console.log("\n=== COMPILED CF (rows below financing anchor) ===");
  console.log(`anchor idx=${anchorIdx} "${labels[anchorIdx] ?? "?"}"`);
  for (const row of cf.rows) {
    const lab = String(row.line ?? row.concept ?? "");
    if (!below.includes(lab) && !FINANCING_ANCHOR.test(lab)) continue;
    const cells = periods
      .map((p) => `${p}=${row[p] ?? "(empty)"}`)
      .join(" | ");
    console.log(`  ${lab}: ${cells}`);
  }

  const wt = result.workbook_truth as { issues_count?: number; issues?: unknown[] } | undefined;
  console.log("\n=== WORKBOOK TRUTH ===", wt?.issues_count ?? "?");
  const fyIssues = (wt?.issues ?? []).filter(
    (i: unknown) =>
      typeof i === "object" &&
      i != null &&
      ["FY21", "FY22", "4Q21", "4Q22"].includes(String((i as { period?: string }).period))
  );
  if (fyIssues.length) console.log(JSON.stringify(fyIssues.slice(0, 30), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
