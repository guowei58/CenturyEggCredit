import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_inferPrimaryFaceStatementKind,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
} from "@/lib/sec-filing-financials";

async function main() {
  const res = await getAllFilingsByTickerCached("OPTU");
  const f = res!.filings.find((x) => x.accessionNumber === "0001628280-19-013363")!;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml!)!;
  const section = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, "10-Q")!;
  console.log("section", section, "len", section.end - section.start);

  const tables = ctx.tables.filter((t) => t.offset >= section.start && t.offset < section.end);
  console.log("tables in section", tables.length);

  const gated = tables.filter((t) => __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, t));
  console.log("gated tables", gated.length);

  for (const t of gated.slice(0, 20)) {
    const kind = __test_inferPrimaryFaceStatementKind(ctx.$, t);
    const heading = ctx.acc.slice(Math.max(section.start, t.offset - 200), t.offset).replace(/\s+/g, " ").slice(-120);
    console.log(t.offset, kind ?? "-", heading);
  }
}

main().catch(console.error);
