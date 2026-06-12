/**
 * Bulk-save (HTML face) → compile → strict workbook-truth audit for N random large-cap tickers.
 *
 * Compares compiled IS/BS/CF *reported* cells and line lists against period-primary
 * saved workbooks (derived quarters excluded). Records missing/extra values and lines.
 *
 * Usage:
 *   npx tsx scripts/audit-workbook-truth-large.ts [COUNT] [SEED]
 *
 * Output: scripts/.audit-truth-large-batch/
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
const OUT_DIR = path.resolve(process.cwd(), "scripts", ".audit-truth-large-batch");
const PACE_MS = 450;
const COMPILER_TIMEOUT_MS = 600_000;

/** Large-cap universe (S&P-style names, ~$10B+). */
const LARGE_CAP_POOL = [
  "KO", "PEP", "COST", "MRK", "ABBV", "TMO", "AVGO", "MCD", "CSCO", "ACN", "WFC", "ORCL", "IBM", "GE", "CAT",
  "BA", "DIS", "NKE", "LOW", "RTX", "HON", "QCOM", "SPGI", "INTC", "AMD", "PFE", "INTU", "AMGN", "TXN", "PM",
  "LIN", "NEE", "CRM", "ADBE", "NFLX", "UPS", "MS", "GS", "BLK", "SCHW", "AXP", "BKNG", "DE", "MMC", "CI",
  "ELV", "SO", "DUK", "BMY", "GILD", "MDLZ", "CVS", "TJX", "SBUX", "MO", "CL", "EOG", "SLB", "REGN", "ISRG",
];

type WorkbookTruthIssue = {
  statement_type: string;
  canonical_row_id: string;
  period: string;
  line_label: string;
  issue: string;
  compiled_value: number | null;
  workbook_value: number | null;
};

type TickerResult = {
  ticker: string;
  ok: boolean;
  error?: string;
  filingsSaved: number;
  filingsSkipped: number;
  filingsFailed: number;
  compileOk: boolean;
  workbookTruthIterations: number;
  issues: WorkbookTruthIssue[];
  issuesByType: Record<string, number>;
  issuesByStatement: Record<string, number>;
  elapsedSec: number;
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickTickers(count: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const pool = shuffle([...new Set(LARGE_CAP_POOL)], rand);
  return pool.slice(0, Math.min(count, pool.length));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function wbFilename(ticker: string, f: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = f.accessionNumber.replace(/[^\w-]+/g, "_");
  return `${ticker}_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${acc}.xlsx`;
}

function stmtLabel(st: string): string {
  if (st === "income_statement") return "IS";
  if (st === "balance_sheet") return "BS";
  if (st === "cash_flow") return "CF";
  return st;
}

function explainIssue(issue: WorkbookTruthIssue): string {
  switch (issue.issue) {
    case "extra_value":
      return "Compiled has a reported number not on any period-primary workbook (extra cell).";
    case "missing_value":
      return "Workbook headline cell missing from compiled statements (missing number).";
    case "missing_line":
      return "Row on saved workbook has no line in compiled IS/BS/CF (missing row).";
    case "extra_line":
      return "Compiled row with reported values never appeared on any workbook (extra row).";
    case "value_mismatch":
      return "Same workbook cell and compiled cell but numbers differ (wrong number).";
    default:
      return "Unknown issue type.";
  }
}

function parseIssuesFromProcessingLog(text: string): WorkbookTruthIssue[] {
  const issues: WorkbookTruthIssue[] = [];
  const lineRe =
    /\[(missing_value|extra_value|value_mismatch|missing_line|extra_line)\]\s+(income_statement|balance_sheet|cash_flow)\s+(.+?)\s+@\s+(\S+)\s+compiled=([-\d.eE+]+|None)\s+workbook=([-\d.eE+]+|None)/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, issue, st, label, period, compiled, workbook] = m;
    issues.push({
      statement_type: st,
      canonical_row_id: label.trim(),
      period: period === "(line)" ? "" : period,
      line_label: label.trim(),
      issue,
      compiled_value: compiled === "None" ? null : parseFloat(compiled),
      workbook_value: workbook === "None" ? null : parseFloat(workbook),
    });
  }
  return issues;
}

async function readIssuesFromLog(outputDir: string): Promise<WorkbookTruthIssue[]> {
  try {
    const log = await fs.readFile(path.join(outputDir, "processing_log.csv"), "utf8");
    return parseIssuesFromProcessingLog(log);
  } catch {
    return [];
  }
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
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", async (code) => {
      if (code !== 0) {
        const logIssues = await readIssuesFromLog(outputDir);
        const err = new Error(stderr.slice(-4000) || `compiler exit ${code}`) as Error & {
          logIssues?: WorkbookTruthIssue[];
          partialStdout?: string;
        };
        err.logIssues = logIssues;
        err.partialStdout = stdout;
        reject(err);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
      } catch {
        reject(new Error(`invalid compiler JSON: ${stdout.slice(0, 500)}`));
      }
    });
    proc.on("error", reject);
  });
}

function tallyIssues(issues: WorkbookTruthIssue[]) {
  const issuesByType: Record<string, number> = {};
  const issuesByStatement: Record<string, number> = {};
  for (const i of issues) {
    issuesByType[i.issue] = (issuesByType[i.issue] ?? 0) + 1;
    const sl = stmtLabel(i.statement_type);
    issuesByStatement[sl] = (issuesByStatement[sl] ?? 0) + 1;
  }
  return { issuesByType, issuesByStatement };
}

async function auditTicker(ticker: string, workRoot: string): Promise<TickerResult> {
  const t0 = Date.now();
  const inputDir = path.join(workRoot, "in");
  const outputDir = path.join(workRoot, "out");
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  let filingsSaved = 0;
  let filingsSkipped = 0;
  let filingsFailed = 0;

  try {
    const res = await getAllFilingsByTickerCached(ticker);
    if (!res) {
      return {
        ticker, ok: false, error: "ticker not in SEC cache", filingsSaved, filingsSkipped, filingsFailed,
        compileOk: false, workbookTruthIterations: 0, issues: [], issuesByType: {}, issuesByStatement: {},
        elapsedSec: Math.round((Date.now() - t0) / 1000),
      };
    }

    const filings = prepareBulkPresentedFilings(res.filings, { minFilingYear: FACE_BULK_MIN_FILING_YEAR });
    if (!filings.length) {
      return {
        ticker, ok: false, error: "no 10-K/10-Q since 2019", filingsSaved, filingsSkipped, filingsFailed,
        compileOk: false, workbookTruthIterations: 0, issues: [], issuesByType: {}, issuesByStatement: {},
        elapsedSec: Math.round((Date.now() - t0) / 1000),
      };
    }

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
          filingsSkipped += 1;
          await sleep(PACE_MS);
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
        await fs.writeFile(
          path.join(inputDir, wbFilename(ticker, filing)),
          Buffer.from(workbookToXlsxUint8Array(wb))
        );
        filingsSaved += 1;
      } catch (e) {
        filingsFailed += 1;
        console.error(`  [${ticker}] fail ${filing.filingDate} ${filing.form}:`, (e as Error).message?.slice(0, 120));
      }
      await sleep(PACE_MS);
    }

    if (filingsSaved < 2) {
      return {
        ticker, ok: false, error: `only ${filingsSaved} workbooks saved`, filingsSaved, filingsSkipped, filingsFailed,
        compileOk: false, workbookTruthIterations: 0, issues: [], issuesByType: {}, issuesByStatement: {},
        elapsedSec: Math.round((Date.now() - t0) / 1000),
      };
    }

    let compiled: Record<string, unknown>;
    try {
      compiled = await runCompiler(inputDir, outputDir);
    } catch (e) {
      const err = e as Error & { logIssues?: WorkbookTruthIssue[] };
      const issues = err.logIssues?.length ? err.logIssues : await readIssuesFromLog(outputDir);
      const { issuesByType, issuesByStatement } = tallyIssues(issues);
      return {
        ticker,
        ok: false,
        error: err.message?.slice(0, 500),
        filingsSaved,
        filingsSkipped,
        filingsFailed,
        compileOk: false,
        workbookTruthIterations: 0,
        issues,
        issuesByType,
        issuesByStatement,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
      };
    }

    const wt = compiled.workbook_truth as {
      iterations?: number;
      issues_count?: number;
      issues?: WorkbookTruthIssue[];
    } | undefined;

    const issues = (wt?.issues ?? []) as WorkbookTruthIssue[];
    const { issuesByType, issuesByStatement } = tallyIssues(issues);

    return {
      ticker,
      ok: compiled.ok === true && issues.length === 0,
      filingsSaved,
      filingsSkipped,
      filingsFailed,
      compileOk: compiled.ok === true,
      workbookTruthIterations: wt?.iterations ?? 0,
      issues,
      issuesByType,
      issuesByStatement,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
    };
  } catch (e) {
    return {
      ticker,
      ok: false,
      error: (e as Error).message?.slice(0, 500),
      filingsSaved,
      filingsSkipped,
      filingsFailed,
      compileOk: false,
      workbookTruthIterations: 0,
      issues: [],
      issuesByType: {},
      issuesByStatement: {},
      elapsedSec: Math.round((Date.now() - t0) / 1000),
    };
  }
}

async function main() {
  const count = Math.max(1, parseInt(process.argv[2] ?? "30", 10));
  const seed = parseInt(process.argv[3] ?? "20260522", 10);
  const tickers = pickTickers(count, seed);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const resultsPath = path.join(OUT_DIR, "results.json");
  const summaryPath = path.join(OUT_DIR, "summary.txt");
  const logPath = path.join(OUT_DIR, "run.log");

  const header = `Large-cap workbook truth audit — ${tickers.length} tickers (seed ${seed})\n${tickers.join(", ")}\n`;
  console.log(header);
  await fs.writeFile(logPath, header);

  const results: TickerResult[] = [];
  for (let i = 0; i < tickers.length; i += 1) {
    const ticker = tickers[i]!;
    const line = `\n[${i + 1}/${tickers.length}] ${ticker} ...\n`;
    process.stdout.write(line);
    await fs.appendFile(logPath, line);

    const workRoot = path.join(OUT_DIR, "work", ticker);
    const r = await auditTicker(ticker, workRoot);
    results.push(r);

    const status =
      `  saved=${r.filingsSaved} skip=${r.filingsSkipped} fail=${r.filingsFailed} ` +
      `compileOk=${r.compileOk} issues=${r.issues.length} (${r.elapsedSec}s)\n`;
    process.stdout.write(status);
    await fs.appendFile(logPath, status);

    await fs.writeFile(
      resultsPath,
      JSON.stringify({ tier: "large", seed, count, tickers, results, updatedAt: new Date().toISOString() }, null, 2)
    );
  }

  const withIssues = results.filter((r) => r.issues.length > 0);
  const failed = results.filter((r) => r.error && r.issues.length === 0);
  const clean = results.filter((r) => r.ok);

  const allIssues = withIssues.flatMap((r) =>
    r.issues.map((i) => ({ ticker: r.ticker, ...i, why: explainIssue(i) }))
  );

  const byType: Record<string, number> = {};
  const byStmt: Record<string, number> = {};
  for (const i of allIssues) {
    byType[i.issue] = (byType[i.issue] ?? 0) + 1;
    byStmt[stmtLabel(i.statement_type)] = (byStmt[stmtLabel(i.statement_type)] ?? 0) + 1;
  }

  const lines: string[] = [
    `Large-cap workbook truth audit — ${results.length} tickers (seed ${seed})`,
    `Tickers: ${tickers.join(", ")}`,
    "",
    "Strict check: every reported IS/BS/CF cell on period-primary workbooks must match compiled;",
    "no extra reported cells or lines. (Derived quarters excluded.)",
    "",
    `Clean (exact match): ${clean.length}`,
    `With mismatches: ${withIssues.length}`,
    `Pipeline errors (no compile / no issues captured): ${failed.length}`,
    "",
    "Issues by type:",
    ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Issues by statement:",
    ...Object.entries(byStmt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "── All mismatches ──",
  ];

  for (const row of allIssues) {
    lines.push(
      `${row.ticker} [${stmtLabel(row.statement_type)}] ${row.issue} | ` +
        `${row.line_label || row.canonical_row_id} @ ${row.period || "(line)"} ` +
        `compiled=${row.compiled_value ?? "—"} workbook=${row.workbook_value ?? "—"}`
    );
    lines.push(`  → ${row.why}`);
  }

  if (failed.length) {
    lines.push("\n── Pipeline failures (no mismatch detail) ──");
    for (const r of failed) {
      lines.push(`  ${r.ticker}: ${r.error} (saved=${r.filingsSaved})`);
    }
  }

  const summary = lines.join("\n");
  await fs.writeFile(summaryPath, summary);
  await fs.writeFile(path.join(OUT_DIR, "all-issues.json"), JSON.stringify(allIssues, null, 2));
  await fs.appendFile(logPath, "\n" + summary);

  console.log("\n" + summary);
  console.log(`\nWrote ${resultsPath}`);
  console.log(`Wrote ${summaryPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
