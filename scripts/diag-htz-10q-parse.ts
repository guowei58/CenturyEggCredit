/**
 * Diagnose why HTZ 10-Q primary HTML parse returns 0 statements.
 * Usage: npx tsx scripts/diag-htz-10q-parse.ts
 */
import * as cheerio from "cheerio";

import { getAllFilingsByTicker, SEC_EDGAR_USER_AGENT } from "@/lib/sec-edgar";
import {
  buildParsedFilingHtmlContext,
  parsePrimaryFilingStatementsFromHtml,
  resolveEdgarArchivesDataCikForSubmission,
  __test_findPrimaryFinancialStatementsItemSectionBounds,
  __test_resolveFinancialStatementsSectionBounds,
  __test_resolvePrimaryFinancialStatementsItemStart,
  __test_findStatementClusterInPrimaryItemSection,
  __test_findEmbeddedFaceStatementsSectionBounds,
  __test_validateSinglePrimaryStatementShape,
  __test_parsePrimaryStatementAtTableOffset,
  __test_inferPrimaryFaceStatementKind,
  __test_statementTableTextLooksLikePrimaryFace,
} from "@/lib/sec-filing-financials";
import { locatePrimaryStatementPacket } from "@/lib/sec-statement-locator";
import { findPrimaryFaceTablesEndBeforeNotes } from "@/lib/sec-statement-locator/signals";
import { primaryHtmlHasInlineIxTags } from "@/lib/sec-ixbrl-inline-cell";
import {
  __test_parseBestStatementTableFromHtml,
} from "@/lib/sec-filing-financials";

function snippet(acc: string, start: number, len = 400): string {
  return acc.slice(start, start + len).replace(/\s+/g, " ").trim();
}

function countIxInSection(html: string, start: number, end: number): number {
  const slice = html.slice(Math.max(0, start), Math.min(html.length, end));
  return (slice.match(/<ix:nonfraction\b/gi) ?? []).length;
}

async function main() {
  const res = await getAllFilingsByTicker("HTZ");
  if (!res) throw new Error("HTZ not found");
  const q = res.filings.find((f) => f.form === "10-Q");
  if (!q) throw new Error("No 10-Q");

  const archiveCik = resolveEdgarArchivesDataCikForSubmission({
    issuerCik: res.cik,
    accessionNumber: q.accessionNumber,
  });
  const acc = q.accessionNumber.replace(/-/g, "");
  const cikNum = parseInt(archiveCik.replace(/\D/g, ""), 10);
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${encodeURIComponent(q.primaryDocument)}`;
  const html = await (await fetch(url, { headers: { "User-Agent": SEC_EDGAR_USER_AGENT } })).text();

  console.log("Filing:", q.form, q.filingDate, q.accessionNumber, q.primaryDocument);
  console.log("inline IX in primary HTML:", primaryHtmlHasInlineIxTags(html));
  console.log("HTML length:", html.length);

  const ctx = buildParsedFilingHtmlContext(html);
  if (!ctx) throw new Error("No parsed context");

  const form = "10-Q";
  const itemStart = __test_resolvePrimaryFinancialStatementsItemStart(ctx.acc, form);
  const itemBounds = __test_findPrimaryFinancialStatementsItemSectionBounds(ctx.acc, form);
  const sectionBounds = __test_resolveFinancialStatementsSectionBounds(ctx, form);
  const embeddedBounds = __test_findEmbeddedFaceStatementsSectionBounds(ctx, form);
  const clusterHit = __test_findStatementClusterInPrimaryItemSection(ctx, form);
  const locator = locatePrimaryStatementPacket(ctx, { form });

  console.log("\n--- Section discovery ---");
  console.log("itemStart:", itemStart, itemStart != null ? JSON.stringify(snippet(ctx.acc, itemStart)) : null);
  console.log("itemBounds:", itemBounds, itemBounds ? `span=${itemBounds.end - itemBounds.start}` : null);
  console.log("sectionBounds:", sectionBounds, sectionBounds ? `span=${sectionBounds.end - sectionBounds.start}` : null);
  console.log("embeddedBounds:", embeddedBounds);
  console.log("clusterHit:", clusterHit
    ? {
        section: clusterHit.section,
        score: clusterHit.cluster.score,
        offsets: {
          is: clusterHit.cluster.is?.table.offset,
          bs: clusterHit.cluster.bs?.table.offset,
          cf: clusterHit.cluster.cf?.table.offset,
        },
      }
    : null);
  console.log("locator packet:", locator.packet
    ? {
        section: locator.packet.section,
        tables: locator.packet.blocks.map((b) => ({
          kind: b.kind,
          offset: b.table.offset,
          score: b.score,
        })),
      }
    : null);
  console.log("locator alternates:", locator.packetAlternates?.length ?? 0);

  if (sectionBounds) {
    const ceiling = findPrimaryFaceTablesEndBeforeNotes(
      ctx.acc,
      sectionBounds.start,
      sectionBounds.end
    );
    console.log("\n--- Scan ceiling (tables must be BEFORE this offset) ---");
    console.log("primaryFaceTablesEndBeforeNotes:", ceiling);
    console.log("ceiling snippet:", JSON.stringify(snippet(ctx.acc, Math.max(0, ceiling - 120), 240)));
    console.log("tagged BS table at 40294 excluded?", 40294 >= ceiling);
    console.log("tagged IS table at 42985 excluded?", 42985 >= ceiling);
    console.log("tagged CF table at 46089 excluded?", 46089 >= ceiling);

    console.log("\n--- parseBestStatementTableFromHtml per kind ---");
    for (const kind of ["is", "bs", "cf"] as const) {
      const stmt = __test_parseBestStatementTableFromHtml(html, {
        kind,
        form,
        primaryDocument: q.primaryDocument,
        sourceUrl: url,
      });
      console.log(
        kind,
        stmt
          ? {
              rows: stmt.rows.length,
              offset: stmt.sourceTableOffset,
              valid: __test_validateSinglePrimaryStatementShape(stmt, form),
            }
          : null
      );
    }
  }

  const primaryOnly = parsePrimaryFilingStatementsFromHtml(html, {
    form: q.form,
    primaryDocument: q.primaryDocument,
    sourceUrl: url,
  });
  console.log("\n--- parsePrimaryFilingStatementsFromHtml ---");
  console.log("statement count:", primaryOnly.length);
  for (const s of primaryOnly) {
    console.log({
      id: s.id,
      rows: s.rows.length,
      periods: s.periods.length,
      valid: __test_validateSinglePrimaryStatementShape(s, form),
      source: s.sourceHtmlFile,
      tableOffset: s.sourceTableOffset,
    });
  }

  console.log("\n--- Tables in section with IX tags (top candidates) ---");
  const section = sectionBounds ?? itemBounds;
  if (section) {
    const tablesInSection = ctx.tables.filter(
      (t) => t.offset >= section.start && t.offset < section.end
    );
    console.log("tables in section:", tablesInSection.length);

    type Cand = {
      offset: number;
      kind: string | null;
      face: boolean;
      ixCount: number;
      preview: string;
      parsed?: { id: string; rows: number; periods: number; valid: boolean };
    };
    const cands: Cand[] = [];

    for (const table of tablesInSection.slice(0, 80)) {
      const $t = ctx.$(table.el);
      const text = $t.text().replace(/\s+/g, " ").trim().slice(0, 120);
      const kind = __test_inferPrimaryFaceStatementKind(ctx.$, table);
      const face = kind
        ? __test_statementTableTextLooksLikePrimaryFace(ctx.$, table, kind)
        : false;
      const ixCount = ($t.html() ?? "").match(/<ix:nonfraction\b/gi)?.length ?? 0;
      const cand: Cand = { offset: table.offset, kind, face, ixCount, preview: text };
      if (kind && ixCount > 0) {
        const tableIndex = ctx.tables.indexOf(table);
        const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, kind, tableIndex, form);
        if (parsed) {
          cand.parsed = {
            id: parsed.id,
            rows: parsed.rows.length,
            periods: parsed.periods.length,
            valid: Boolean(validated) && __test_validateSinglePrimaryStatementShape(parsed, form),
          };
        }
      }
      if (ixCount >= 5 || face) cands.push(cand);
    }

    cands.sort((a, b) => b.ixCount - a.ixCount);
    for (const c of cands.slice(0, 15)) {
      console.log(c);
    }
  }

  console.log("\n--- Heading search in acc text ---");
  const patterns = [
    /\bITEM\s+1\b/gi,
    /\bPART\s+I\b/gi,
    /\bstatements?\s+of\s+operations\b/gi,
    /\bbalance\s+sheets?\b/gi,
    /\bstatements?\s+of\s+cash\s+flows?\b/gi,
    /\bfinancial\s+statements\b/gi,
  ];
  for (const re of patterns) {
    const hits: number[] = [];
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(ctx.acc)) !== null && hits.length < 8) hits.push(m.index);
    console.log(re.source, "→", hits.length, "hits", hits.slice(0, 5).map((i) => `@${i}:${snippet(ctx.acc, i, 80)}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
