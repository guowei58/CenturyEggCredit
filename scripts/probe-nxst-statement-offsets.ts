import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";

async function main() {
  const res = await getAllFilingsByTickerCached("NXST");
  const k = res!.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2026-02"))!;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: k.accessionNumber,
    form: k.form,
    primaryDocument: k.primaryDocument,
    docUrl: k.docUrl,
  });
  for (const s of bundle.statements) {
    console.log(`${s.id}: offset=${s.sourceTableOffset} file=${s.sourceHtmlFile} rows=${s.rows.length}`);
    console.log(`  labels: ${s.rows.slice(0, 6).map((r) => r.label).join(" | ")}`);
    const tagged = s.rows.filter((r) => Object.values(r.ixByPeriod ?? {}).some((m) => m?.xbrlConcept)).length;
    console.log(`  tagged rows: ${tagged}`);
  }
}

main().catch(console.error);
