/**
 * Profile financial statement load (run: npx tsx scripts/profile-financials-load.ts FICO [accession])
 */
import { performance } from "node:perf_hooks";

import { getAllFilingsByTickerCached, peekCachedFilingsByTicker } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
import { fetchAsPresentedStatements } from "@/lib/sec-xbrl-as-presented";

function ms(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}

async function main() {
  const sym = (process.argv[2] ?? "FICO").toUpperCase();
  const accArg = process.argv[3]?.trim();

  console.log(`\n=== Financials load profile: ${sym} ===\n`);

  let t0 = performance.now();
  const filingsRes = await getAllFilingsByTickerCached(sym);
  console.log(`1. Submissions (cached)     ${ms(t0)}  filings=${filingsRes?.filings.length ?? 0}`);

  const f =
    (accArg ? filingsRes?.filings.find((x) => x.accessionNumber === accArg) : null) ??
    filingsRes?.filings.find((x) => x.form === "10-Q" || x.form === "10-K") ??
    filingsRes?.filings[0];
  if (!f || !filingsRes) return;
  console.log(`   → ${f.form} ${f.filingDate} ${f.accessionNumber}\n`);

  t0 = performance.now();
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  console.log(`2. TEST HTML extract       ${ms(t0)}  stmts=${bundle.statements.length} htmlKB=${((bundle.primaryHtml?.length ?? 0) / 1024).toFixed(0)}`);

  t0 = performance.now();
  await fetchFacePresentedStatements({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    filingDate: f.filingDate,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  console.log(`3. TEST face (full API)    ${ms(t0)}`);

  t0 = performance.now();
  peekCachedFilingsByTicker(sym);
  console.log(`4. Submissions (skip, cache) ${ms(t0)}`);

  t0 = performance.now();
  await fetchFacePresentedStatements({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    filingDate: f.filingDate,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  console.log(`5. TEST face (2nd filing)  ${ms(t0)}  ← simulates skipSubmissions switch`);

  t0 = performance.now();
  await fetchAsPresentedStatements({
    cik: filingsRes.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    filingDate: f.filingDate,
    docUrl: f.docUrl,
  });
  console.log(`6. SEC XBRL as-presented   ${ms(t0)}  ← SEC XBRL Financials tab path`);
}

main().catch(console.error);
