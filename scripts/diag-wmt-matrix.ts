import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_parsePrimaryStatementAtTableOffset,
  __test_extractTableMatrix,
  __test_detectDataStart,
  __test_inferValueColumnIndices,
  __test_inferPeriods,
} from "@/lib/sec-filing-financials";

const main = async () => {
  const res = await getAllFilingsByTickerCached("WMT");
  const f = res?.filings.find((x) => x.form === "10-Q" && (x.reportDate ?? "").startsWith("2024-04"));
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
  for (const [ti, kind] of [
    [6, "is"],
    [11, "cf"],
  ] as const) {
    const matrix = __test_extractTableMatrix(ctx.$, ctx.tables[ti]!);
    const dataStart = __test_detectDataStart(matrix);
    const cols = __test_inferValueColumnIndices(matrix, dataStart);
    const periods = __test_inferPeriods(matrix, dataStart, cols);
    console.log("matrix head", matrix.slice(0, 6).map((r) => r.slice(0, 10)));
    console.log("dataStart", dataStart, "cols", cols, "periods", periods.map((p) => p.label));
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
    console.log(
      `table ${ti} ${kind}: periods=${parsed?.periods.length} valid=${!!validated}`,
      parsed?.periods.map((p) => p.label)
    );
  }
};

main().catch(console.error);
