/**
 * Optional tickers override (same batch as SEC tab **MD&A / earnings check**, not XBRL reconcile):
 *   npx tsx --tsconfig tsconfig.json scripts/run-narrative-batch-report.ts GOOG CRM BAC
 *
 * Env: `NARRATIVE_DIAG_MAX` — cap filings per issuer (default 80; banks can take an hour each at 80).
 */

import { runSecXbrlNarrativeBatchDiagnostics } from "@/lib/sec-xbrl-narrative-batch-diagnostics";

const XBRL_AS_PRESENTED_DIAG_LOOKBACK_YEARS = 20;
const XBRL_AS_PRESENTED_DIAG_MAX_FILINGS = 80;

function effectiveMaxFilings(): number {
  const raw = (process.env.NARRATIVE_DIAG_MAX ?? "").trim();
  if (!raw) return XBRL_AS_PRESENTED_DIAG_MAX_FILINGS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return XBRL_AS_PRESENTED_DIAG_MAX_FILINGS;
  return Math.max(1, Math.min(80, n));
}

async function main() {
  const argvTickers = process.argv.slice(2).filter((a) => a.length > 0 && !a.startsWith("-"));
  const tickers =
    argvTickers.length > 0
      ? argvTickers.map((t) => t.trim().toUpperCase()).filter(Boolean)
      : ([
          "NXST",
          "LUMN",
          "FICO",
          "TSLA",
          "GTN",
          "GE",
          "AMC",
          "BLCO",
          "REXR",
          "SBGI",
          "SSP",
          "ADV",
          "IHRT",
          "SIRI",
        ] as string[]);
  const minYear = new Date().getFullYear() - XBRL_AS_PRESENTED_DIAG_LOOKBACK_YEARS;
  const maxFilings = effectiveMaxFilings();
  if (argvTickers.length > 0) {
    process.stderr.write(`Using maxFilings=${maxFilings}${process.env.NARRATIVE_DIAG_MAX ? " (from NARRATIVE_DIAG_MAX)" : ""}; sinceYear≥${minYear}\n`);
  }
  const all: Awaited<ReturnType<typeof runSecXbrlNarrativeBatchDiagnostics>>[] = [];
  for (const t of tickers) {
    process.stderr.write(`… ${t}\n`);
    const r = await runSecXbrlNarrativeBatchDiagnostics(t, {
      maxFilings,
      minFilingYear: minYear,
    });
    all.push(r);
  }
  if (argvTickers.length > 0) {
    const compact = all.map((r) => ({
      ticker: r.ticker,
      checked: r.checked,
      suspicious: r.suspicious,
      failures: r.failures.map((f) => ({
        filingDate: f.filingDate,
        form: f.form,
        accessionNumber: f.accessionNumber,
        mdnaOk: f.mdnaOk,
        earningsOk: f.earningsOk,
        loadError: f.loadError,
        issues: f.issues,
      })),
    }));
    console.log(JSON.stringify(compact, null, 2));
    return;
  }
  console.log(JSON.stringify(all, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
