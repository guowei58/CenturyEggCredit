import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  parsePrimaryFilingStatementsFromHtml,
  __test_validateSinglePrimaryStatementShape,
  __test_parsePrimaryStatementAtTableOffset,
} from "@/lib/sec-filing-financials";
import { locatePrimaryStatementPacket, scoreStatementBlocks, buildStatementBlocks, locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

async function main() {
  const date = process.argv[2]?.trim() ?? "2023-11-07";
  const r = await getAllFilingsByTicker("GEN");
  const f = r!.filings.find((x) => x.filingDate === date && (x.form === "10-Q" || x.form === "10-K"));
  if (!f) throw new Error(`No filing on ${date}`);

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: r!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const located = locatePrimaryStatementPacket(ctx, { form: f.form });
  const stmts = parsePrimaryFilingStatementsFromHtml(html, {
    form: f.form,
    primaryDocument: f.primaryDocument,
    sourceUrl: bundle.primarySourceUrl,
  });

  console.log("filing", f.filingDate, f.form, f.accessionNumber);
  console.log("final statements", stmts.length, stmts.map((s) => s.id).join(",") || "(none)");

  const sectionHit = locateFinancialStatementsSection(ctx, f.form);
  if (sectionHit) {
    const scored = scoreStatementBlocks(
      buildStatementBlocks(ctx, sectionHit.section, sectionHit.scanCeiling),
      sectionHit.section,
      f.form
    );
    const topIs = scored
      .map((b) => ({ id: b.id, off: b.startOffset, score: b.kindScores.is.score, penalties: b.kindScores.is.penalties }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    console.log("top IS block candidates", topIs);
  }

  const pkt = located.packet;
  if (!pkt) {
    console.log("locator packet: null");
    console.log("nearMisses", located.nearMisses.slice(0, 3));
    return;
  }

  console.log("locator packet", {
    span: pkt.span,
    is: { id: pkt.is.id, off: pkt.is.startOffset, score: pkt.is.kindScores.is.score },
    bs: { id: pkt.bs.id, off: pkt.bs.startOffset, score: pkt.bs.kindScores.bs.score },
    cf: { id: pkt.cf.id, off: pkt.cf.startOffset, score: pkt.cf.kindScores.cf.score },
  });

  if (sectionHit) {
    const scored = scoreStatementBlocks(
      buildStatementBlocks(ctx, sectionHit.section, sectionHit.scanCeiling),
      sectionHit.section,
      f.form
    );
    console.log("\nEarly Item 1 blocks (offset < 40k):");
    for (const b of scored.filter((x) => x.startOffset < 40_000).sort((a, b) => a.startOffset - b.startOffset)) {
      const best = (["is", "bs", "cf"] as const)
        .map((k) => [k, b.kindScores[k].score] as const)
        .sort((a, c) => c[1] - a[1])[0]!;
      const idx = ctx.tables.findIndex((t) => t.offset === b.tables[0]!.offset);
      const p = __test_parsePrimaryStatementAtTableOffset(html, best[0], idx, f.form);
      const ok = Boolean(p.validated && __test_validateSinglePrimaryStatementShape(p.validated, f.form));
      console.log(
        b.id,
        "off",
        b.startOffset,
        "best",
        best[0],
        best[1],
        "shapeOk",
        ok,
        "heading",
        b.headingText.slice(0, 90).replace(/\s+/g, " ")
      );
      if (ok) {
        console.log("  rows:", p.validated!.rows.slice(0, 6).map((r) => r.label).join(" | "));
      }
    }
  }

  for (const [kind, block] of [
    ["is", pkt.is],
    ["bs", pkt.bs],
    ["cf", pkt.cf],
  ] as const) {
    console.log(`\n--- ${kind.toUpperCase()} ${block.id} ---`);
    console.log("heading:", block.headingText.slice(0, 140));
    console.log("penalties:", block.kindScores[kind].penalties.join(", ") || "(none)");
    console.log("labels:", block.rowLabels.slice(0, 8).join(" | "));
    for (const t of block.tables.slice(0, 1)) {
      const idx = ctx.tables.findIndex((x) => x.offset === t.offset);
      const p = __test_parsePrimaryStatementAtTableOffset(html, kind, idx, f.form);
      const valid = p.validated ? __test_validateSinglePrimaryStatementShape(p.validated, f.form) : false;
      console.log("parse:", {
        tableIdx: idx,
        parsedRows: p.parsed?.rows.length ?? 0,
        validatedRows: p.validated?.rows.length ?? 0,
        shapeOk: valid,
        periods: p.validated?.periods.map((x) => x.label),
      });
      if (p.validated && !valid) {
        console.log("reject rows:", p.validated.rows.slice(0, 10).map((row) => row.label).join(" | "));
      }
    }
  }
}

main().catch(console.error);
