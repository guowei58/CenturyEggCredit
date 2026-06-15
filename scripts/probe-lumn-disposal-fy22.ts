/**
 * Where does LUMN FY22 "Loss on disposal groups held for sale" = 700 live?
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";

const TARGET = /disposal groups held for sale|DisposalGroupNotDiscontinuedOperationGainLossOnDisposal/i;

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const filings = res.filings.filter(
    (f) => f.form === "10-K" && f.filingDate >= "2022-01-01" && f.filingDate <= "2026-06-01"
  );

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
      if (!TARGET.test(`${r.label} ${r.concept ?? ""}`)) continue;
      const vals = Object.entries(r.values)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (vals) console.log(`${f.filingDate} ${f.form} | ${r.label} | ${vals}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
