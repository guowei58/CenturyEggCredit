/**
 * Batch-probe 10-Q HTML face parsing for tickers since 2019.
 * Usage: npx tsx scripts/probe-10q-since2019.ts [TICKERS] [SINCE_YEAR]
 */
import { writeFileSync } from "fs";
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
} from "@/lib/sec-filing-financials";
import {
  locateFinancialStatementsSection,
  locatePrimaryStatementPacket,
} from "@/lib/sec-statement-locator";

const DEFAULT_TICKERS = ["AAPL", "BHC", "BLCO", "NXST", "OPTU", "CABO"];
const SINCE = `${process.argv[3] ?? "2019"}-01-01`;
/** Optional cap on filings per ticker (most recent N). Omit for full history. */
const MAX_PER_TICKER = process.argv[4] ? Math.max(1, parseInt(process.argv[4], 10)) : undefined;

type Row = {
  ticker: string;
  filingDate: string;
  reportDate: string | null;
  accession: string;
  ok: boolean;
  stmts: string[];
  missing: string[];
  section: string | null;
  packet: boolean;
  alternates: number;
  blocksBuilt: number;
  blocksScored: number;
  rows: Record<string, number>;
  error?: string;
};

const EXPECTED = ["income-statement", "balance-sheet", "cash-flow"] as const;

function onOrAfterSince(filingDate: string, reportDate?: string): boolean {
  const d = (reportDate?.trim() || filingDate?.trim() || "").slice(0, 10);
  return d >= SINCE;
}

async function probeFiling(
  ticker: string,
  cik: string,
  f: {
    form: string;
    filingDate: string;
    reportDate?: string;
    accessionNumber: string;
    primaryDocument: string;
    docUrl?: string | null;
  }
): Promise<Row> {
  const base: Row = {
    ticker,
    filingDate: f.filingDate,
    reportDate: f.reportDate?.trim() || null,
    accession: f.accessionNumber,
    ok: false,
    stmts: [],
    missing: [...EXPECTED],
    section: null,
    packet: false,
    alternates: 0,
    blocksBuilt: 0,
    blocksScored: 0,
    rows: {},
  };

  try {
    const bundle = await fetchHtmlFilingStatementsBundle({
      cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    const html = bundle.primaryHtml ?? "";
    const ctx = buildParsedFilingHtmlContext(html);
    if (!ctx) {
      return { ...base, error: "no_html_context" };
    }

    const section = locateFinancialStatementsSection(ctx, "10-Q");
    const located = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
    const stmts = bundle.statements;

    const ids = stmts.map((s) => s.id);
    const missing = EXPECTED.filter((id) => !ids.includes(id));
    const rows: Record<string, number> = {};
    for (const s of stmts) rows[s.id] = s.rows?.length ?? 0;

    return {
      ...base,
      ok: missing.length === 0,
      stmts: ids,
      missing,
      section: section?.strategy ?? null,
      packet: located.packet != null,
      alternates: located.packetAlternates.length,
      blocksBuilt: located.audit.blocksBuilt,
      blocksScored: located.audit.blocksScored,
      rows,
    };
  } catch (e) {
    return { ...base, error: (e as Error).message?.slice(0, 200) };
  }
}

function summarize(rows: Row[]) {
  const byTicker = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byTicker.get(r.ticker) ?? [];
    list.push(r);
    byTicker.set(r.ticker, list);
  }

  console.log("\n========== 10-Q SUMMARY (since " + SINCE + ") ==========\n");
  for (const ticker of [...byTicker.keys()].sort()) {
    const list = byTicker.get(ticker)!;
    const ok = list.filter((r) => r.ok).length;
    const fail = list.filter((r) => !r.ok && !r.error);
    const err = list.filter((r) => r.error);
    const locatorHit = list.filter((r) => r.packet).length;
    const sectionHit = list.filter((r) => r.section).length;
    console.log(
      `${ticker}: ${ok}/${list.length} ok | ${fail.length} parse-fail | ${err.length} errors | locator-packet ${locatorHit}/${list.length} | section ${sectionHit}/${list.length}`
    );
    const fails = list.filter((r) => !r.ok);
    if (fails.length > 0) {
      for (const f of fails) {
        const period = f.reportDate ?? f.filingDate;
        console.log(
          `  FAIL ${period} filed ${f.filingDate} ${f.accession} missing=[${f.missing.join(",")}] section=${f.section ?? "null"} packet=${f.packet} err=${f.error ?? ""}`
        );
      }
    }
  }

  const total = rows.length;
  const okTotal = rows.filter((r) => r.ok).length;
  console.log(`\nTOTAL: ${okTotal}/${total} (${((okTotal / total) * 100).toFixed(1)}%) all-three-statements`);
  console.log(`Locator packet: ${rows.filter((r) => r.packet).length}/${total}`);
  console.log(`Section found: ${rows.filter((r) => r.section).length}/${total}`);

  const missIs = rows.filter((r) => r.missing.includes("income-statement")).length;
  const missBs = rows.filter((r) => r.missing.includes("balance-sheet")).length;
  const missCf = rows.filter((r) => r.missing.includes("cash-flow")).length;
  console.log(`Missing IS: ${missIs} | BS: ${missBs} | CF: ${missCf}`);
}

async function main() {
  const tickers = (process.argv[2] ?? DEFAULT_TICKERS.join(","))
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const allRows: Row[] = [];

  for (const ticker of tickers) {
    const res = await getAllFilingsByTickerCached(ticker);
    if (!res) {
      console.log(JSON.stringify({ ticker, error: "no_submissions" }));
      continue;
    }

    let filings = res.filings
      .filter((f) => f.form === "10-Q" && onOrAfterSince(f.filingDate, f.reportDate))
      .sort((a, b) => (a.reportDate || a.filingDate).localeCompare(b.reportDate || b.filingDate));
    if (MAX_PER_TICKER != null && filings.length > MAX_PER_TICKER) {
      filings = filings.slice(-MAX_PER_TICKER);
    }

    const capNote = MAX_PER_TICKER != null ? ` (last ${filings.length} of max ${MAX_PER_TICKER})` : "";
    console.log(`\n--- ${ticker}: ${filings.length} 10-Q filings since ${SINCE}${capNote} ---`);

    for (let i = 0; i < filings.length; i += 1) {
      const f = filings[i]!;
      const row = await probeFiling(ticker, res.cik, f);
      allRows.push(row);
      const period = row.reportDate ?? row.filingDate;
      console.log(
        `${row.ok ? "OK" : row.error ? "ERR" : "FAIL"} ${ticker} ${period} (${i + 1}/${filings.length}) stmts=[${row.stmts.join(",")}] sec=${row.section ?? "null"} pkt=${row.packet}`
      );
    }
  }

  const outPath = `scripts/probe-10q-since2019-results-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify({ since: SINCE, tickers, rows: allRows }, null, 2));
  console.log(`\nWrote ${outPath}`);
  summarize(allRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
