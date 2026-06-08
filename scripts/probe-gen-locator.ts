import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import { buildParsedFilingHtmlContext, fetchHtmlFilingStatementsBundle, parsePrimaryFilingStatementsFromHtml } from "@/lib/sec-filing-financials";
import { locatePrimaryStatementPacket } from "@/lib/sec-statement-locator";
import { sortPresentedFilingsNewestFirst } from "@/lib/sec-xbrl-as-presented-save-client";

async function main() {
  const acc = process.argv[2]?.trim() ?? "5-000033";
  const r = await getAllFilingsByTicker("GEN");
  const f = sortPresentedFilingsNewestFirst(r!.filings.filter((x) => x.form === "10-K" || x.form === "10-Q")).find((x) =>
    x.accessionNumber.includes(acc)
  );
  if (!f) throw new Error(`filing ${acc} not found`);

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: r!.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "")!;
  const { locateFinancialStatementsSection, buildStatementBlocks } = await import("@/lib/sec-statement-locator");
  const sectionHit = locateFinancialStatementsSection(ctx, f.form);
  const inSection = ctx.tables.filter(
    (t) => t.offset >= (sectionHit?.section.start ?? 0) && t.offset < (sectionHit?.scanCeiling ?? ctx.acc.length)
  );
  console.log("tables in scan window", inSection.length, "of", ctx.tables.length);
  console.log("section", sectionHit?.section, "scanCeiling", sectionHit?.scanCeiling);
  const offs = ctx.tables.map((t) => t.offset).filter((o) => o >= 250_000 && o <= 420_000);
  console.log("table offsets 250k-420k", offs.slice(0, 20), "count", offs.length);
  if (sectionHit) {
    const blocks = buildStatementBlocks(ctx, sectionHit.section, sectionHit.scanCeiling);
    console.log("raw blocks", blocks.length, blocks.map((b) => ({ id: b.id, tables: b.tables.length, off: b.startOffset })));
  }
  const located = locatePrimaryStatementPacket(ctx, { form: f.form });
  console.log("filing", f.filingDate, f.form, acc);
  console.log("audit", located.audit);
  console.log("packet", located.packet
    ? {
        clusterScore: located.packet.clusterScore,
        span: located.packet.span,
        is: { id: located.packet.is.id, off: located.packet.is.startOffset, score: located.packet.is.kindScores.is.score },
        bs: { id: located.packet.bs.id, off: located.packet.bs.startOffset, score: located.packet.bs.kindScores.bs.score },
        cf: { id: located.packet.cf.id, off: located.packet.cf.startOffset, score: located.packet.cf.kindScores.cf.score },
      }
    : null);
  console.log("nearMisses", located.nearMisses.slice(0, 3));
  const stmts = parsePrimaryFilingStatementsFromHtml(bundle.primaryHtml ?? "", {
    form: f.form,
    primaryDocument: f.primaryDocument,
    sourceUrl: bundle.primarySourceUrl,
  });
  console.log("parsed", stmts.length, stmts.map((s) => s.id).join(","));
}

main().catch(console.error);
