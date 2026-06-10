import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findStatementClusterInPrimaryItemSection,
  __test_statementTableTextLooksLikePrimaryFace,
  __test_resolveFinancialStatementsSectionBounds,
} from "@/lib/sec-filing-financials";

const main = async () => {
  const res = await getAllFilingsByTickerCached("HUBB");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === "2024-03-31"
  );
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f!.accessionNumber,
    form: f!.form,
    primaryDocument: f!.primaryDocument,
    docUrl: f!.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q")!;
  const clusterHit = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
  console.log("section", section);
  console.log("cluster", clusterHit?.cluster ?? null);

  for (const ti of [7, 10, 11]) {
    const t = ctx.tables[ti]!;
    console.log(
      `#${ti} is=${__test_statementTableTextLooksLikePrimaryFace(ctx.$, t, "is")} bs=${__test_statementTableTextLooksLikePrimaryFace(ctx.$, t, "bs")} cf=${__test_statementTableTextLooksLikePrimaryFace(ctx.$, t, "cf")}`
    );
  }
};

main().catch(console.error);
