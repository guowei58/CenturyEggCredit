import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_appendCashFlowContinuationTables,
} from "@/lib/sec-filing-financials";

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  const f = res?.filings.find((x) => x.accessionNumber === "0000018926-23-000013");
  if (!res || !f) throw new Error("missing");

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });

  const html = bundle.primaryHtml!;
  const merged = __test_appendCashFlowContinuationTables(html, 33, "10-K");
  console.log("merged rows:", merged?.rows.length);
  for (const r of merged?.rows.slice(-10) ?? []) {
    const vals = Object.entries(r.values)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(`  ${r.label.slice(0, 72)} | ${vals}`);
  }

  const cf = bundle.statements.find((s) => s.id === "cash-flow");
  console.log("\nbundle CF rows:", cf?.rows.length);
  if (cf) {
    for (const r of cf.rows.slice(-5)) {
      const vals = Object.entries(r.values)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.log(`  bundle: ${r.label.slice(0, 60)} | ${vals}`);
    }
  }

  const direct = parsePrimaryFilingStatementsFromHtml(html, {
    form: f.form,
    primaryDocument: f.primaryDocument,
    sourceUrl: bundle.primarySourceUrl,
  });
  const directCf = direct.find((s) => s.id === "cash-flow");
  console.log("\ndirect parse CF rows:", directCf?.rows.length);
}

main().catch(console.error);
