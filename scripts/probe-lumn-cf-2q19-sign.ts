/**
 * Diagnose net income sign on LUMN 2Q2019 (Aug 2019 10-Q) HTML-face extraction.
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");
  const f =
    res.filings.find((x) => x.form === "10-Q" && x.filingDate?.startsWith("2019-08")) ??
    res.filings.find((x) => x.accessionNumber === "0000018926-19-000018");
  if (!f) throw new Error("no 2Q19 filing");

  console.log("Filing:", f.filingDate, f.form, f.accessionNumber);
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });

  const cf = bundle.statements.find((s) => s.id === "cash-flow");
  if (!cf) {
    console.log("No CF. Statements:", bundle.statements.map((s) => s.id));
    return;
  }

  console.log("\nCF units:", cf.units);
  console.log("Periods:");
  for (const p of cf.periods) console.log(" ", p.key, "|", p.label);

  const watch = /net\s*\(?\s*loss\s*\)?\s*income|net income|net loss/i;
  for (const row of cf.rows) {
    if (!watch.test(row.label)) continue;
    console.log("\n=== ROW:", row.label);
    console.log("concept:", row.concept);
    console.log("valueFormat:", row.valueFormat);
    for (const p of cf.periods) {
      const v = row.values[p.key];
      const d = row.displayValues?.[p.key];
      const ix = row.ixByPeriod?.[p.key];
      console.log(`  ${p.label}`);
      console.log(`    values: ${v}`);
      console.log(`    displayValues: "${d}"`);
      if (ix) {
        console.log(`    ix concept: ${ix.xbrlConcept}`);
        console.log(`    ix rawValue: ${ix.rawValue}`);
        console.log(`    ix sign attr: ${ix.sign}`);
        console.log(`    ix visibleText: ${ix.visibleText}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
