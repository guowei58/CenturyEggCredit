/**
 * Debug HTZ 2Q20 CF missing sections (page-break / primary table selection).
 * Usage: npx tsx scripts/debug-htz-2q20-cf.ts
 */
import {
  __test_parseBestStatementTableFromHtml,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
} from "@/lib/sec-filing-financials";
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";

const ACCESSION = "0001657853-20-000077";

async function main() {
  const res = await getAllFilingsByTickerCached("HTZ");
  if (!res) throw new Error("HTZ not in cache");

  const filing = res.filings.find((f) => f.accessionNumber === ACCESSION);
  if (!filing) throw new Error(`Filing ${ACCESSION} not found`);

  console.log("filing", filing.filingDate, filing.accessionNumber, filing.form);

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
    filingDate: filing.filingDate,
  });

  const html = bundle.primaryHtml;
  if (!html) throw new Error("bundle.primaryHtml missing");

  const cf = bundle.statements.find((s) => s.id === "cash-flow");
  console.log("\n=== BUNDLE CF ===");
  console.log("rows:", cf?.rows.length, "offset:", cf?.sourceTableOffset);
  cf?.rows.slice(0, 5).forEach((r) => console.log(" ", r.label.slice(0, 65)));

  const best = __test_parseBestStatementTableFromHtml(html, {
    kind: "cf",
    form: filing.form,
  });
  console.log("\n=== parseBestStatementTableFromHtml ===");
  console.log("rows:", best?.rows.length, "offset:", best?.sourceTableOffset);
  best?.rows.slice(0, 5).forEach((r) => console.log(" ", r.label.slice(0, 65)));

  // Scan tables for CF-like content
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) throw new Error("no ctx");

  console.log("\n=== CF-like tables (operating + investing cues) ===");
  for (let i = 0; i < ctx.tables.length; i += 1) {
    const t = ctx.tables[i]!;
    const text = ctx.$(t.el).text().replace(/\s+/g, " ").slice(0, 500).toLowerCase();
    if (!/operating activities|investing activities|net income|cash flow/i.test(text)) continue;
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, "cf", i, filing.form);
    const rowCount = parsed?.rows.length ?? 0;
    const first = parsed?.rows[0]?.label.slice(0, 50) ?? "";
    const valid = parsed ? __test_validateSinglePrimaryStatementShape(parsed, filing.form) : false;
    console.log(
      ` table[${i}] offset=${t.offset} rows=${rowCount} valid=${valid} first=${JSON.stringify(first)}`,
    );
  }

  console.log("\n=== CF tail-fragment tables (financing-only start) ===");
  for (let i = 0; i < ctx.tables.length; i += 1) {
    const t = ctx.tables[i]!;
    const text = ctx.$(t.el).text().replace(/\s+/g, " ").slice(0, 400).toLowerCase();
    if (!/payment of financing costs|net cash provided by \(used in\) financing/i.test(text)) continue;
    if (/operating activities/.test(text) && /investing activities/.test(text)) continue;
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, "cf", i, filing.form);
    console.log(
      ` table[${i}] offset=${t.offset} rows=${parsed?.rows.length ?? 0} valid=${validated ? "yes" : "no"} offsetMatch=${cf?.sourceTableOffset === t.offset}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
