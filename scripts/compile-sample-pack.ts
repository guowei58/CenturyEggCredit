/**
 * Download SEC face workbooks → compile → zip consolidated Excel for manual review.
 *
 * Usage:
 *   npx tsx scripts/compile-sample-pack.ts PG,XOM,NKE
 *   npx tsx scripts/compile-sample-pack.ts --count 5 --seed 20260613
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import JSZip from "jszip";
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
const PACK_DIR = path.resolve(process.cwd(), "scripts", ".sample-compile-pack");
const PACE_MS = 450;
const COMPILER_TIMEOUT_MS = 900_000;

const TIERS: Record<string, string[]> = {
  mega: [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK.B", "JPM", "WMT", "XOM", "JNJ", "V", "UNH", "PG", "HD",
  ],
  large: [
    "KO", "PEP", "COST", "MRK", "ABBV", "TMO", "AVGO", "MCD", "CSCO", "ACN", "WFC", "ORCL", "IBM", "GE", "CAT",
    "BA", "DIS", "NKE", "LOW", "RTX", "HON", "QCOM", "SPGI", "INTC", "AMD", "PFE", "INTU", "AMGN", "TXN", "PM",
  ],
  mid: [
    "MANH", "HUBB", "DECK", "DUOL", "PCTY", "PEGA", "SON", "TER", "BURL", "SRPT", "RGEN", "GNRC", "ITT", "MIDD",
    "AIT", "BELFB", "BIO", "IONS", "ATMU", "NXST", "FICO", "HAS", "SAIA", "ITW", "EMR", "ETN", "PH", "ROP",
  ],
  small: [
    "CABO", "OPTU", "BHC", "BLCO", "MAGN", "GEN", "MODG", "CALX", "SPSC", "OSIS", "PRGS", "PDFS", "ATEN", "CEVA",
    "ZD", "VRA", "CRI", "GIII", "SCVL", "SHOO", "MGPI", "LKFN", "NPK", "MGRC", "TRNS", "LUMN", "HTZ",
  ],
};

type TickerResult = {
  ticker: string;
  ok: boolean;
  error?: string;
  filingsSaved: number;
  filingsSkipped: number;
  filingsFailed: number;
  compileOk: boolean;
  outputFile?: string;
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
  const quotas = {
    mega: Math.max(1, Math.round(count * 0.3)),
    large: Math.max(1, Math.round(count * 0.3)),
    mid: Math.max(1, Math.round(count * 0.2)),
    small: Math.max(0, count - 3),
  };
  let picked = [
    ...shuffle([...new Set(TIERS.mega)], rand).slice(0, quotas.mega),
    ...shuffle([...new Set(TIERS.large)], rand).slice(0, quotas.large),
    ...shuffle([...new Set(TIERS.mid)], rand).slice(0, quotas.mid),
    ...shuffle([...new Set(TIERS.small)], rand).slice(0, quotas.small),
  ];
  picked = [...new Set(picked)];
  const pool = shuffle(
    [...new Set([...TIERS.mega, ...TIERS.large, ...TIERS.mid, ...TIERS.small])].filter((t) => !picked.includes(t)),
    rand,
  );
  while (picked.length < count && pool.length > 0) picked.push(pool.pop()!);
  return picked.slice(0, count);
}

function parseArgs(): { tickers: string[]; seed: number } {
  const args = process.argv.slice(2);
  let count = 5;
  let seed = 20260613;
  let tickers: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--count") {
      count = Math.max(1, parseInt(args[++i] ?? "5", 10));
    } else if (a === "--seed") {
      seed = parseInt(args[++i] ?? "20260613", 10);
    } else if (!a.startsWith("--")) {
      tickers.push(...a.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean));
    }
  }

  if (!tickers.length) tickers = pickTickers(count, seed);
  return { tickers, seed };
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
      { cwd: COMPILER_DIR, env: { ...process.env, PYTHONPATH: COMPILER_DIR }, timeout: COMPILER_TIMEOUT_MS },
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

async function compileTicker(ticker: string, packDir: string): Promise<TickerResult> {
  const t0 = Date.now();
  const inputDir = path.join(packDir, ticker, "in");
  const outputDir = path.join(packDir, ticker, "out");
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  let filingsSaved = 0;
  let filingsSkipped = 0;
  let filingsFailed = 0;

  try {
    const res = await getAllFilingsByTickerCached(ticker);
    if (!res) {
      return {
        ticker, ok: false, error: "ticker not in SEC cache",
        filingsSaved, filingsSkipped, filingsFailed, compileOk: false,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
      };
    }

    const filings = prepareBulkPresentedFilings(res.filings, { minFilingYear: FACE_BULK_MIN_FILING_YEAR });
    if (!filings.length) {
      return {
        ticker, ok: false, error: "no 10-K/10-Q since 2019",
        filingsSaved, filingsSkipped, filingsFailed, compileOk: false,
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
        await writeFileWithRetry(
          path.join(inputDir, wbFilename(ticker, filing)),
          Buffer.from(workbookToXlsxUint8Array(wb)),
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
        ticker, ok: false, error: `only ${filingsSaved} workbooks saved`,
        filingsSaved, filingsSkipped, filingsFailed, compileOk: false,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
      };
    }

    const compiled = await runCompiler(inputDir, outputDir);
    const src = path.join(outputDir, "consolidated_historical_financials.xlsx");
    await fs.access(src);
    const destName = `${ticker}_compiled_financials.xlsx`;
    const dest = path.join(packDir, destName);
    await fs.copyFile(src, dest);

    return {
      ticker,
      ok: compiled.ok === true,
      filingsSaved,
      filingsSkipped,
      filingsFailed,
      compileOk: compiled.ok === true,
      outputFile: destName,
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
      elapsedSec: Math.round((Date.now() - t0) / 1000),
    };
  }
}

async function main() {
  const { tickers, seed } = parseArgs();
  await fs.mkdir(PACK_DIR, { recursive: true });

  console.log(`Compile sample pack: ${tickers.join(", ")} (seed=${seed})`);
  console.log(`Output folder: ${PACK_DIR}\n`);

  const results: TickerResult[] = [];
  for (let i = 0; i < tickers.length; i += 1) {
    const ticker = tickers[i]!;
    console.log(`[${i + 1}/${tickers.length}] ${ticker} ...`);
    const r = await compileTicker(ticker, PACK_DIR);
    results.push(r);
    console.log(
      `  saved=${r.filingsSaved} skip=${r.filingsSkipped} fail=${r.filingsFailed} ` +
        `compileOk=${r.compileOk}${r.outputFile ? ` → ${r.outputFile}` : ""} (${r.elapsedSec}s)`,
    );
    if (r.error) console.log(`  error: ${r.error}`);
  }

  const zip = new JSZip();
  for (const r of results) {
    if (r.outputFile) {
      const buf = await fs.readFile(path.join(PACK_DIR, r.outputFile));
      zip.file(r.outputFile, buf);
    }
  }
  zip.file(
    "README.txt",
    [
      "Century Egg Credit — compiled financial statements sample pack",
      `Generated: ${new Date().toISOString()}`,
      `Tickers: ${tickers.join(", ")}`,
      "",
      "Each workbook is consolidated IS/BS/CF from SEC as-presented face extracts.",
      "",
      ...results.map(
        (r) =>
          `${r.ticker}: compileOk=${r.compileOk} saved=${r.filingsSaved} ` +
          `${r.outputFile ?? "(no output)"}${r.error ? ` ERROR: ${r.error}` : ""}`,
      ),
    ].join("\n"),
  );

  const zipPath = path.join(PACK_DIR, "compiled-financials-sample.zip");
  await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  const manifest = { seed, tickers, results, zipFile: "compiled-financials-sample.zip", generatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(PACK_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  const okCount = results.filter((r) => r.compileOk).length;
  console.log(`\nDone: ${okCount}/${results.length} compiled successfully`);
  console.log(`ZIP: ${zipPath}`);
  console.log(`Individual files in: ${PACK_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
