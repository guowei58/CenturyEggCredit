/**
 * Bulk-save (HTML face) → compile → workbook-truth audit for N random mid/small tickers.
 *
 * Usage:
 *   npx tsx scripts/audit-workbook-truth-50.ts [COUNT] [SEED]
 *
 * Output: scripts/.audit-truth-batch/results.json + summary.txt
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
const OUT_DIR = path.resolve(process.cwd(), "scripts", ".audit-truth-batch");
const PACE_MS = 450;
const COMPILER_TIMEOUT_MS = 360_000;

const TIERS: Record<string, string[]> = {
  mid: [
    "MANH", "HUBB", "DECK", "DUOL", "PCTY", "PEGA", "SON", "TER", "BURL", "SRPT", "RGEN", "GNRC", "ITT", "MIDD",
    "AIT", "BELFB", "BIO", "IONS", "ATMU", "NXST", "FICO", "HAS", "SAIA", "ITW", "EMR", "ETN", "PH", "ROP",
    "TDY", "ZBRA", "POOL", "WWD", "UFPI", "WSC", "DOV", "ROK", "IEX", "GNTX", "CHTR", "WAB", "JBL", "LDOS",
    "FTV", "KEYS", "TYL", "PODD", "WST", "RBC", "SSD", "AWI", "GFF", "MLI", "KWR", "MATX",
  ],
  small: [
    "CABO", "OPTU", "BHC", "BLCO", "MAGN", "GEN", "MODG", "CALX", "SPSC", "OSIS", "PRGS", "PDFS", "ATEN", "CEVA",
    "ZD", "VRA", "CRI", "GIII", "SCVL", "SHOO", "MGPI", "LKFN", "NPK", "MGRC", "TRNS", "LUMN", "HTZ", "AMC",
    "GOGO", "PLUS", "IIIV", "CRNC", "PRCT", "EVCM", "BLKB", "NTCT", "IMMR", "ATRO", "DCO", "KALU", "IIIN",
    "MTRX", "TILE", "HDSN", "KOP", "NGVT", "IOSP", "HCKT", "PRIM", "MYRG", "TTEC", "CLSK", "SPTN",
  ],
};

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
  const pool = shuffle([...new Set([...TIERS.mid, ...TIERS.small])], rand);
  return pool.slice(0, Math.min(count, pool.length));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function wbFilename(ticker: string, f: { form: string; filingDate: string; accessionNumber: string }) {
  const acc = f.accessionNumber.replace(/[^\w-]+/g, "_");
  return `${ticker}_SEC-XBRL-financials_as-presented_${f.form}_${f.filingDate}_${acc}.xlsx`;
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
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.slice(-4000) || `compiler exit ${code}`));
      else {
        try {
          resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
        } catch {
          reject(new Error(`invalid compiler JSON: ${stdout.slice(0, 500)}`));
        }
      }
    });
    proc.on("error", reject);
  });
}

function explainIssue(issue: WorkbookTruthIssue): string {
  switch (issue.issue) {
    case "extra_value":
      return "Reported value in compiled grid not on any period-primary workbook (comparative backfill, wrong filing owner, or stale consolidation).";
    case "missing_value":
      return "Headline workbook cell missing from compiled reported data (row/period mapping gap, consolidation drop, or truth loop did not restore).";
    case "missing_line":
      return "Line on a saved workbook (row list or facts) has no row in compiled statements.";
    case "extra_line":
      return "Compiled row carries reported values but line never appeared on any saved workbook.";
    case "value_mismatch":
      return "Same headline cell on workbook and compiled but numbers differ (multi-concept aggregation, sign, rounding, or master vs filing concept).";
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

    const compiled = await runCompiler(inputDir, outputDir);
    const wt = compiled.workbook_truth as {
      iterations?: number;
      issues_count?: number;
      issues?: WorkbookTruthIssue[];
    } | undefined;

    const issues = (wt?.issues ?? []) as WorkbookTruthIssue[];
    const issuesByType: Record<string, number> = {};
    const issuesByStatement: Record<string, number> = {};
    for (const i of issues) {
      issuesByType[i.issue] = (issuesByType[i.issue] ?? 0) + 1;
      const sl = stmtLabel(i.statement_type);
      issuesByStatement[sl] = (issuesByStatement[sl] ?? 0) + 1;
    }

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
  const count = Math.max(1, parseInt(process.argv[2] ?? "50", 10));
  const seed = parseInt(process.argv[3] ?? "20260521", 10);
  const tickers = pickTickers(count, seed);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const resultsPath = path.join(OUT_DIR, "results.json");
  const summaryPath = path.join(OUT_DIR, "summary.txt");

  console.log(`Audit: ${tickers.length} tickers (seed=${seed})`);
  console.log(tickers.join(", "));

  const results: TickerResult[] = [];
  for (let i = 0; i < tickers.length; i += 1) {
    const ticker = tickers[i]!;
    console.log(`\n[${i + 1}/${tickers.length}] ${ticker} ...`);
    const workRoot = path.join(OUT_DIR, "work", ticker);
    const r = await auditTicker(ticker, workRoot);
    results.push(r);
    console.log(
      `  saved=${r.filingsSaved} skip=${r.filingsSkipped} fail=${r.filingsFailed} ` +
        `compileOk=${r.compileOk} issues=${r.issues.length} (${r.elapsedSec}s)`
    );
    await fs.writeFile(resultsPath, JSON.stringify({ seed, count, tickers, results, updatedAt: new Date().toISOString() }, null, 2));
  }

  const withIssues = results.filter((r) => r.issues.length > 0);
  const failed = results.filter((r) => r.error);
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
    `Workbook truth audit — ${results.length} tickers (seed ${seed})`,
    `Clean (0 issues): ${clean.length}`,
    `With workbook-truth issues: ${withIssues.length}`,
    `Pipeline errors (no compile): ${failed.length}`,
    "",
    "Issues by type (all tickers):",
    ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Issues by statement:",
    ...Object.entries(byStmt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "── Tickers with issues ──",
  ];

  for (const r of withIssues.sort((a, b) => b.issues.length - a.issues.length)) {
    lines.push(`\n${r.ticker} (${r.issues.length} issues, iterations=${r.workbookTruthIterations}):`);
    for (const i of r.issues.slice(0, 40)) {
      lines.push(
        `  [${stmtLabel(i.statement_type)}] ${i.issue} | ${i.line_label || i.canonical_row_id} @ ${i.period || "(line)"} ` +
          `compiled=${i.compiled_value ?? "—"} workbook=${i.workbook_value ?? "—"}`
      );
      lines.push(`    → ${explainIssue(i)}`);
    }
    if (r.issues.length > 40) lines.push(`  ... +${r.issues.length - 40} more`);
  }

  if (failed.length) {
    lines.push("\n── Pipeline failures ──");
    for (const r of failed) {
      lines.push(`  ${r.ticker}: ${r.error} (saved=${r.filingsSaved})`);
    }
  }

  await fs.writeFile(summaryPath, lines.join("\n"));
  await fs.writeFile(path.join(OUT_DIR, "all-issues.json"), JSON.stringify(allIssues, null, 2));

  console.log("\n" + lines.join("\n"));
  console.log(`\nWrote ${resultsPath}`);
  console.log(`Wrote ${summaryPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
