import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
import { sortPresentedFilingsNewestFirst } from "@/lib/sec-xbrl-as-presented-save-client";

async function main() {
  const r = await getAllFilingsByTicker("GEN");
  const ordered = sortPresentedFilingsNewestFirst(
    r!.filings.filter((f) => f.form === "10-K" || f.form === "10-Q")
  );
  for (const f of ordered.slice(0, 6)) {
    const t0 = Date.now();
    try {
      const b = await fetchHtmlFilingStatementsBundle({
        cik: r!.cik,
        accessionNumber: f.accessionNumber,
        form: f.form,
        primaryDocument: f.primaryDocument,
        docUrl: f.docUrl,
      });
      console.log(
        f.filingDate,
        f.form,
        f.accessionNumber.slice(-8),
        `${Date.now() - t0}ms`,
        "stmts",
        b.statements.length,
        b.statements.map((s) => s.id).join(",") || "(none)"
      );
    } catch (e) {
      console.log(f.filingDate, f.form, "ERR", e instanceof Error ? e.message : e);
    }
  }
}

main().catch(console.error);
