import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_inferPrimaryFaceStatementKind,
  __test_statementTableMeetsMinNumbersPerPeriodColumn,
} from "@/lib/sec-filing-financials";

async function probe10Ks(ticker: string, limit = 12) {
  const res = await getAllFilingsByTickerCached(ticker);
  if (!res) throw new Error("no submissions");

  const filings = res.filings.filter((f) => f.form === "10-K").slice(0, limit);
  console.log(`\n=== ${ticker} last ${filings.length} 10-K filings ===\n`);

  for (const f of filings) {
    try {
      const bundle = await fetchHtmlFilingStatementsBundle({
        cik: res.cik,
        accessionNumber: f.accessionNumber,
        form: f.form,
        primaryDocument: f.primaryDocument,
        docUrl: f.docUrl,
      });
      const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "");
      const section = ctx
        ? __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, f.form)
        : null;
      const ids = bundle.statements.map((s) => s.id);
      const ok = ids.length > 0;

      let detail = "";
      if (!ctx) detail = "no html context";
      else if (!section) detail = "no Item 8 section";
      else {
        const tables = ctx.tables
          .filter((t) => t.offset >= section.start && t.offset < section.end)
          .slice(0, f.form.includes("10-K") ? 25 : 7);
        const gated = tables.filter((t) =>
          __test_statementTableMeetsMinNumbersPerPeriodColumn(ctx.$, t)
        );
        const kinds = gated
          .map((t) => __test_inferPrimaryFaceStatementKind(ctx.$, t))
          .filter(Boolean);
        detail = `section tables=${tables.length} gated=${gated.length} kinds=[${kinds.join(",")}]`;
        if (tables.length === 0) detail += " EMPTY_SECTION";
        if (gated.length === 0 && tables.length > 0) detail += " SIZE_GATE_FAIL";
        if (kinds.length === 0 && gated.length > 0) detail += " NO_KIND_MATCH";
      }

      console.log(
        `${ok ? "OK " : "FAIL"} ${f.filingDate} ${f.accessionNumber} stmts=[${ids.join(",")}] ${detail}`
      );
    } catch (e) {
      console.log(`ERR  ${f.filingDate} ${f.accessionNumber} ${(e as Error).message}`);
    }
  }
}

const ticker = (process.argv[2] ?? "FICO").toUpperCase();
const limit = Number.parseInt(process.argv[3] ?? "12", 10) || 12;
void probe10Ks(ticker, limit);
