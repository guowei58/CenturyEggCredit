/**
 * Deep dive: LUMN FY22 10-K CF tail rows — extraction vs HTML.
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  if (!res) throw new Error("no LUMN");

  const filings = [
    res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2022-02")),
    res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2023-02")),
    res.filings.find((f) => f.form === "10-K" && f.filingDate.startsWith("2024-02")),
  ].filter(Boolean);

  for (const f of filings) {
    const payload = await fetchFacePresentedStatements({
      cik: res.cik,
      accessionNumber: f!.accessionNumber,
      form: f!.form,
      filingDate: f!.filingDate,
      primaryDocument: f!.primaryDocument,
      docUrl: f!.docUrl,
    });
    const cf = payload.statements.find((s) => s.id === "cash-flow");
    console.log(`\n======== ${f!.filingDate} ${f!.accessionNumber} ========`);
    if (!cf) {
      console.log("NO CF");
      continue;
    }
    console.log("periods:", cf.periods.map((p) => `${p.key}:${p.label.slice(0, 60)}`));
    console.log("row count:", cf.rows.length);
    console.log("last 12 rows:");
    for (const r of cf.rows.slice(-12)) {
      const vals = Object.entries(r.values)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.log(`  [d${r.depth}] ${r.label} | ${r.concept?.slice(0, 50) ?? ""} | ${vals || "(empty)"}`);
    }

    const finIdx = cf.rows.findIndex((r) => /net cash used in financing activities/i.test(r.label));
    console.log("financing idx:", finIdx, finIdx >= 0 ? cf.rows[finIdx]!.label : "");
    if (finIdx >= 0) {
      const fin = cf.rows[finIdx]!;
      console.log("financing values:", JSON.stringify(fin.values));
    }

    // QA / diagnostics if present
    const qa = (payload as { qa?: unknown }).qa ?? (cf as { qa?: unknown }).qa;
    if (qa) console.log("qa:", JSON.stringify(qa).slice(0, 500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
