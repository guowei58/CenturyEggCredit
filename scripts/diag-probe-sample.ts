/**
 * Quick failure diagnosis for representative tickers.
 * Usage: npx tsx scripts/diag-probe-sample.ts WMT 2024-04-30
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_findStatementClusterInPrimaryItemSection,
  __test_validateSinglePrimaryStatementShape,
  __test_parsePrimaryStatementAtTableOffset,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection, locatePrimaryStatementPacket } from "@/lib/sec-statement-locator";

const ticker = (process.argv[2] ?? "WMT").toUpperCase();
const period = process.argv[3] ?? "2024-04-30";

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const filing = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!filing) {
    console.log("not found", ticker, period);
    return;
  }

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) {
    console.log("no ctx");
    return;
  }

  const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, "10-Q");
  const sec = locateFinancialStatementsSection(ctx, "10-Q");
  const located = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
  const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
  const stmts = parsePrimaryFilingStatementsFromHtml(html, {
    form: "10-Q",
    primaryDocument: filing.primaryDocument,
    sourceUrl: bundle.primarySourceUrl,
  });

  console.log(`\n=== ${ticker} ${period} ${filing.accessionNumber} ===`);
  console.log("bounds", bounds ? `${bounds.end - bounds.start}@${bounds.start}` : null);
  console.log("section", sec?.strategy ?? null);
  console.log("packet", !!located.packet, "alternates", located.packetAlternates.length);
  console.log("cluster", cluster ? `score=${cluster.cluster.score}` : null);
  console.log("parsed", stmts.length, stmts.map((s) => s.id).join(","));

  if (located.packet) {
    for (const kind of ["is", "bs", "cf"] as const) {
      const block = located.packet![kind];
      const ti = ctx.tables.findIndex((t) => t.offset === block.startOffset);
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
      const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false;
      console.log(
        `  pkt ${kind} #${ti}@${block.startOffset} rows=${parsed?.rows.length ?? 0} valid=${!!validated} shape=${shape}`
      );
      if (validated && !shape) {
        console.log("    labels:", validated.rows.slice(0, 12).map((r) => r.label).join(" | "));
      }
    }
  }

  if (cluster) {
    for (const kind of ["is", "bs", "cf"] as const) {
      const hit = cluster.cluster[kind];
      const ti = ctx.tables.findIndex((t) => t.offset === hit.table.offset);
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
      const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false;
      console.log(
        `  clu ${kind} #${ti}@${hit.table.offset} rows=${parsed?.rows.length ?? 0} valid=${!!validated} shape=${shape}`
      );
      if (validated && !shape) {
        console.log("    labels:", validated.rows.slice(0, 12).map((r) => r.label).join(" | "));
      }
    }
  }
}

main().catch(console.error);
