import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_inferPrimaryFaceStatementKind,
  __test_statementTableContentLooksLikePrimaryFace,
  __test_debugBalanceSheetFaceRejection,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
  __test_tableClassificationText,
  parsePrimaryFilingStatementFromContext,
} from "@/lib/sec-filing-financials";

async function probe(ticker: string, acc?: string) {
  const res = await getAllFilingsByTickerCached(ticker);
  const f =
    (acc ? res?.filings.find((x) => x.accessionNumber === acc) : null) ??
    res?.filings.find((x) => x.form === "10-Q" || x.form === "10-K");
  if (!f || !res) throw new Error("filing not found");

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });

  console.log(`\n${ticker} ${f.form} ${f.filingDate} ${f.accessionNumber}`);
  console.log(
    "parsed:",
    bundle.statements.map((s) => ({ id: s.id, rows: s.rows.length, periods: s.periods.length }))
  );

  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml!);
  if (!ctx) return;
  const section = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, f.form);
  console.log("section", section);

  const sectionTables = ctx.tables
    .filter((t) => section && t.offset >= section.start && t.offset < section.end)
    .slice(0, 20);

  console.log(`tables in section (first ${sectionTables.length}):`);
  const focusIdx = [0, 1, 2, 3, 4];
  for (const i of focusIdx) {
    const table = sectionTables[i];
    if (!table) continue;
    const gate = __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, table);
    const kind = gate ? __test_inferPrimaryFaceStatementKind(ctx.$, table) : null;
    const text = __test_tableClassificationText(ctx.$, table);
    console.log(`table[${i}] gate=${gate} kind=${kind ?? "-"} bsReject=${gate ? __test_debugBalanceSheetFaceRejection(text) : "-"} bs=${__test_statementTableContentLooksLikePrimaryFace(text, "bs")}`);
    if (i === 2 || i === 4) {
      console.log("  sample:", JSON.stringify(text.slice(0, 350)));
      console.log("  cues:", {
        totalAssets: /total assets/i.test(text),
        totalCurrent: /total current assets/i.test(text),
        totalLiab: /total liabilities/i.test(text),
        equity: /stockholders'? equity|shareholders'? equity/i.test(text),
        cash: /cash and cash equivalents/i.test(text),
        heldForSale: /held for sale|parenthetical/i.test(text),
      });
    }
  }
}

const ticker = (process.argv[2] ?? "FICO").toUpperCase();
const acc = process.argv[3]?.trim();
void probe(ticker, acc);
