import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_findStatementClusterInPrimaryItemSection,
  parsePrimaryFilingStatementsFromHtml,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

const main = async () => {
  const res = await getAllFilingsByTickerCached("SAIA");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === "2024-06-30"
  );
  if (!f) throw new Error("no filing");
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const loc = locateFinancialStatementsSection(ctx, "10-Q");
  const resolved = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q");
  const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
  const stmts = parsePrimaryFilingStatementsFromHtml(html, { form: "10-Q", primaryDocument: f.primaryDocument });
  console.log("loc", loc?.strategy, loc?.section);
  console.log("resolved", resolved);
  console.log("cluster", cluster?.cluster.score ?? null);
  console.log("parsed", stmts.map((s) => s.id).join(","));
  if (resolved) {
    const tablesIn = ctx.tables.filter((t) => t.offset >= resolved.start && t.offset < resolved.end);
    console.log("tables in section", tablesIn.length, tablesIn.map((t) => t.offset).join(","));
    for (const ti of tablesIn.map((t) => ctx.tables.indexOf(t))) {
      for (const kind of ["is", "bs", "cf"] as const) {
        const { parsed } = await import("@/lib/sec-filing-financials").then((m) =>
          m.__test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q")
        );
        if (parsed && parsed.rows.length >= 4) {
          console.log(`  #${ti} ${kind} rows=${parsed.rows.length} label0=${parsed.rows[0]?.label}`);
        }
      }
    }
  }
};

main().catch(console.error);
