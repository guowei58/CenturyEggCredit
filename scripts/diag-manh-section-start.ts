import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_statementTableTextLooksLikePrimaryFace,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";

const main = async () => {
  const res = await getAllFilingsByTickerCached("MANH");
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

  console.log("section", section);
  console.log("\n--- text at section.start ---");
  console.log(ctx.acc.slice(section.start, section.start + 500).replace(/\s+/g, " "));

  const t6 = ctx.tables[6]!;
  console.log("\n--- table #6 (BS) ---");
  console.log("offset", t6.offset, "before section?", t6.offset < section.start);
  console.log("looksBs", __test_statementTableTextLooksLikePrimaryFace(ctx.$, t6, "bs"));
  const { parsed } = __test_parsePrimaryStatementAtTableOffset(html, "bs", 6, "10-Q");
  console.log("rows", parsed?.rows.length, "shape", parsed ? __test_validateSinglePrimaryStatementShape(parsed, "10-Q") : false);
  if (parsed) console.log("labels", parsed.rows.slice(0, 6).map((r) => r.label).join(" | "));
};

main().catch(console.error);
