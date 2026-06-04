import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchFacePresentedStatements } from "@/lib/sec-ixbrl-face-extract";
import { sortPresentedFilingsNewestFirst } from "@/lib/sec-xbrl-as-presented-save-client";

async function main() {
  const r = await getAllFilingsByTicker("GEN");
  const ordered = sortPresentedFilingsNewestFirst(
    r!.filings.filter((f) => f.form === "10-K" || f.form === "10-Q")
  );
  for (const f of ordered.slice(0, 5)) {
    const t0 = Date.now();
    const out = await fetchFacePresentedStatements({
      cik: r!.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      filingDate: f.filingDate,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    console.log(
      f.filingDate,
      f.form,
      `${Date.now() - t0}ms`,
      "stmts",
      out.statements.length,
      out.statements.map((s) => s.id).join(",") || "(none)"
    );
  }
}

main().catch(console.error);
