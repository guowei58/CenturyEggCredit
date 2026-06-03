/**
 * Profile TEST tab `/api/sec/xbrl/test-as-presented` work (run: npx tsx scripts/time-test-tab-load.ts FICO)
 */
import { performance } from "node:perf_hooks";

import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import {
  fetchHtmlFilingStatements,
  parsePrimaryFilingStatementHtml,
} from "@/lib/sec-filing-financials";
import { fetchFilingIndexItems } from "@/lib/sec/filingIndex";
import { getSecEdgarUserAgent, secArchivesPrimaryDocumentUrl } from "@/lib/sec-edgar";

function ms(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}

async function timeFetch(url: string): Promise<{ ms: number; bytes: number }> {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: { "User-Agent": getSecEdgarUserAgent() },
    cache: "no-store",
  });
  const text = await res.text();
  return { ms: performance.now() - t0, bytes: text.length };
}

async function main() {
  const sym = (process.argv[2] ?? "FICO").toUpperCase();
  const accArg = process.argv[3]?.trim();

  console.log(`\n=== TEST tab load profile: ${sym} ===\n`);

  let t0 = performance.now();
  const filingsRes = await getAllFilingsByTicker(sym);
  console.log(`1. getAllFilingsByTicker     ${ms(t0)}  (${filingsRes?.filings.length ?? 0} filings)`);
  if (!filingsRes) return;

  const chosen =
    (accArg ? filingsRes.filings.find((f) => f.accessionNumber === accArg) : null) ??
    filingsRes.filings.find((f) => f.form === "10-Q" || f.form === "10-K") ??
    filingsRes.filings[0];
  if (!chosen) return;
  console.log(`   selected: ${chosen.form} ${chosen.filingDate} ${chosen.accessionNumber}`);

  const sourceUrl =
    chosen.docUrl ??
    secArchivesPrimaryDocumentUrl(filingsRes.cik, {
      accessionNumber: chosen.accessionNumber,
      primaryDocument: chosen.primaryDocument,
    }) ??
    "";

  t0 = performance.now();
  const primaryRes = await fetch(sourceUrl, {
    headers: { "User-Agent": getSecEdgarUserAgent(), Accept: "*/*" },
    cache: "no-store",
  });
  const primaryHtml = await primaryRes.text();
  const tPrimary = performance.now() - t0;
  console.log(`2a. SEC primary HTML download  ${tPrimary.toFixed(0)}ms  ${(primaryHtml.length / 1024).toFixed(0)} KB`);

  t0 = performance.now();
  for (const kind of ["is", "bs", "cf"] as const) {
    parsePrimaryFilingStatementHtml(primaryHtml, {
      kind,
      form: chosen.form,
      primaryDocument: chosen.primaryDocument,
      sourceUrl,
    });
  }
  console.log(`2b. parse 3 statements (CPU)   ${ms(t0)}`);

  t0 = performance.now();
  const htmlStmts = await fetchHtmlFilingStatements({
    cik: filingsRes.cik,
    accessionNumber: chosen.accessionNumber,
    form: chosen.form,
    primaryDocument: chosen.primaryDocument,
    docUrl: chosen.docUrl,
  });
  console.log(`2. fetchHtmlFilingStatements ${ms(t0)}  (${htmlStmts.length} stmts, url=${htmlStmts[0]?.sourceHtmlUrl?.slice(-40) ?? "?"})`);

  if (htmlStmts[0]?.sourceHtmlUrl) {
    const { ms: fetchMs, bytes } = await timeFetch(htmlStmts[0].sourceHtmlUrl);
    console.log(`   (repeat primary HTML fetch)  ${fetchMs.toFixed(0)}ms  ${(bytes / 1024).toFixed(0)} KB`);
  }

  t0 = performance.now();
  const indexItems = await fetchFilingIndexItems(
    filingsRes.cik.replace(/\D/g, "").padStart(10, "0"),
    chosen.accessionNumber
  );
  console.log(`3. fetchFilingIndexItems      ${ms(t0)}  (${indexItems.length} files)`);

  t0 = performance.now();
  const face = await fetchFacePresentedStatements({
    cik: filingsRes.cik,
    accessionNumber: chosen.accessionNumber,
    form: chosen.form,
    filingDate: chosen.filingDate,
    primaryDocument: chosen.primaryDocument,
    docUrl: chosen.docUrl,
  });
  console.log(`4. fetchFacePresentedStatements ${ms(t0)}  (validation=${face.validation.length}, calcLoaded=${face.calculationLinkbaseLoaded})`);

  t0 = performance.now();
  await getAllFilingsByTicker(sym);
  console.log(`\n   (cached?) getAllFilingsByTicker again ${ms(t0)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
