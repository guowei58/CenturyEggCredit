/**
 * Compare 10-Q vs 10-K load: npx tsx scripts/profile-10q-vs-10k.ts FICO
 */
import { performance } from "node:perf_hooks";

import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { fetchAsPresentedStatements } from "@/lib/sec-xbrl-as-presented";

function ms(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}

async function profileFiling(
  label: string,
  filingsRes: NonNullable<Awaited<ReturnType<typeof getAllFilingsByTickerCached>>>,
  f: (typeof filingsRes.filings)[0]
) {
  console.log(`\n--- ${label}: ${f.form} ${f.filingDate} ${f.accessionNumber} ---`);

  let t0 = performance.now();
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const htmlKb = ((bundle.primaryHtml?.length ?? 0) / 1024).toFixed(0);
  const tableCount = bundle.parsedTables?.length ?? "?";
  console.log(`  HTML bundle (parse)     ${ms(t0)}  stmts=${bundle.statements.length} htmlKB=${htmlKb} tables=${tableCount}`);

  t0 = performance.now();
  await fetchFacePresentedStatements({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    filingDate: f.filingDate,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  console.log(`  TEST face (full)        ${ms(t0)}`);

  t0 = performance.now();
  await fetchAsPresentedStatements({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    filingDate: f.filingDate,
    docUrl: f.docUrl,
  });
  console.log(`  SEC XBRL as-presented   ${ms(t0)}`);
}

async function main() {
  const sym = (process.argv[2] ?? "FICO").toUpperCase();
  const filingsRes = await getAllFilingsByTickerCached(sym);
  if (!filingsRes) {
    console.error("No filings");
    return;
  }
  const q = filingsRes.filings.find((x) => x.form === "10-Q");
  const k = filingsRes.filings.find((x) => x.form === "10-K");
  if (q) await profileFiling("Latest 10-Q", filingsRes, q);
  if (k) await profileFiling("Latest 10-K", filingsRes, k);
}

main().catch(console.error);
