/**
 * Debt footnote spot check harness.
 * Run: npx vitest run src/lib/debt-footnote-spot-check.test.ts
 */
import { describe, expect, it } from "vitest";
import { extractDebtFootnoteForFiling } from "@/lib/debt-footnote-extract-filing";
import {
  debtFootnoteHasDisplayHtml,
  pickBestUnverifiedDebtCandidate,
} from "@/lib/debt-footnote-display";
import { getAllFilingsByTicker, type SecFiling } from "@/lib/sec-edgar";

/** 20 randomly chosen issuers — 2020–present window (not used in prior batches). */
const TICKERS_2020_PRESENT = [
  "DKNG",
  "DASH",
  "SNOW",
  "CRWD",
  "ZS",
  "OKTA",
  "TWLO",
  "PYPL",
  "VRTX",
  "DDOG",
  "NET",
  "MRNA",
  "RBLX",
  "HUBS",
  "DOCU",
  "PINS",
  "SNAP",
  "ABNB",
  "CPRT",
  "ODFL",
] as const;

const MIN_FILING_YEAR = 2020;

function pickLatestFormFromYear(
  filings: SecFiling[],
  form: "10-K" | "10-Q",
  minYear: number
): SecFiling | null {
  const minDate = `${minYear}-01-01`;
  for (const f of filings) {
    if (f.form !== form) continue;
    if ((f.filingDate ?? "").slice(0, 10) >= minDate) return f;
  }
  return null;
}

export type DebtSpotRow = {
  ticker: string;
  form: "10-K" | "10-Q";
  minFilingYear: number;
  accessionNumber: string;
  filingDate: string;
  confidence: string;
  debtNoteTitle: string | null;
  hasDisplayHtml: boolean;
  htmlChars: number;
  rolledForward: boolean;
  unverifiedFallback: boolean;
  note: string;
  warnings: string[];
  extractionMethod: string;
};

export async function runDebtFootnoteSpotCheckFromYear(
  tickers: readonly string[],
  minYear: number
): Promise<DebtSpotRow[]> {
  const rows: DebtSpotRow[] = [];

  for (const ticker of tickers) {
    const bundle = await getAllFilingsByTicker(ticker);
    if (!bundle) {
      for (const form of ["10-K", "10-Q"] as const) {
        rows.push({
          ticker,
          form,
          minFilingYear: minYear,
          accessionNumber: "",
          filingDate: "",
          confidence: "Not Found",
          debtNoteTitle: null,
          hasDisplayHtml: false,
          htmlChars: 0,
          rolledForward: false,
          unverifiedFallback: false,
          note: "SEC submissions not found",
          warnings: [],
          extractionMethod: "",
        });
      }
      continue;
    }

    const allFilings = bundle.filings.filter((f) => f.form === "10-K" || f.form === "10-Q");

    for (const form of ["10-K", "10-Q"] as const) {
      const chosen = pickLatestFormFromYear(allFilings, form, minYear);
      if (!chosen) {
        rows.push({
          ticker,
          form,
          minFilingYear: minYear,
          accessionNumber: "",
          filingDate: "",
          confidence: "Not Found",
          debtNoteTitle: null,
          hasDisplayHtml: false,
          htmlChars: 0,
          rolledForward: false,
          unverifiedFallback: false,
          note: `No ${form} filed since ${minYear}`,
          warnings: [],
          extractionMethod: "",
        });
        continue;
      }

      const { filing, rollForward } = await extractDebtFootnoteForFiling({
        cik: bundle.cik,
        ticker,
        filing: chosen,
        allFilings,
        allow10KRollForward: form === "10-Q",
      });

      const ex = filing.extract;
      const displayHtml = (ex.extractedFootnoteHtml ?? "").trim() || ex.tablesHtml.trim();
      const hasHtml = debtFootnoteHasDisplayHtml(ex);
      const unverified = !hasHtml && Boolean(pickBestUnverifiedDebtCandidate(ex));

      rows.push({
        ticker,
        form,
        minFilingYear: minYear,
        accessionNumber: chosen.accessionNumber,
        filingDate: chosen.filingDate,
        confidence: ex.confidence,
        debtNoteTitle: ex.debtNoteTitle,
        hasDisplayHtml: hasHtml,
        htmlChars: displayHtml.length,
        rolledForward: Boolean(rollForward),
        unverifiedFallback: unverified,
        note: ex.note,
        warnings: ex.warnings ?? [],
        extractionMethod: ex.extractionMethod,
      });
    }
  }

  return rows;
}

function printSpotCheckReport(rows: DebtSpotRow[], label: string) {
  const ok = rows.filter((r) => r.hasDisplayHtml);
  const roll = rows.filter((r) => r.rolledForward);
  const weak = rows.filter((r) => !r.hasDisplayHtml && r.unverifiedFallback);
  const fail = rows.filter((r) => !r.hasDisplayHtml && !r.unverifiedFallback);

  console.log(`\n=== ${label} ===\n`);
  console.log(`Total runs: ${rows.length}`);
  console.log(`Success (HTML extracted): ${ok.length}`);
  console.log(`10-Q rolled forward from 10-K: ${roll.length}`);
  console.log(`Unverified fallback only: ${weak.length}`);
  console.log(`Failed (empty): ${fail.length}\n`);

  for (const r of rows) {
    const status = r.hasDisplayHtml ? "OK" : r.unverifiedFallback ? "WEAK" : "FAIL";
    console.log(
      [
        status.padEnd(4),
        r.ticker.padEnd(5),
        r.form,
        r.filingDate || `no-since-${r.minFilingYear}`,
        r.confidence.padEnd(10),
        r.extractionMethod || "—",
        r.debtNoteTitle ? `"${r.debtNoteTitle.slice(0, 40)}"` : "—",
        `html=${r.htmlChars}`,
        r.rolledForward ? "ROLL-FWD" : "",
        r.note ? `note=${r.note.slice(0, 64)}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );
    if (r.warnings.length > 0) {
      console.log(`       warnings: ${r.warnings.slice(0, 2).join("; ")}`);
    }
  }

  if (fail.length > 0) {
    console.log("\n=== FAILURES (detail) ===\n");
    for (const r of fail) {
      console.log(
        `${r.ticker} ${r.form} | ${r.filingDate || "no filing"} | ${r.confidence} | ${r.extractionMethod || "—"} | ${r.note.slice(0, 100)}`
      );
    }
  }

  console.log("\n=== FAILURE REASONS ===\n");
  const byReason = new Map<string, number>();
  for (const r of fail) {
    const reason = r.note.includes("No ")
      ? "Missing filing since min year"
      : r.note.includes("download failed")
        ? "SEC download failed"
        : r.note.includes("submissions not found")
          ? "Ticker not resolved"
          : r.confidence === "Not Found"
            ? "Extractor not found"
            : "Low confidence / empty extract";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  for (const [reason, count] of byReason) {
    console.log(`${count}× ${reason}`);
  }
}

describe("debt footnote spot check (2020–present — 20 tickers)", () => {
  it(
    "extracts latest 10-K and 10-Q debt notes filed since 2020",
    async () => {
      const rows = await runDebtFootnoteSpotCheckFromYear(TICKERS_2020_PRESENT, MIN_FILING_YEAR);
      printSpotCheckReport(rows, `DEBT FOOTNOTE SPOT CHECK — ${MIN_FILING_YEAR}–present (20 tickers)`);
      expect(rows.length).toBe(TICKERS_2020_PRESENT.length * 2);
    },
    1_200_000
  );
});
