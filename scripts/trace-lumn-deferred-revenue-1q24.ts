/**
 * Trace "Change in deferred revenue" in LUMN 1Q24 CF across filings.
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";

const CONCEPT = "us-gaap:IncreaseDecreaseInDeferredRevenue";
const WATCH = /deferred revenue/i;

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const q1_24 = res.filings.find((f) => f.accessionNumber === "0000018926-24-000054");
  if (!q1_24) throw new Error("no 1Q24");

  console.log("=== 1Q24 FILING ALL CF ROWS (deferred / concept hits) ===");
  const p1 = await fetchFacePresentedStatements({
    cik: res.cik,
    accessionNumber: q1_24.accessionNumber,
    form: q1_24.form,
    filingDate: q1_24.filingDate,
    primaryDocument: q1_24.primaryDocument,
    docUrl: q1_24.docUrl,
  });
  const cf1 = p1.statements.find((s) => s.id === "cash-flow")!;
  const pk = cf1.periods.find((p) => /2024/.test(p.label) && /three month/i.test(p.label))!.key;
  for (const r of cf1.rows) {
    const concepts = cf1.periods.map((p) => r.cellIxByPeriod[p.key]?.xbrlConcept).filter(Boolean);
    if (WATCH.test(r.label) || concepts.some((c) => c === CONCEPT)) {
      console.log(`  ${r.label} | concept=${concepts.join(",")} | p1=${r.values[pk]}`);
    }
  }
  console.log(`Total CF rows: ${cf1.rows.length}`);

  // Scan 2023-2025 filings for this concept with any 2024 Q1-ish value
  const filings = res.filings.filter(
    (f) => (f.form === "10-Q" || f.form === "10-K") && f.filingDate >= "2023-01-01" && f.filingDate <= "2025-06-01"
  );

  console.log("\n=== ALL FILINGS WITH IncreaseDecreaseInDeferredRevenue ===");
  for (const f of filings) {
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      filingDate: f.filingDate,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    const cf = payload.statements.find((s) => s.id === "cash-flow");
    if (!cf) continue;
    for (const r of cf.rows) {
      for (const p of cf.periods) {
        const c = r.cellIxByPeriod[p.key]?.xbrlConcept ?? r.concept;
        if (c === CONCEPT || (WATCH.test(r.label) && r.values[p.key] != null)) {
          console.log(
            `  ${f.filingDate} ${f.form} ${f.accessionNumber.slice(-6)} | ${r.label} | ${p.label} = ${r.values[p.key]}`
          );
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
