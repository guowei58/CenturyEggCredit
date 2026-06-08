import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_findStatementClusterInPrimaryItemSection,
  __test_statementTableTextLooksLikePrimaryFace,
  __test_validateSinglePrimaryStatementShape,
  __test_parsePrimaryStatementAtTableOffset,
} from "@/lib/sec-filing-financials";
import type { StatementKind } from "@/lib/sec-filing-financials";
import { sortPresentedFilingsNewestFirst } from "@/lib/sec-xbrl-as-presented-save-client";

async function probeFiling(
  cik: string,
  f: { form: string; filingDate: string; accessionNumber: string; primaryDocument: string; docUrl?: string }
) {
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const sourceUrl = bundle.primarySourceUrl ?? "";
  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) {
    console.log(f.filingDate, f.form, "no html context");
    return;
  }
  const section = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, f.form);
  const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, f.form);
  const stmts =
    bundle.statements.length > 0
      ? bundle.statements
      : parsePrimaryFilingStatementsFromHtml(html, {
          form: f.form,
          primaryDocument: f.primaryDocument,
          sourceUrl,
        });
  console.log("---", f.filingDate, f.form, f.accessionNumber.slice(-8));
  console.log("  html chars", html.length, "tables", ctx.tables.length);
  console.log(
    "  section",
    section ? { start: section.start, end: section.end, len: section.end - section.start } : null
  );
  console.log(
    "  cluster",
    cluster
      ? {
          score: cluster.cluster.score,
          span: cluster.cluster.end - cluster.cluster.start,
          offsets: {
            is: cluster.cluster.is.table.offset,
            bs: cluster.cluster.bs.table.offset,
            cf: cluster.cluster.cf.table.offset,
          },
        }
      : null
  );
  console.log("  stmts", stmts.length, stmts.map((s) => s.id).join(",") || "(none)");

  if (section) {
    const notesIdx = ctx.acc.indexOf("Notes to Consolidated Financial Statements", section.start);
    const condensedNotesIdx = ctx.acc.indexOf("Notes to Condensed Consolidated Financial Statements", section.start);
    console.log("  notes heading offsets", { notesIdx, condensedNotesIdx, sectionEnd: section.end });
    const kinds: StatementKind[] = ["is", "bs", "cf"];
    const faceCounts = Object.fromEntries(
      kinds.map((kind) => [
        kind,
        ctx.tables.filter(
          (table) =>
            table.offset >= section.start &&
            table.offset < section.end &&
            __test_statementTableTextLooksLikePrimaryFace(ctx.$, table, kind)
        ).length,
      ])
    );
    console.log("  face tables in section", faceCounts);
    for (const kind of kinds) {
      const hits = ctx.tables
        .filter(
          (table) =>
            table.offset >= section.start &&
            table.offset < section.end &&
            __test_statementTableTextLooksLikePrimaryFace(ctx.$, table, kind)
        )
        .slice(0, 6)
        .map((table) => table.offset);
      console.log(`  ${kind} face offsets (first 6)`, hits);
    }
  }

  if (cluster) {
    for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
      const hit = kind === "bs" ? cluster.cluster.bs : kind === "is" ? cluster.cluster.is : cluster.cluster.cf;
      const tableIdx = ctx.tables.findIndex((table) => table.offset === hit.table.offset);
      const parsed = __test_parsePrimaryStatementAtTableOffset(html, kind, tableIdx, f.form);
      const valid = parsed.validated
        ? __test_validateSinglePrimaryStatementShape(parsed.validated, f.form)
        : false;
      const preview = parsed.validated?.rows.slice(0, 3).map((row) => row.label).join(" | ") ?? "(unparsed)";
      console.log(`  cluster ${kind} idx=${tableIdx} valid=${valid} rows=${parsed.validated?.rows.length ?? 0} preview=${preview}`);
    }
  }
}

async function main() {
  const accFilter = process.argv[2]?.trim();
  const r = await getAllFilingsByTicker("GEN");
  const ordered = sortPresentedFilingsNewestFirst(
    r!.filings.filter((f) => f.form === "10-K" || f.form === "10-Q")
  );
  const targets = accFilter
    ? ordered.filter((f) => f.accessionNumber.includes(accFilter))
    : ordered.slice(0, 4);
  for (const f of targets) {
    await probeFiling(r!.cik, f);
  }
}

main().catch(console.error);
