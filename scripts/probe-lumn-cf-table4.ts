import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_inferPrimaryFaceStatementKind,
  __test_tableClassificationText,
  __test_parsePrimaryStatementAtTableOffset,
} from "@/lib/sec-filing-financials";

async function main() {
  const res = await getAllFilingsByTickerCached("LUMN");
  const f = res?.filings.find((x) => x.accessionNumber === "0000018926-23-000013");
  if (!res || !f) throw new Error("not found");

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });

  const html = bundle.primaryHtml!;
  const ctx = buildParsedFilingHtmlContext(html)!;
  console.log("total tables:", ctx.tables.length);
  for (let i = 0; i < ctx.tables.length; i++) {
    const t = ctx.tables[i]!;
    const kind = __test_inferPrimaryFaceStatementKind(ctx.$, t);
    const text = __test_tableClassificationText(ctx.$, t).slice(0, 120).replace(/\s+/g, " ");
    if (kind === "cf" || /net increase|cash at beginning|financing activities/i.test(text)) {
      console.log(`idx=${i} kind=${kind} offset=${t.offset} text=${text}`);
    }
  }

  const cfIdxs = ctx.tables
    .map((t, i) => ({ i, kind: __test_inferPrimaryFaceStatementKind(ctx.$, t), text: __test_tableClassificationText(ctx.$, t) }))
    .filter((x) => x.kind === "cf" || /net increase.*cash|cash at beginning/i.test(x.text))
    .map((x) => x.i);

  for (const idx of cfIdxs) {
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, "cf", idx, "10-K");
    console.log(`\n=== table[${idx}] ===`);
    console.log("parsed:", parsed?.rows.length, "periods:", parsed?.periods.length);
    console.log("validated:", validated ? "yes" : "no");
    if (parsed) {
      for (const r of parsed.rows) {
        const vals = Object.entries(r.values).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(", ");
        console.log(`  ${r.label.slice(0, 72)} | ${vals}`);
      }
    }
  }
}

main().catch(console.error);
