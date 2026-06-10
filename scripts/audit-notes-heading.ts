/**
 * Audit how consistently we find notes umbrella / Note 1 / face-table ceiling.
 * Usage: npx tsx scripts/audit-notes-heading.ts JNJ,WFC,JPM
 *        npx tsx scripts/audit-notes-heading.ts --last6 JNJ,WFC,JPM,HON,MCD,ABBV,AAPL,MANH,HUBB
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { buildParsedFilingHtmlContext, fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
import {
  findFilteredNotesToFinancialStatementsStart,
  findFirstNumberedNoteOneStart,
  findPrimaryFaceTablesEndBeforeNotes,
} from "@/lib/sec-statement-locator/signals";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

const args = process.argv.slice(2);
const last6 = args[0] === "--last6";
const tickerArg = (last6 ? args[1] : args[0]) ?? "JNJ,WFC,JPM,HON,MCD,ABBV,AAPL";
const TICKERS = tickerArg.split(",").map((t) => t.trim().toUpperCase());
const PER_TICKER = last6 ? 6 : 1;

type Row = {
  ticker: string;
  period: string;
  umbrella: number | null;
  note1: number | null;
  faceEnd: number;
  locator: string;
  tablesBeforeNotes: number;
};

async function auditFiling(ticker: string, f: {
  accessionNumber: string;
  form: string;
  primaryDocument: string;
  docUrl: string;
  reportDate?: string | null;
  filingDate: string;
}, cik: string): Promise<Row | null> {
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "");
  if (!ctx) return null;
  const period = (f.reportDate ?? f.filingDate).slice(0, 10);
  const umbrella = findFilteredNotesToFinancialStatementsStart(ctx.acc, 1_800);
  const note1 = findFirstNumberedNoteOneStart(ctx.acc, umbrella ?? 1_800);
  const faceEnd = findPrimaryFaceTablesEndBeforeNotes(ctx.acc, 0, ctx.acc.length);
  const locator = locateFinancialStatementsSection(ctx, "10-Q");
  const tablesBeforeNotes = ctx.tables.filter((t) => t.offset < faceEnd).length;
  return {
    ticker,
    period,
    umbrella,
    note1,
    faceEnd,
    locator: locator?.strategy ?? "null",
    tablesBeforeNotes,
  };
}

function summarize(rows: Row[]) {
  const n = rows.length;
  const umbrellaHits = rows.filter((r) => r.umbrella != null).length;
  const note1Hits = rows.filter((r) => r.note1 != null).length;
  const eitherHits = rows.filter((r) => r.umbrella != null || r.note1 != null).length;
  const locatorHits = rows.filter((r) => r.locator !== "null").length;
  const notesPreceding = rows.filter((r) => r.locator === "10q-notes-preceding-face").length;
  const avgTables = rows.reduce((s, r) => s + r.tablesBeforeNotes, 0) / Math.max(1, n);
  return { n, umbrellaHits, note1Hits, eitherHits, locatorHits, notesPreceding, avgTables };
}

async function main() {
  const allRows: Row[] = [];
  for (const ticker of TICKERS) {
    const res = await getAllFilingsByTickerCached(ticker);
    if (!res) {
      console.log(ticker, "no submissions");
      continue;
    }
    const filings = res.filings
      .filter((x) => x.form === "10-Q")
      .sort((a, b) => (b.reportDate ?? b.filingDate).localeCompare(a.reportDate ?? a.filingDate))
      .slice(0, PER_TICKER);
    if (filings.length === 0) {
      console.log(ticker, "no 10-Q");
      continue;
    }
    const rows: Row[] = [];
    for (const f of filings) {
      const row = await auditFiling(ticker, f, res.cik);
      if (row) rows.push(row);
    }
    allRows.push(...rows);
    const s = summarize(rows);
    console.log(
      `\n${ticker} (${rows.length} filings):`,
      `umbrella ${s.umbrellaHits}/${s.n}`,
      `note1 ${s.note1Hits}/${s.n}`,
      `either ${s.eitherHits}/${s.n}`,
      `locator ${s.locatorHits}/${s.n}`,
      `notes-preceding ${s.notesPreceding}/${s.n}`,
      `avgTablesBeforeNotes ${s.avgTables.toFixed(0)}`
    );
    for (const r of rows) {
      console.log(
        `  ${r.period} umbrella@${r.umbrella ?? "—"} note1@${r.note1 ?? "—"} faceEnd@${r.faceEnd} locator=${r.locator} tables=${r.tablesBeforeNotes}`
      );
    }
  }
  const total = summarize(allRows);
  console.log(
    `\n=== TOTAL (${total.n} filings) ===`,
    `umbrella ${total.umbrellaHits}/${total.n} (${pct(total.umbrellaHits, total.n)})`,
    `note1 ${total.note1Hits}/${total.n} (${pct(total.note1Hits, total.n)})`,
    `either ${total.eitherHits}/${total.n} (${pct(total.eitherHits, total.n)})`,
    `locator ${total.locatorHits}/${total.n} (${pct(total.locatorHits, total.n)})`,
    `notes-preceding ${total.notesPreceding}/${total.n}`
  );
}

function pct(n: number, d: number) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "—";
}

main().catch(console.error);
