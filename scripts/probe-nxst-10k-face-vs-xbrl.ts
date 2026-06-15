/**
 * Compare NXST 10-K: HTML face vs XBRL linkbase concept coverage.
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { fetchAsPresentedStatements } from "@/lib/sec-xbrl-as-presented";

const TICKER = "NXST";

function countConcepts(stmts: { rows: { concept: string }[] }[], prefix: string) {
  let xbrl = 0;
  let html = 0;
  for (const s of stmts) {
    for (const r of s.rows) {
      if (r.concept.startsWith("html:")) html += 1;
      else if (r.concept.includes(":")) xbrl += 1;
    }
  }
  console.log(`${prefix}: xbrl=${xbrl} html-fallback=${html}`);
}

async function main() {
  const res = await getAllFilingsByTickerCached(TICKER);
  if (!res) throw new Error("no NXST");
  const k = res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2026-02"));
  if (!k) throw new Error("no 10-K");

  console.log(`Filing: ${k.form} ${k.filingDate} doc=${k.primaryDocument}`);

  const face = await fetchFacePresentedStatements({
    cik: res.cik,
    accessionNumber: k.accessionNumber,
    form: k.form,
    filingDate: k.filingDate,
    primaryDocument: k.primaryDocument,
    docUrl: k.docUrl,
  });
  console.log("\n--- HTML face ---");
  console.log("inlineIxDetected:", face.inlineIxDetected);
  for (const s of face.statements) {
    console.log(`  ${s.title}: sourceHtmlFile=${s.sourceHtmlFile} rows=${s.rows.length}`);
    console.log(`    first row: ${s.rows[0]?.label} concept=${s.rows[0]?.concept}`);
  }
  countConcepts(face.statements, "face totals");

  const xbrl = await fetchAsPresentedStatements({
    cik: res.cik,
    accessionNumber: k.accessionNumber,
    form: k.form,
    filingDate: k.filingDate,
    primaryDocument: k.primaryDocument,
    docUrl: k.docUrl,
  });
  console.log("\n--- XBRL linkbase as-presented ---");
  for (const s of xbrl.statements ?? []) {
    console.log(`  ${s.title}: rows=${s.rows.length} first=${s.rows[0]?.label} concept=${s.rows[0]?.concept}`);
  }
  countConcepts(xbrl.statements ?? [], "linkbase totals");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
