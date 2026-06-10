import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { buildParsedFilingHtmlContext, fetchHtmlFilingStatementsBundle } from "@/lib/sec-filing-financials";
import { findFilteredNotesToFinancialStatementsStart, findPrimaryFaceTablesEndBeforeNotes } from "@/lib/sec-statement-locator/signals";
import { locateFinancialStatementsSection } from "@/lib/sec-statement-locator";

async function main() {
  const period = process.argv[2] ?? "2024-03-31";
  const res = await getAllFilingsByTickerCached("ETN");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === period
  );
  if (!f || !res) return;
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res.cik,
    accessionNumber: f.accessionNumber,
    form: f.form,
    primaryDocument: f.primaryDocument,
    docUrl: f.docUrl,
  });
  const ctx = buildParsedFilingHtmlContext(bundle.primaryHtml ?? "")!;
  const sec = locateFinancialStatementsSection(ctx, "10-Q")!;
  const umbrella = findFilteredNotesToFinancialStatementsStart(ctx.acc, 1800);
  const faceEnd = findPrimaryFaceTablesEndBeforeNotes(ctx.acc, sec.section.start, sec.section.end);
  console.log(`ETN ${period} section ${sec.section.start}-${sec.section.end}`);
  console.log(`umbrella@${umbrella} faceEnd@${faceEnd}`);
  const headings = [
    "CONSOLIDATED STATEMENTS OF INCOME",
    "CONSOLIDATED BALANCE SHEETS",
    "CONSOLIDATED STATEMENTS OF CASH FLOWS",
    "Notes to",
  ];
  for (const h of headings) {
    const idx = ctx.acc.indexOf(h);
    if (idx >= 0) console.log(`  "${h}" @${idx}`);
  }
  for (const [label, ti] of [
    ["pkt-is", 7],
    ["valid-is", 35],
    ["bs", 9],
    ["cf", 10],
  ] as const) {
    const t = ctx.tables[ti];
    if (t) console.log(`  table ${label} #${ti}@${t.offset} beforeFaceEnd=${t.offset < faceEnd}`);
  }
}

main().catch(console.error);
