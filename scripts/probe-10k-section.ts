import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
  __test_inferPrimaryFaceStatementKind,
  __test_tableClassificationText,
} from "@/lib/sec-filing-financials";

async function detail(ticker: string, acc: string) {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res!.filings.find((x) => x.accessionNumber === acc)!;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml!)!;
  const section = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, f.form);
  console.log(`\n${ticker} ${f.filingDate} section=`, section);

  const inSection = ctx.tables.filter(
    (t) => section && t.offset >= section.start && t.offset < section.end
  );
  console.log(`tables in section: ${inSection.length}, first 12:`);
  for (const [i, table] of inSection.slice(0, 12).entries()) {
    const gate = __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, table);
    const kind = gate ? __test_inferPrimaryFaceStatementKind(ctx.$, table) : null;
    const text = __test_tableClassificationText(ctx.$, table).slice(0, 100);
    console.log(`  [${i}] off=${table.offset} gate=${gate} kind=${kind ?? "-"} ${JSON.stringify(text)}`);
  }
}

void detail(process.argv[2]!.toUpperCase(), process.argv[3]!);
