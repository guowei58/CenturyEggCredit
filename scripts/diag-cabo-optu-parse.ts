import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_findStatementClusterInPrimaryItemSection,
  __test_validateSinglePrimaryStatementShape,
  __test_parsePrimaryStatementAtTableOffset,
} from "@/lib/sec-filing-financials";

const CASES = [
  { ticker: "CABO", acc: "0001632127-23-000010", label: "CABO FAIL 2023-Q1" },
  { ticker: "CABO", acc: "0001632127-25-000094", label: "CABO OK 2025-Q2" },
  { ticker: "CABO", acc: "0001632127-25-000100", label: "CABO FAIL 2025-Q3" },
  { ticker: "OPTU", acc: "0001628280-19-005707", label: "OPTU OK 2019-Q1" },
  { ticker: "OPTU", acc: "0001628280-19-013363", label: "OPTU FAIL 2019-Q3" },
  { ticker: "OPTU", acc: "0001628280-23-015294", label: "OPTU FAIL 2023-Q1" },
];

async function main() {
  for (const c of CASES) {
    const res = await getAllFilingsByTickerCached(c.ticker);
    const filing = res?.filings.find(
      (x) => x.form === "10-Q" && x.accessionNumber.replace(/-/g, "").includes(c.acc.replace(/-/g, "").slice(-10))
    );
    if (!filing) {
      console.log("not found", c.label);
      continue;
    }
    const bundle = await fetchHtmlFilingStatementsBundle({
      cik: res!.cik,
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      primaryDocument: filing.primaryDocument,
      docUrl: filing.docUrl,
    });
    const html = bundle.primaryHtml ?? "";
    const ctx = buildParsedFilingHtmlContext(html)!;
    const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
    const stmts = parsePrimaryFilingStatementsFromHtml(html, {
      form: "10-Q",
      primaryDocument: filing.primaryDocument,
      sourceUrl: bundle.primarySourceUrl,
    });

    console.log(`\n=== ${c.label} ===`);
    console.log("parsed", stmts.length, stmts.map((s) => s.id).join(",") || "NONE");
    if (cluster) {
      console.log("cluster offsets", {
        is: cluster.cluster.is.table.offset,
        bs: cluster.cluster.bs.table.offset,
        cf: cluster.cluster.cf.table.offset,
        score: cluster.cluster.score,
      });
      for (const kind of ["is", "bs", "cf"] as const) {
        const hit = cluster.cluster[kind];
        const ti = ctx.tables.findIndex((t) => t.offset === hit.table.offset);
        const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
        console.log(
          kind,
          `table#${ti}@${hit.table.offset}`,
          "parsed",
          parsed?.rows.length ?? 0,
          "validated",
          validated != null,
          "shape",
          validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false
        );
        if (parsed?.rows.length) {
          console.log("  labels", parsed.rows.slice(0, 8).map((r) => r.label).join(" | "));
        }
      }
    } else {
      console.log("NO CLUSTER");
    }
  }
}

main().catch(console.error);
