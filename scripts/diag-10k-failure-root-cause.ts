/**
 * Deep root-cause diagnosis for a single 10-K probe failure.
 * Usage: npx tsx scripts/diag-10k-failure-root-cause.ts ACN 2023-08-31 is
 */
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_findStatementClusterInPrimaryItemSection,
  __test_validateSinglePrimaryStatementShape,
  __test_parsePrimaryStatementAtTableOffset,
} from "@/lib/sec-filing-financials";
import { locateFinancialStatementsSection, locatePrimaryStatementPacket } from "@/lib/sec-statement-locator";
import { findFilteredNotesToFinancialStatementsStart } from "@/lib/sec-statement-locator/signals";
import { parseFilingSummaryReports } from "@/lib/secDebtFootnote/filingSummary";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

const ticker = (process.argv[2] ?? "ACN").toUpperCase();
const period = process.argv[3] ?? "2023-08-31";
const missingKind = (process.argv[4] ?? "is") as "is" | "bs" | "cf";
const form = "10-K";
const kindToId = { is: "income-statement", bs: "balance-sheet", cf: "cash-flow" } as const;

async function fetchFilingSummaryReports(cik: string, accession: string) {
  const cikNum = String(parseInt(cik, 10));
  const acc = accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/FilingSummary.xml`;
  const resp = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  if (!resp.ok) return [];
  return parseFilingSummaryReports(await resp.text());
}

async function main() {
  const res = await getAllFilingsByTickerCached(ticker);
  const filing = res?.filings.find(
    (x) => x.form === form && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!filing || !res) return console.log("not found", ticker, period);

  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    primaryDocument: filing.primaryDocument,
    docUrl: filing.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const sec = locateFinancialStatementsSection(ctx, form);
  const located = locatePrimaryStatementPacket(ctx, { form });
  const cluster = __test_findStatementClusterInPrimaryItemSection(ctx, form);
  const umbrella = findFilteredNotesToFinancialStatementsStart(ctx.acc, 1800);

  const targetId = kindToId[missingKind];
  const got = bundle.statements.find((s) => s.id === targetId);

  console.log(`\n=== ${ticker} ${period} missing=${targetId} ===`);
  console.log("bundle:", bundle.statements.map((s) => `${s.id}@${s.sourceHtmlFile}(${s.rows.length}r)`).join(", ") || "none");
  console.log("section:", sec?.strategy, "packet:", !!located.packet, "cluster:", !!cluster);
  console.log("umbrella@", umbrella ?? "null", "tables:", ctx.tables.length);

  if (located.packet) {
    const block = located.packet[missingKind];
    for (const table of block.tables.slice(0, 3)) {
      const ti = ctx.tables.findIndex((t) => t.offset === table.offset);
      const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, missingKind, ti, form);
      const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, form) : false;
      const preview = ctx.acc.slice(Math.max(0, table.offset - 150), table.offset + 100).replace(/\s+/g, " ");
      console.log(
        `  pkt ${missingKind} #${ti}@${table.offset} rows=${parsed?.rows.length ?? 0} shape=${shape} ctx=${preview.slice(0, 120)}`
      );
      if (validated && !shape) {
        console.log("    labels:", validated.rows.slice(0, 10).map((r) => r.label).join(" | "));
      }
    }
  }

  if (cluster) {
    const hit = cluster.cluster[missingKind];
    const ti = ctx.tables.findIndex((t) => t.offset === hit.table.offset);
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, missingKind, ti, form);
    const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, form) : false;
    console.log(`  clu ${missingKind} #${ti}@${hit.table.offset} rows=${parsed?.rows.length ?? 0} shape=${shape}`);
    if (validated && !shape) {
      console.log("    labels:", validated.rows.slice(0, 10).map((r) => r.label).join(" | "));
    }
  }

  const sectionStart = sec?.section.start ?? 0;
  const sectionEnd = sec?.section.end ?? ctx.acc.length;
  const candidates: Array<{ ti: number; offset: number; rows: number; shape: boolean }> = [];
  for (let ti = 0; ti < ctx.tables.length; ti++) {
    const t = ctx.tables[ti]!;
    if (t.offset < sectionStart || t.offset >= sectionEnd) continue;
    const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(html, missingKind, ti, form);
    if (!parsed || parsed.rows.length < 5) continue;
    const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, form) : false;
    candidates.push({ ti, offset: t.offset, rows: parsed.rows.length, shape });
  }
  candidates.sort((a, b) => b.rows - a.rows);
  console.log(`  section candidates for ${missingKind}: ${candidates.length} (shape-valid: ${candidates.filter((c) => c.shape).length})`);
  for (const c of candidates.filter((x) => x.shape).slice(0, 3)) {
    console.log(`    valid #${c.ti}@${c.offset} rows=${c.rows}`);
  }
  for (const c of candidates.filter((x) => !x.shape).slice(0, 3)) {
    const { validated } = __test_parsePrimaryStatementAtTableOffset(html, missingKind, c.ti, form);
    const labels = validated?.rows.slice(0, 6).map((r) => r.label).join(" | ") ?? "";
    console.log(`    invalid #${c.ti}@${c.offset} rows=${c.rows} labels=${labels}`);
  }

  const fsReports = await fetchFilingSummaryReports(res.cik, filing.accessionNumber);
  const stmtReports = fsReports.filter((r) => {
    const blob = [r.shortName, r.longName, r.menuCategory].join(" ");
    if (missingKind === "is") return /income|operations|earnings|comprehensive/i.test(blob) && /statement/i.test(blob);
    if (missingKind === "bs") return /balance/i.test(blob) && /statement/i.test(blob);
    return /cash\s+flow/i.test(blob) && /statement/i.test(blob);
  });
  console.log(`  FilingSummary ${missingKind} reports:`, stmtReports.map((r) => r.htmlFile + ":" + (r.shortName ?? "")).join(" | ") || "none");

  if (!got && stmtReports.length > 0) {
    const cikNum = String(parseInt(res.cik, 10));
    const acc = filing.accessionNumber.replace(/-/g, "");
    for (const rep of stmtReports.slice(0, 2)) {
      const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${rep.htmlFile}`;
      const resp = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
      const repHtml = await resp.text();
      const repCtx = buildParsedFilingHtmlContext(repHtml);
      if (!repCtx) continue;
      let best = { ti: -1, rows: 0, shape: false };
      for (let ti = 0; ti < repCtx.tables.length; ti++) {
        const { parsed, validated } = __test_parsePrimaryStatementAtTableOffset(repHtml, missingKind, ti, form);
        if (!parsed) continue;
        const shape = validated ? __test_validateSinglePrimaryStatementShape(validated, form) : false;
        if (parsed.rows.length > best.rows) best = { ti, rows: parsed.rows.length, shape };
      }
      console.log(`  FS ${rep.htmlFile}: best table #${best.ti} rows=${best.rows} shape=${best.shape}`);
    }
  }
}

main().catch(console.error);
