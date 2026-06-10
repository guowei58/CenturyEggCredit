import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
  __test_parseBestStatementTableFromHtml,
  __test_statementTableTextLooksLikePrimaryFace,
  __test_tableClassificationText,
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

  console.log("\n--- first 12 tables in section ---");
  for (let ti = 0; ti < ctx.tables.length; ti++) {
    const t = ctx.tables[ti]!;
    if (t.offset < section.start || t.offset >= section.start + 25000) continue;
    const text = __test_tableClassificationText(ctx.$, t).slice(0, 200);
    const looksBs = __test_statementTableTextLooksLikePrimaryFace(ctx.$, t, "bs");
    const { parsed } = __test_parsePrimaryStatementAtTableOffset(html, "bs", ti, "10-Q");
    console.log(
      `#${ti}@${t.offset} looksBs=${looksBs} rows=${parsed?.rows.length ?? 0} periods=${parsed?.periods.length ?? 0}`,
      text.replace(/\s+/g, " ").slice(0, 120)
    );
    if (parsed && parsed.rows.length >= 4) {
      console.log(
        "  labels:",
        parsed.rows.slice(0, 8).map((r) => r.label).join(" | "),
        "shape=",
        __test_validateSinglePrimaryStatementShape(parsed, "10-Q")
      );
    }
  }

  const best = __test_parseBestStatementTableFromHtml(html, { kind: "bs", form: "10-Q" });
  console.log("\nparseBestStatementTableFromHtml bs:", best?.rows.length, best?.rows.slice(0, 6).map((r) => r.label));
};

main().catch(console.error);
