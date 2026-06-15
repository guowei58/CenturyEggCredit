/**
 * Bulk-save (HTML face) → compile → strict workbook-truth audit for N random large-cap tickers.
 *
 * Validates compiled IS/BS/CF reported cells and line lists match period-primary workbooks
 * exactly (no missing/extra lines or values; value_mismatch tolerance 0.01 in compiler).
 *
 * Usage:
 *   npx tsx scripts/audit-workbook-truth-large.ts [COUNT] [SEED]
 *
 * Output: scripts/.audit-truth-large/results.json, summary.txt, all-issues.json
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
import { writeFileWithRetry } from "./lib/write-file-retry";

const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");
const OUT_DIR = path.resolve(process.cwd(), "scripts", ".audit-truth-large");
const PACE_MS = 450;
const COMPILER_TIMEOUT_MS = 900_000;

/** Large-cap / mega-cap universe (S&P 100-style). */
const LARGE_CAP_POOL = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK.B", "JPM", "WMT", "XOM",
  "JNJ", "V", "UNH", "PG", "HD", "KO", "PEP", "COST", "MRK", "ABBV",
  "TMO", "AVGO", "MCD", "CSCO", "ACN", "WFC", "ORCL", "IBM", "GE", "CAT",
  "BA", "DIS", "NKE", "LOW", "RTX", "HON", "QCOM", "SPGI", "INTC", "AMD",
  "PFE", "INTU", "AMGN", "TXN", "PM", "LLY", "CRM", "NFLX", "VZ", "T",
  "CMCSA", "GS", "MS", "BLK", "AXP", "SYK", "DE", "ISRG", "GILD", "BKNG",
  "ADI", "LRCX", "MU", "PANW", "SNPS", "CDNS", "ADBE", "NOW", "UBER", "ABT",
  "DHR", "BMY", "CVX", "COP", "SLB", "UPS", "FDX", "SBUX", "TGT", "MDT",
  "CI", "ELV", "REGN", "VRTX", "LMT", "NOC", "GD", "MMC", "CB", "PGR",
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
  return shuffle([...new Set(LARGE_CAP_POOL)], rand).slice(0, Math.min(count, LARGE_CAP_POOL.length));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function wbFilename(ticker: string, f: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = f.accessionNumber.replace(/[^\w-]+/g, "_");
  return `${ticker}_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${acc}.xlsx`;
}

function stmtFromLogToken(token: string): string {
  if (token === "income_statement") return "income_statement";
  if (token === "balance_sheet") return "balance_sheet";
  if (token === "cash_flow") return "cash_flow";
  return token;
}

function parseNum(s: string | undefined): number | null {
  if (!s || s === "—" || s === "None") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Recover issues when compiler exits non-zero but wrote processing_log.csv. */
async function parseIssuesFromProcessingLog(outputDir: string): Promise<WorkbookTruthIssue[]> {
  try {
    const log = await fs.readFile(path.join(outputDir, "processing_log.csv"), "utf8");
    const issues: WorkbookTruthIssue[] = [];
    const re =
      /\[(missing_value|extra_value|value_mismatch|missing_line|extra_line)\]\s+(\S+)\s+(.+?)\s+@\s+(\S+)\s+compiled=([^\s]+)\s+workbook=([^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(log)) !== null) {
      issues.push({
        issue: m[1]!,
        statement_type: stmtFromLogToken(m[2]!),
        line_label: m[3]!.trim(),
        canonical_row_id: m[3]!.trim(),
        period: m[4] === "(line)" ? "" : m[4]!,
        compiled_value: parseNum(m[5]),
        workbook_value: parseNum(m[6]),
      });
    }
    const lineRe =
      /\[(missing_line|extra_line)\]\s+(\S+)\s+(.+?)\s+@\s+\(line\)\s+compiled=([^\s]+)\s+workbook=([^\s]+)/g;
    while ((m = lineRe.exec(log)) !== null) {
      issues.push({
        issue: m[1]!,
        statement_type: stmtFromLogToken(m[2]!),
        line_label: m[3]!.trim(),
        canonical_row_id: m[3]!.trim(),
        period: "",
        compiled_value: parseNum(m[4]),
        workbook_value: parseNum(m[5]),
      });
    }
    return issues;
  } catch {
    return [];
  }
}

async function runCompiler(
  inputDir: string,
  outputDir: string
): Promise<{ compiled: Record<string, unknown>; stderr: string; exitCode: number }> {
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
    proc.on("close", (code) => {
      const exitCode = code ?? 1;
      try {
        const trimmed = stdout.trim();
        const jsonLine = trimmed.includes("{") ? trimmed.slice(trimmed.indexOf("{")) : trimmed;
        resolve({
          compiled: jsonLine ? (JSON.parse(jsonLine) as Record<string, unknown>) : {},
          stderr,
          exitCode,
        });
      } catch {
        resolve({ compiled: {}, stderr: stderr || stdout, exitCode });
      }
    });
    proc.on("error", reject);
  });
}

function explainIssue(issue: WorkbookTruthIssue): string {
  switch (issue.issue) {
    case "extra_value":
      return "Compiled has a reported number not on any period-primary workbook (added number).";
    case "missing_value":
      return "Workbook headline cell missing from compiled statements (missing number).";
    case "missing_line":
      return "Workbook line item has no row in compiled IS/BS/CF (missing row).";
    case "extra_line":
      return "Compiled row with reported values never appeared on any saved workbook (extra row).";
    case "value_mismatch":
      return "Same workbook cell and compiled cell but different amount (sign, aggregation, or rounding).";
    default:
      return "Unknown issue type.";
  }
}

function stmtLabel(st: string): string {
  if (st === "income_statement") return "IS";
  if (st === "balance_sheet") return "BS";
  if (st === "cash_flow") return "CF";
  return st;
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

  const fail = (error: string, partial?: Partial<TickerResult>): TickerResult => ({
    ticker,
    ok: false,
    error,
    filingsSaved,
    filingsSkipped,
    filingsFailed,
    compileOk: false,
    workbookTruthIterations: 0,
    issues: [],
    issuesByType: {},
    issuesByStatement: {},
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    ...partial,
  });

  try {
    const res = await getAllFilingsByTickerCached(ticker);
    if (!res) return fail("ticker not in SEC cache");

    const filings = prepareBulkPresentedFilings(res.filings, { minFilingYear: FACE_BULK_MIN_FILING_YEAR });
    if (!filings.length) return fail("no 10-K/10-Q since 2019");

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
        await writeFileWithRetry(
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

    if (filingsSaved < 2) return fail(`only ${filingsSaved} workbooks saved`);

    const { compiled, stderr, exitCode } = await runCompiler(inputDir, outputDir);
    const wt = compiled.workbook_truth as {
      iterations?: number;
      issues_count?: number;
      issues?: WorkbookTruthIssue[];
    } | undefined;

    let issues = (wt?.issues ?? []) as WorkbookTruthIssue[];
    if (!issues.length) {
      issues = await parseIssuesFromProcessingLog(outputDir);
    }

    const compileOk = exitCode === 0 && compiled.ok === true;
    const { issuesByType, issuesByStatement } = tallyIssues(issues);

    return {
      ticker,
      ok: compileOk && issues.length === 0,
      error: !compileOk && issues.length === 0 ? stderr.slice(-500) : undefined,
      filingsSaved,
      filingsSkipped,
      filingsFailed,
      compileOk,
      workbookTruthIterations: wt?.iterations ?? 0,
      issues,
      issuesByType,
      issuesByStatement,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
    };
  } catch (e) {
    const logIssues = await parseIssuesFromProcessingLog(outputDir);
    const { issuesByType, issuesByStatement } = tallyIssues(logIssues);
    return {
      ticker,
      ok: false,
      error: (e as Error).message?.slice(0, 500),
      filingsSaved,
      filingsSkipped,
      filingsFailed,
      compileOk: false,
      workbookTruthIterations: 0,
      issues: logIssues,
      issuesByType,
      issuesByStatement,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
    };
  }
}

async function main() {
  const count = Math.max(1, parseInt(process.argv[2] ?? "30", 10));
  const seed = parseInt(process.argv[3] ?? "20260612", 10);
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
  const failed = results.filter((r) => !r.ok);
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
    `Strict check: reported IS/BS/CF cells + lines vs period-primary workbooks (derived quarters excluded).`,
    `Clean (exact match): ${clean.length}`,
    `With mismatches: ${withIssues.length}`,
    `Failed pipeline: ${failed.length}`,
    "",
    "Issues by type:",
    ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Issues by statement:",
    ...Object.entries(byStmt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "── All mismatches ──",
  ];

  for (const r of withIssues.sort((a, b) => b.issues.length - a.issues.length)) {
    lines.push(`\n${r.ticker} (${r.issues.length} issues):`);
    for (const i of r.issues) {
      lines.push(
        `  [${stmtLabel(i.statement_type)}] ${i.issue} | ${i.line_label || i.canonical_row_id} @ ${i.period || "(line)"} ` +
          `compiled=${i.compiled_value ?? "—"} workbook=${i.workbook_value ?? "—"}`
      );
      lines.push(`    → ${explainIssue(i)}`);
    }
  }

  const pipelineFails = results.filter((r) => r.error && r.issues.length === 0);
  if (pipelineFails.length) {
    lines.push("\n── Pipeline failures (no compile / no issues parsed) ──");
    for (const r of pipelineFails) {
      lines.push(`  ${r.ticker}: ${r.error} (saved=${r.filingsSaved})`);
    }
  }

  const summary = lines.join("\n");
  await fs.writeFile(summaryPath, summary);
  await fs.appendFile(logPath, "\n" + summary + "\n");
  await fs.writeFile(path.join(OUT_DIR, "all-issues.json"), JSON.stringify(allIssues, null, 2));

  console.log("\n" + summary);
  console.log(`\nWrote ${resultsPath}`);
  console.log(`Wrote ${summaryPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
