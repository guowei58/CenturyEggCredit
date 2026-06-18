/**
 * Benchmark Adjusted EBITDA + Revenue Drivers extraction across random tickers since 2019.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/benchmark-ebitda-revenue-drivers.ts [TICKER_COUNT] [SEED] [SINCE_YEAR]
 *
 * Env:
 *   BENCHMARK_PACE_MS — delay between filings (default 120)
 *   BENCHMARK_RESUME=1 — skip filings already in results.json
 *   BENCHMARK_MAX_FILINGS — cap filings per ticker (optional debug)
 *   BENCHMARK_8K_MAX — max nearby 8-K attempts for EBITDA fallback (default 4)
 *   BENCHMARK_FILING_TIMEOUT_MS — per-filing timeout (default 90000)
 *
 * Output:
 *   scripts/.benchmark-ebitda-revenue/results.json
 *   scripts/.benchmark-ebitda-revenue/summary.txt
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { resolveAdjustedEbitdaDisplay } from "@/lib/adjusted-ebitda-display";
import {
  fetchEdgarPrimaryDocumentHtml,
  getAllFilingsByTicker,
  rankEarningsAdjacent8KFilings,
  secArchivesPrimaryDocumentUrl,
  type SecFiling,
} from "@/lib/sec-edgar";
import {
  fetchAccessionSubmissionTxt,
  fetchArchivesFilingFileHtml,
  fetchFilingIndexItems,
  parseExhibit99HtmlFilenamesFromSubmissionTxt,
  rankExhibit99HtmlFilenames,
} from "@/lib/sec/filingIndex";
import {
  extractEbitdaReconciliationFromIxbrlHtml,
  fetchIxbrlMdnaTablesFromFiling,
  type IxbrlEbitdaReconciliation,
  type IxbrlEbitdaTable,
  type IxbrlRevenueDrivers,
  type IxbrlRevenueDriversTable,
} from "@/lib/sec-ixbrl-mdna-tables";

const OUT_DIR = path.join(process.cwd(), "scripts", ".benchmark-ebitda-revenue");
const RESULTS_PATH = path.join(OUT_DIR, "results.json");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.txt");

const TICKER_COUNT = Math.max(1, parseInt(process.argv[2] ?? "100", 10));
const SEED = parseInt(process.argv[3] ?? "20260615", 10);
const SINCE_YEAR = parseInt(process.argv[4] ?? "2019", 10);
const PACE_MS = Math.max(0, parseInt(process.env.BENCHMARK_PACE_MS ?? "120", 10));
const RESUME = process.env.BENCHMARK_RESUME === "1";
const MAX_FILINGS_PER_TICKER = process.env.BENCHMARK_MAX_FILINGS
  ? Math.max(1, parseInt(process.env.BENCHMARK_MAX_FILINGS, 10))
  : undefined;
const NEARBY_8K_MAX = Math.max(0, parseInt(process.env.BENCHMARK_8K_MAX ?? "4", 10));
const FILING_TIMEOUT_MS = Math.max(5000, parseInt(process.env.BENCHMARK_FILING_TIMEOUT_MS ?? "90000", 10));
const NEARBY_8K_PACE_MS = 140;

type TableIxStats = {
  tableCount: number;
  tablesWithIx: number;
  tablesWithoutIx: number;
  totalIxFacts: number;
};

type FilingRow = {
  ticker: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  loadOk: boolean;
  loadError?: string;
  ebitdaStatus: "tables" | "mention_only" | "none";
  ebitdaSource: "mdna" | "press_release" | null;
  ebitda: TableIxStats;
  revenueStatus: "tables" | "mention_only" | "none";
  revenue: TableIxStats;
  revenueSectionFound: boolean;
  mdnaHeadingFound: boolean;
  ebitda8kAttempts: number;
  elapsedMs: number;
};

type ResultsFile = {
  meta: {
    tickerCount: number;
    seed: number;
    sinceYear: number;
    startedAt: string;
    updatedAt: string;
  };
  rows: FilingRow[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
    }),
  ]);
}

function pickTickers(count: number, seed: number): string[] {
  const out = execSync(`npx tsx scripts/pick-random-probe-tickers.ts ${count} ${seed}`, {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  return out
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

function tableIxStats(tables: readonly { factCount?: number }[]): TableIxStats {
  let tablesWithIx = 0;
  let totalIxFacts = 0;
  for (const t of tables) {
    const fc = t.factCount ?? 0;
    totalIxFacts += fc;
    if (fc > 0) tablesWithIx += 1;
  }
  const tableCount = tables.length;
  return {
    tableCount,
    tablesWithIx,
    tablesWithoutIx: tableCount - tablesWithIx,
    totalIxFacts,
  };
}

function filingOnOrAfterSince(f: { filingDate?: string; reportDate?: string }, sinceYear: number): boolean {
  const fdY = parseInt((f.filingDate ?? "").slice(0, 4), 10);
  const rdY = parseInt((f.reportDate ?? "").slice(0, 4), 10);
  if (Number.isFinite(rdY) && rdY >= sinceYear) return true;
  if (Number.isFinite(fdY) && fdY >= sinceYear) return true;
  return false;
}

function loadResults(): ResultsFile {
  if (RESUME && existsSync(RESULTS_PATH)) {
    try {
      return JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as ResultsFile;
    } catch {
      /* fresh run */
    }
  }
  return {
    meta: {
      tickerCount: TICKER_COUNT,
      seed: SEED,
      sinceYear: SINCE_YEAR,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    rows: [],
  };
}

function saveResults(file: ResultsFile): void {
  mkdirSync(OUT_DIR, { recursive: true });
  file.meta.updatedAt = new Date().toISOString();
  writeFileSync(RESULTS_PATH, JSON.stringify(file, null, 2));
}

function pct(n: number, d: number): string {
  if (d <= 0) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function summarize(rows: FilingRow[]): string {
  const loaded = rows.filter((r) => r.loadOk);
  const errors = rows.filter((r) => !r.loadOk);
  const lines: string[] = [];

  lines.push("Adjusted EBITDA + Revenue Drivers benchmark");
  lines.push(`Filings checked: ${rows.length} (${loaded.length} loaded, ${errors.length} errors)`);
  lines.push(`Since year: ${SINCE_YEAR}`);
  lines.push("");

  const ebitdaFound = loaded.filter((r) => r.ebitdaStatus === "tables");
  const ebitdaMention = loaded.filter((r) => r.ebitdaStatus === "mention_only");
  const ebitdaNone = loaded.filter((r) => r.ebitdaStatus === "none");

  lines.push("=== Adjusted EBITDA (filing-level) ===");
  lines.push(`Tables found:     ${ebitdaFound.length}/${loaded.length} (${pct(ebitdaFound.length, loaded.length)})`);
  lines.push(`Mention only:     ${ebitdaMention.length}/${loaded.length} (${pct(ebitdaMention.length, loaded.length)})`);
  lines.push(`Not found:        ${ebitdaNone.length}/${loaded.length} (${pct(ebitdaNone.length, loaded.length)})`);
  lines.push(
    `Source MD&A:      ${ebitdaFound.filter((r) => r.ebitdaSource === "mdna").length}/${ebitdaFound.length} of found`
  );
  lines.push(
    `Source press 8-K: ${ebitdaFound.filter((r) => r.ebitdaSource === "press_release").length}/${ebitdaFound.length} of found`
  );

  const ebitdaTableTotal = ebitdaFound.reduce((s, r) => s + r.ebitda.tableCount, 0);
  const ebitdaIx = ebitdaFound.reduce((s, r) => s + r.ebitda.tablesWithIx, 0);
  lines.push("");
  lines.push("=== Adjusted EBITDA (table-level IX tagging) ===");
  lines.push(`Tables returned:  ${ebitdaTableTotal}`);
  lines.push(`With inline XBRL: ${ebitdaIx}/${ebitdaTableTotal} (${pct(ebitdaIx, ebitdaTableTotal)})`);
  lines.push(`Without IX tags:  ${ebitdaTableTotal - ebitdaIx}/${ebitdaTableTotal}`);

  const revenueFound = loaded.filter((r) => r.revenueStatus === "tables");
  const revenueMention = loaded.filter((r) => r.revenueStatus === "mention_only");
  const revenueNone = loaded.filter((r) => r.revenueStatus === "none");

  lines.push("");
  lines.push("=== Revenue Drivers (filing-level) ===");
  lines.push(`Tables found:     ${revenueFound.length}/${loaded.length} (${pct(revenueFound.length, loaded.length)})`);
  lines.push(`Mention only:     ${revenueMention.length}/${loaded.length} (${pct(revenueMention.length, loaded.length)})`);
  lines.push(`Not found:        ${revenueNone.length}/${loaded.length} (${pct(revenueNone.length, loaded.length)})`);
  lines.push(
    `Revenue section:  ${loaded.filter((r) => r.revenueSectionFound).length}/${loaded.length} (${pct(loaded.filter((r) => r.revenueSectionFound).length, loaded.length)})`
  );

  const revenueTableTotal = revenueFound.reduce((s, r) => s + r.revenue.tableCount, 0);
  const revenueIx = revenueFound.reduce((s, r) => s + r.revenue.tablesWithIx, 0);
  lines.push("");
  lines.push("=== Revenue Drivers (table-level IX tagging) ===");
  lines.push(`Tables returned:  ${revenueTableTotal}`);
  lines.push(`With inline XBRL: ${revenueIx}/${revenueTableTotal} (${pct(revenueIx, revenueTableTotal)})`);
  lines.push(`Without IX tags:  ${revenueTableTotal - revenueIx}/${revenueTableTotal}`);

  lines.push("");
  lines.push("=== By form ===");
  for (const form of ["10-Q", "10-K"] as const) {
    const subset = loaded.filter((r) => r.form === form);
    if (subset.length === 0) continue;
    lines.push(
      `${form}: EBITDA found ${pct(subset.filter((r) => r.ebitdaStatus === "tables").length, subset.length)} | Revenue found ${pct(subset.filter((r) => r.revenueStatus === "tables").length, subset.length)} | n=${subset.length}`
    );
  }

  lines.push("");
  lines.push("=== Tickers (lowest EBITDA hit) ===");
  const byTicker = new Map<string, FilingRow[]>();
  for (const r of loaded) {
    const list = byTicker.get(r.ticker) ?? [];
    list.push(r);
    byTicker.set(r.ticker, list);
  }
  const tickerRates = [...byTicker.entries()]
    .map(([ticker, list]) => ({
      ticker,
      n: list.length,
      ebitdaHits: list.filter((r) => r.ebitdaStatus === "tables").length,
      revenueHits: list.filter((r) => r.revenueStatus === "tables").length,
    }))
    .sort((a, b) => a.ebitdaHits / a.n - b.ebitdaHits / b.n);

  for (const t of tickerRates.slice(0, 12)) {
    lines.push(
      `  ${t.ticker}: EBITDA ${pct(t.ebitdaHits, t.n)} | Revenue ${pct(t.revenueHits, t.n)} | n=${t.n}`
    );
  }

  return lines.join("\n");
}

async function rankedExhibit99For8K(
  issuerCik: string,
  k8: { accessionNumber: string; primaryDocument?: string | null }
): Promise<string[]> {
  const prim = (k8.primaryDocument ?? "").trim();
  const [indexItems, submissionTxt] = await Promise.all([
    fetchFilingIndexItems(issuerCik, k8.accessionNumber),
    fetchAccessionSubmissionTxt(issuerCik, k8.accessionNumber),
  ]);
  const fromTxt = submissionTxt ? parseExhibit99HtmlFilenamesFromSubmissionTxt(submissionTxt) : [];
  return rankExhibit99HtmlFilenames(indexItems.map((it) => it.name), {
    primaryDocumentForOrdering: prim || undefined,
    submissionTxtExhibit99Ordered: fromTxt.length > 0 ? fromTxt : undefined,
  }).slice(0, 3);
}

async function tryEbitdaFromNearby8K(
  issuerCik: string,
  allFilings: SecFiling[],
  chosen: SecFiling
): Promise<{ ebitda: IxbrlEbitdaReconciliation; attempts: number }> {
  const periodicForm = (chosen.form ?? "").trim().toUpperCase();
  const reportDate = (chosen.reportDate ?? "").trim();
  const usePeriodEnd =
    (periodicForm === "10-Q" || periodicForm === "10-K") && /^\d{4}-\d{2}-\d{2}$/.test(reportDate.slice(0, 10));
  const anchorDate = usePeriodEnd ? reportDate : chosen.filingDate;
  const ranked = rankEarningsAdjacent8KFilings(allFilings, anchorDate, { anchorIsPeriodEnd: usePeriodEnd });
  const toTry = ranked.slice(0, NEARBY_8K_MAX);
  let attempts = 0;
  const issuerCikNum = parseInt(issuerCik.replace(/\D/g, ""), 10);

  outer: for (const k8 of toTry) {
    attempts += 1;
    const htmlPrimary = await fetchEdgarPrimaryDocumentHtml(issuerCik, k8);
    if (htmlPrimary) {
      const alt = extractEbitdaReconciliationFromIxbrlHtml(htmlPrimary, "8-K", {
        includeUncertainBoundaries: false,
      });
      const url = secArchivesPrimaryDocumentUrl(issuerCik, k8);
      if (alt.status === "tables" && alt.tables.length > 0 && url) {
        return {
          ebitda: {
            ...alt,
            supplementalSource: {
              form: k8.form,
              filingDate: k8.filingDate,
              accessionNumber: k8.accessionNumber,
              primaryDocument: k8.primaryDocument ?? "",
              primaryDocumentUrl: url,
              documentRole: "primary",
            },
            nearby8KScan: { candidatesTried: toTry.length },
          },
          attempts,
        };
      }
    }

    if (NEARBY_8K_PACE_MS > 0) await sleep(NEARBY_8K_PACE_MS);

    const exhibitNames = await rankedExhibit99For8K(issuerCik, k8);
    for (const exhibitFile of exhibitNames) {
      const htmlEx = await fetchArchivesFilingFileHtml(issuerCik, k8.accessionNumber, exhibitFile);
      if (htmlEx) {
        const altEx = extractEbitdaReconciliationFromIxbrlHtml(htmlEx, "8-K", {
          includeUncertainBoundaries: false,
        });
        if (altEx.status === "tables" && altEx.tables.length > 0 && Number.isFinite(issuerCikNum) && issuerCikNum > 0) {
          return {
            ebitda: {
              ...altEx,
              supplementalSource: {
                form: k8.form,
                filingDate: k8.filingDate,
                accessionNumber: k8.accessionNumber,
                primaryDocument: exhibitFile,
                primaryDocumentUrl: `https://www.sec.gov/Archives/edgar/data/${issuerCikNum}/${k8.accessionNumber.replace(/-/g, "")}/${encodeURIComponent(exhibitFile)}`,
                documentRole: "exhibit_99",
              },
              nearby8KScan: { candidatesTried: toTry.length },
            },
            attempts,
          };
        }
      }
      if (NEARBY_8K_PACE_MS > 0) await sleep(NEARBY_8K_PACE_MS);
    }
  }

  return {
    ebitda: { status: "none", tables: [], nearby8KScan: { candidatesTried: toTry.length } },
    attempts,
  };
}

async function probeFiling(
  ticker: string,
  cik: string,
  allFilings: SecFiling[],
  chosen: SecFiling
): Promise<FilingRow> {
  const t0 = Date.now();
  const base: FilingRow = {
    ticker,
    form: chosen.form,
    filingDate: chosen.filingDate,
    reportDate: chosen.reportDate?.trim() || null,
    accessionNumber: chosen.accessionNumber,
    loadOk: false,
    ebitdaStatus: "none",
    ebitdaSource: null,
    ebitda: { tableCount: 0, tablesWithIx: 0, tablesWithoutIx: 0, totalIxFacts: 0 },
    revenueStatus: "none",
    revenue: { tableCount: 0, tablesWithIx: 0, tablesWithoutIx: 0, totalIxFacts: 0 },
    revenueSectionFound: false,
    mdnaHeadingFound: false,
    ebitda8kAttempts: 0,
    elapsedMs: 0,
  };

  const primaryDocument = (chosen.primaryDocument ?? "").trim();
  if (!primaryDocument) {
    return { ...base, loadError: "Missing primary document", elapsedMs: Date.now() - t0 };
  }

  const extracted = await fetchIxbrlMdnaTablesFromFiling({
    cik,
    accessionNumber: chosen.accessionNumber,
    primaryDocument,
    form: chosen.form,
  });

  if (!extracted.ok) {
    return { ...base, loadError: extracted.error, elapsedMs: Date.now() - t0 };
  }

  let ebitdaReconciliation = extracted.ebitdaReconciliation;
  const mdnaEbitdaTables = ebitdaReconciliation.tables.filter((t) => t.inMdna);
  if (mdnaEbitdaTables.length > 0) {
    ebitdaReconciliation = { status: "tables", tables: mdnaEbitdaTables };
  } else if (ebitdaReconciliation.status === "tables") {
    ebitdaReconciliation = { status: "none", tables: [] };
  }

  let ebitda8kAttempts = 0;
  if (ebitdaReconciliation.status !== "tables" && NEARBY_8K_MAX > 0) {
    const from8k = await tryEbitdaFromNearby8K(cik, allFilings, chosen);
    ebitda8kAttempts = from8k.attempts;
    if (from8k.ebitda.status === "tables") {
      ebitdaReconciliation = from8k.ebitda;
    } else if (from8k.ebitda.nearby8KScan) {
      ebitdaReconciliation = { ...ebitdaReconciliation, nearby8KScan: from8k.ebitda.nearby8KScan };
    }
  }

  const revenueRaw = extracted.revenueDrivers as IxbrlRevenueDrivers;
  const ebitdaDisplay = resolveAdjustedEbitdaDisplay(ebitdaReconciliation);
  const ebitdaTables: IxbrlEbitdaTable[] = ebitdaDisplay.tables;
  const revenueTables: IxbrlRevenueDriversTable[] = revenueRaw.tables ?? [];

  return {
    ...base,
    loadOk: true,
    ebitdaStatus: ebitdaDisplay.status,
    ebitdaSource: ebitdaDisplay.source,
    ebitda: tableIxStats(ebitdaTables),
    revenueStatus: revenueRaw.status ?? "none",
    revenue: tableIxStats(revenueTables),
    revenueSectionFound: revenueRaw.revenueSectionFound === true,
    mdnaHeadingFound: extracted.mdnaHeadingFound,
    ebitda8kAttempts,
    elapsedMs: Date.now() - t0,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const tickers = pickTickers(TICKER_COUNT, SEED);
  const results = loadResults();
  const doneKeys = new Set(results.rows.map((r) => `${r.ticker}|${r.accessionNumber}`));

  process.stderr.write(
    `Benchmark: ${tickers.length} tickers since ${SINCE_YEAR} (seed=${SEED}) pace=${PACE_MS}ms 8kMax=${NEARBY_8K_MAX} resume=${RESUME}\n`
  );

  for (let ti = 0; ti < tickers.length; ti++) {
    const ticker = tickers[ti]!;
    process.stderr.write(`\n[${ti + 1}/${tickers.length}] ${ticker}\n`);

    const res = await getAllFilingsByTicker(ticker, { mergePredecessorIssuers: true });
    if (!res) {
      process.stderr.write(`  skip: ticker not found\n`);
      continue;
    }

    let periodicFilings = res.filings.filter((f) => {
      const form = (f.form ?? "").trim().toUpperCase();
      return form === "10-K" || form === "10-Q";
    });
    periodicFilings = periodicFilings.filter((f) => filingOnOrAfterSince(f, SINCE_YEAR));
    if (MAX_FILINGS_PER_TICKER != null) periodicFilings = periodicFilings.slice(0, MAX_FILINGS_PER_TICKER);

    process.stderr.write(`  ${periodicFilings.length} filings since ${SINCE_YEAR}\n`);

    for (let fi = 0; fi < periodicFilings.length; fi++) {
      const f = periodicFilings[fi]!;
      const key = `${ticker}|${f.accessionNumber}`;
      if (RESUME && doneKeys.has(key)) continue;

      process.stderr.write(`  [${fi + 1}/${periodicFilings.length}] ${f.form} ${f.filingDate} … `);
      try {
        const row = await withTimeout(
          probeFiling(ticker, res.cik, res.filings, f),
          FILING_TIMEOUT_MS,
          `${ticker} ${f.accessionNumber}`
        );
        results.rows.push(row);
        doneKeys.add(key);
        saveResults(results);
        process.stderr.write(
          `${row.loadOk ? "ok" : "err"} EBITDA=${row.ebitdaStatus}${row.ebitdaSource ? `(${row.ebitdaSource})` : ""} Rev=${row.revenueStatus} ix E=${row.ebitda.tablesWithIx}/${row.ebitda.tableCount} R=${row.revenue.tablesWithIx}/${row.revenue.tableCount} ${row.elapsedMs}ms\n`
        );
      } catch (e) {
        const row: FilingRow = {
          ticker,
          form: f.form,
          filingDate: f.filingDate,
          reportDate: f.reportDate?.trim() || null,
          accessionNumber: f.accessionNumber,
          loadOk: false,
          loadError: e instanceof Error ? e.message : String(e),
          ebitdaStatus: "none",
          ebitdaSource: null,
          ebitda: { tableCount: 0, tablesWithIx: 0, tablesWithoutIx: 0, totalIxFacts: 0 },
          revenueStatus: "none",
          revenue: { tableCount: 0, tablesWithIx: 0, tablesWithoutIx: 0, totalIxFacts: 0 },
          revenueSectionFound: false,
          mdnaHeadingFound: false,
          ebitda8kAttempts: 0,
          elapsedMs: 0,
        };
        results.rows.push(row);
        doneKeys.add(key);
        saveResults(results);
        process.stderr.write(`throw ${row.loadError}\n`);
      }

      if (PACE_MS > 0) await sleep(PACE_MS);
    }

    const summary = summarize(results.rows);
    writeFileSync(SUMMARY_PATH, summary);
  }

  const summary = summarize(results.rows);
  writeFileSync(SUMMARY_PATH, summary);
  console.log(summary);
  process.stderr.write(`\nWrote ${RESULTS_PATH}\nWrote ${SUMMARY_PATH}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
