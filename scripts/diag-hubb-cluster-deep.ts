import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import {
  buildParsedFilingHtmlContext,
  fetchHtmlFilingStatementsBundle,
  __test_resolveFinancialStatementsSectionBounds,
} from "@/lib/sec-filing-financials";

// Import internals via dynamic test - use cluster section bounds logic
import * as fin from "@/lib/sec-filing-financials";

const main = async () => {
  const res = await getAllFilingsByTickerCached("HUBB");
  const f = res?.filings.find(
    (x) => x.form === "10-Q" && (x.reportDate ?? x.filingDate).slice(0, 10) === "2024-03-31"
  );
  const bundle = await fetchHtmlFilingStatementsBundle({
    cik: res!.cik,
    accessionNumber: f!.accessionNumber,
    form: f!.form,
    primaryDocument: f!.primaryDocument,
    docUrl: f!.docUrl,
  });
  const html = bundle.primaryHtml ?? "";
  const ctx = buildParsedFilingHtmlContext(html)!;
  const section = __test_resolveFinancialStatementsSectionBounds(ctx, "10-Q")!;

  // Replicate buildStatementClusterSectionBounds via exported cluster finder internals
  const clusterHit = fin.__test_findStatementClusterInPrimaryItemSection(ctx, "10-Q");
  console.log("resolved section", section);
  console.log("cluster hit section", clusterHit?.section);
  console.log("cluster", clusterHit?.cluster ?? null);

  // Check notes ceiling in acc around early section
  const notesRe = /\bnotes?\s+to\s+(?:the\s+)?consolidated\s+financial\s+statements\b/gi;
  let m: RegExpExecArray | null;
  const noteHits: number[] = [];
  while ((m = notesRe.exec(ctx.acc)) !== null) {
    if (m.index >= section.start && m.index < section.start + 50000) noteHits.push(m.index);
  }
  console.log("note hits in first 50k", noteHits.slice(0, 5));
  console.log("table offsets #7,#10,#11", [7, 10, 11].map((i) => ctx.tables[i]!.offset));
};

main().catch(console.error);
