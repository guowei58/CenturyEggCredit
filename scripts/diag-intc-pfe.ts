/**
 * Diagnose INTC / PFE 10-Q parse failures.
 * Usage: npx tsx scripts/diag-intc-pfe.ts
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_findStatementClusterInPrimaryItemSection,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_parsePrimaryStatementAtTableOffset,
  __test_validateSinglePrimaryStatementShape,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection, locatePrimaryStatementPacket } from "@/lib/sec-statement-locator";

const CASES = [
  { ticker: "INTC", reportPrefix: "2019-03", label: "INTC 2019-Q1" },
  { ticker: "INTC", reportPrefix: "2023-09", label: "INTC 2023-Q3" },
  { ticker: "PFE", reportPrefix: "2023-04", label: "PFE OK 2023-Q1" },
  { ticker: "PFE", reportPrefix: "2024-03", label: "PFE FAIL 2024-Q1" },
];

async function diagCase(c: (typeof CASES)[0]) {
  const res = await getAllFilingsByTickerCached(c.ticker);
  const filing = res?.filings.find(
    (x) =>
      x.form === "10-Q" &&
      (x.reportDate ?? x.filingDate).slice(0, 7) === c.reportPrefix
  );
  if (!filing) {
    console.log("not found", c.label);
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
    console.log(c.label, "NO CTX");
    return;
  }

  const bounds = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, "10-Q");
  const secHit = locateFinancialStatementsSection(ctx, "10-Q");
  const located = locatePrimaryStatementPacket(ctx, { form: "10-Q" });
  const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
  const stmts = parsePrimaryFilingStatementsFromHtml(html, {
    form: "10-Q",
    primaryDocument: filing.primaryDocument,
    sourceUrl: bundle.primarySourceUrl,
  });

  console.log(`\n=== ${c.label} ${filing.accessionNumber} doc=${filing.primaryDocument} ===`);
  console.log("htmlLen", html.length, "tables", ctx.tables.length);
  console.log("bounds", bounds ? `${bounds.end - bounds.start} chars @${bounds.start}` : "null");
  console.log("section", secHit?.strategy ?? "null");
  console.log("packet", located.packet != null, "alternates", located.packetAlternates.length);
  console.log("cluster", cluster ? `score=${cluster.cluster.score}` : "null");
  console.log("parsed", stmts.length, stmts.map((s) => s.id).join(",") || "NONE");

  if (located.packet) {
    for (const kind of ["is", "bs", "cf"] as const) {
      const block = located.packet![kind];
      const ti = ctx.tables.findIndex((t) => t.offset === block.startOffset);
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
      console.log(
        `  locator ${kind} table#${ti}@${block.startOffset} rows=${parsed?.rows.length ?? 0} validated=${!!validated} shape=${validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false}`
      );
      if (parsed?.rows.length) {
        console.log("    labels", parsed.rows.slice(0, 6).map((r) => r.label).join(" | "));
      }
    }
  }

  if (cluster) {
    for (const kind of ["is", "bs", "cf"] as const) {
      const hit = cluster.cluster[kind];
      const ti = ctx.tables.findIndex((t) => t.offset === hit.table.offset);
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, ti, "10-Q");
      console.log(
        `  legacy ${kind} table#${ti}@${hit.table.offset} rows=${parsed?.rows.length ?? 0} validated=${!!validated} shape=${validated ? __test_validateSinglePrimaryStatementShape(validated, "10-Q") : false}`
      );
    }
  }

  if (!bounds) {
    const idx = ctx.acc.search(/\bITEM\s+1\b/i);
    console.log("first ITEM1@", idx, ctx.acc.slice(idx, idx + 180));
    const partI = [...ctx.acc.matchAll(/\bPART\s+I\b/gi)].map((m) => m.index);
    console.log("PART I hits", partI.slice(0, 4));
  }

  if (c.ticker === "INTC") {
    const item1Hits = [...ctx.acc.matchAll(/\bITEM\s+1\b/gi)].map((m) => ({
      idx: m.index ?? 0,
      text: ctx.acc.slice(m.index ?? 0, (m.index ?? 0) + 100).replace(/\s+/g, " "),
    }));
    console.log("  ITEM1 hits:", item1Hits.length);
    for (const h of item1Hits.slice(0, 6)) console.log("   ", h.idx, h.text);
    const item1Pattern = /\bITEM\s+1[\.\u2014\u2013\-]?\s*(?:(?:condensed|consolidated|combined|unaudited)\s+){0,4}FINANCIAL\s+STATEMENTS\b/gi;
    const patternHits = [...ctx.acc.matchAll(item1Pattern)].map((m) => ({
      idx: m.index ?? 0,
      text: ctx.acc.slice(m.index ?? 0, (m.index ?? 0) + 100).replace(/\s+/g, " "),
    }));
    console.log("  ITEM1_PATTERN hits:", patternHits.length);
    for (const h of patternHits) console.log("   ", h.idx, h.text);
    const headings = ["income", "operations", "balance sheet", "cash flow", "comprehensive"];
    for (const h of headings) {
      const re = new RegExp(h.replace(" ", "\\s+"), "i");
      const idx = ctx.acc.search(re);
      console.log(`  first '${h}' @${idx}`);
    }
  }

  if (c.ticker === "INTC" && bounds) {
    const { start, end } = bounds;
    console.log("  section start:", ctx.acc.slice(start, start + 220));
    console.log("  section end:", ctx.acc.slice(Math.max(start, end - 220), end));
    for (const [name, re] of [
      ["ops", /\bstatements?\s+of\s+operations\b/i],
      ["bs", /\bbalance\s+sheets?\b/i],
      ["cf", /\bstatements?\s+of\s+cash\s+flows?\b/i],
    ] as const) {
      const hit = ctx.acc.search(re);
      console.log(`  first ${name} @${hit} inBounds=${hit >= start && hit < end}`);
    }
  }

  if (c.label.includes("PFE FAIL") && located.packet) {
    const ti = ctx.tables.findIndex((t) => t.offset === located.packet!.is.startOffset);
    const { parsed } = __test_parsePrimaryStatementAtTableOffset(html, "is", ti, "10-Q");
    if (parsed) {
      console.log("  IS all labels:");
      parsed.rows.forEach((r, i) => console.log(`    ${i + 1}. ${r.label}`));
      const ni = parsed.rows.findIndex((r) => /\bnet income\b/i.test(r.label));
      console.log("  net income row index (0-based):", ni);
    }
  }
}

async function main() {
  for (const c of CASES) await diagCase(c);
}

main().catch(console.error);
