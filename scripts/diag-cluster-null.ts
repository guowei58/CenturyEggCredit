import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";

const cases = [
  { ticker: "HUBB", period: "2024-03-31" },
  { ticker: "MANH", period: "2024-03-31" },
  { ticker: "TER", period: "2024-06-30" },
  { ticker: "BURL", period: "2024-05-04" },
] as const;

async function main() {
  for (const c of cases) {
    const res = await getAllFilingsByTickerCached(c.ticker);
    const f = res?.filings.find(
      (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === c.period
    );
    if (!f) {
      console.log("missing", c);
      continue;
    }
    const bundle = await fetchHtmlFilingStatementsBundle({
      cik: res!.cik,
      accessionNumber: f.accessionNumber,
      form: f.form,
      primaryDocument: f.primaryDocument,
      docUrl: f.docUrl,
    });
    const html = bundle.primaryHtml ?? "";
    const ctx = buildParsedFilingHtmlContext(html)!;
    const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q");
    console.log(`\n=== ${c.ticker} ${c.period} ===`);
    console.log("section", section);
    if (!section) continue;
    const tables = ctx.tables.filter((t) => t.offset >= section.start && t.offset < section.end);
    console.log("tables", tables.length);
    for (let ti = 0; ti < ctx.tables.length; ti += 1) {
      const t = ctx.tables[ti]!;
      if (t.offset < section.start || t.offset >= section.end) continue;
      for (const kind of ["is", "bs", "cf"] as const) {
        const { parsed } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
        if (!parsed || parsed.rows.length < 4) continue;
        const shape = __test_validateSinglePrimaryStatementShape(parsed, "10-Q");
        if (shape) console.log(`  #${ti}@${t.offset} ${kind} rows=${parsed.rows.length} VALID`);
        else console.log(`  #${ti}@${t.offset} ${kind} rows=${parsed.rows.length} shape-fail labels=${parsed.rows.slice(0,4).map(r=>r.label).join('|')}`);
      }
    }
  }
}

main().catch(console.error);
