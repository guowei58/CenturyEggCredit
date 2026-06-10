import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";
import {
  findFilteredNotesToFinancialStatementsStart,
  findPrimaryFaceTablesEndBeforeNotes,
} from "@/lib/sec-statement-locator/signals";

const ticker = (process.argv[2] ?? "WFC").toUpperCase();
const period = process.argv[3] ?? "2025-03-31";

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return console.log("not found");
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const umbrella = findFilteredNotesToFinancialStatementsStart(ctx.acc, 1800);
  const faceEnd = findPrimaryFaceTablesEndBeforeNotes(ctx.acc, 0, ctx.acc.length);
  const lookback = umbrella != null ? Math.max(1800, umbrella - 90_000) : 1800;
  console.log(`${ticker} ${period} doc=${f.primaryDocument} len=${ctx.acc.length}`);
  console.log(`umbrella@${umbrella} faceEnd@${faceEnd} lookback@${lookback}`);
  if (umbrella != null) {
    console.log("ctx:", ctx.acc.slice(umbrella, umbrella + 120).replace(/\s+/g, " "));
  }
  const before = ctx.tables.filter((t) => t.offset < faceEnd);
  console.log(`tables before notes: ${before.length}`);
  for (let i = 0; i < before.length; i++) {
    const t = before[i];
    const ti = ctx.tables.indexOf(t);
    const preview = ctx.acc.slice(Math.max(0, t.offset - 200), t.offset + 80).replace(/\s+/g, " ");
    for (const kind of ["is", "bs", "cf"] as const) {
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
      const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false;
      if (parsed && parsed.rows.length > 0) {
        console.log(
          `  #${ti}@${t.offset} as-${kind}: rows=${parsed.rows.length} shape=${shape} preview=${preview.slice(0, 100)}`
        );
      }
    }
  }
}

main().catch(console.error);
